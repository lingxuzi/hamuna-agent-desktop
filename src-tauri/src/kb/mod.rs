//! Knowledge base engine (WorkBuddy-style 资料库).
//!
//! Users create multiple knowledge bases, add text/markdown/URL material into
//! them, and each workspace mounts a set of knowledge bases. Ingest builds a
//! knowledge graph in two steps:
//!   - deterministic skeleton: jieba keyword extraction + co-occurrence edges
//!     (this module, no LLM);
//!   - LLM relation typing: the Node sidecar reads the pending-relation queue,
//!     runs the SDK, and writes typed relations back via the management API.
//!
//! Full-text recall uses Tantivy (reusing the shared jieba tokenizer from
//! `crate::search::tokenizer`); graph structure is persisted as JSON under
//! `~/.hamuna/kb/`. This module is a Tauri-managed singleton, same tier as
//! `crate::search::SearchEngine`.

mod schema;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};

use crate::utils::file_lock::{with_file_lock, FileLockError, FileLockOptions};

use schema::{KbFields, KB_SCHEMA_VERSION};

/// Root directory name under the hamuna data dir.
const KB_DIR_NAME: &str = "kb";
/// Index file listing all knowledge bases.
const INDEX_FILE: &str = "index.json";
/// Mounts file mapping normalized workspace path -> kb ids.
const MOUNTS_FILE: &str = "mounts.json";
/// Per-KB graph file.
const GRAPH_FILE: &str = "graph.json";
/// Max chunk characters fed to one skeleton pass (MVP ceiling).
const MAX_CHUNK_CHARS: usize = 12_000;
/// LLM extraction chunk size (chars). Fine granularity: small chunks let the
/// LLM extract a precise knowledge structure per piece, and the FULL text is
/// preserved across chunks (no truncation).
const CHUNK_CHARS: usize = 4_000;
/// Top-N frequent tokens kept as entities per chunk.
const TOP_ENTITIES_PER_CHUNK: usize = 20;
/// A token must appear this many times to become a skeleton entity
/// (keeps rare single mentions from polluting the graph).
const MIN_ENTITY_FREQ: u32 = 2;
/// A co-occurrence pair must co-occur this many times (across windows) to
/// become a skeleton edge — cuts the dense noise ball of single mentions.
const MIN_COOCCUR_COUNT: u32 = 2;
/// Co-occurrence window (tokens) for skeleton edges.
const COOCCUR_WINDOW: usize = 6;
/// Max relations returned by a query's 1-hop expansion.
const MAX_HOP_RELATIONS: usize = 200;
/// Tantivy writer heap.
const WRITER_HEAP_BYTES: usize = 50_000_000;

/// Convert a `String` message into a `FileLockError::Io` (for use inside
/// `with_file_lock` mutators whose `?` operators must produce `FileLockError`).
fn lock_io(msg: impl Into<String>) -> FileLockError {
    FileLockError::Io(std::io::Error::new(std::io::ErrorKind::Other, msg.into()))
}

/// Lock-directory path for a data file. `with_file_lock` creates a lock
/// DIRECTORY at this path, so it must never point at the data file itself —
/// otherwise the first acquisition would create a directory at the data path
/// and every read/write of the file would fail ("Is a directory").
fn lock_path_for(data_path: &Path) -> PathBuf {
    let mut os = data_path.as_os_str().to_owned();
    os.push(".lock");
    PathBuf::from(os)
}

// ── Persistent types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbInfo {
    pub id: String,
    pub name: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbEntity {
    pub id: String,
    pub label: String,
    /// Entity kind from the LLM (e.g. "ORG", "PERSON", "PLACE", "PRODUCT",
    /// "DATE", "CODE"). Enables type-filtered knowledge queries. Optional so
    /// older graphs / the LLM write-back (entities may carry only id/label)
    /// deserialize.
    #[serde(default)]
    pub entity_type: Option<String>,
    /// Source doc/chunk ids this entity was extracted from. Optional so the
    /// LLM-extraction write-back (entities carry only id/label) deserializes.
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbRelation {
    pub subject: String,
    pub object: String,
    /// Relation type: "cooccur" for the deterministic skeleton, otherwise the
    /// LLM-provided typed relation (e.g. "is_a", "depends_on").
    pub relation_type: String,
    pub weight: f32,
    /// Whether the relation was typed by the LLM (true) or is still a raw
    /// co-occurrence skeleton edge (false).
    pub typed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbGraph {
    pub entities: Vec<KbEntity>,
    pub relations: Vec<KbRelation>,
    /// LLM extraction tasks still queued for this KB — 0 means extraction is
    /// done. Lets the UI show live progress and stop polling.
    #[serde(default)]
    pub pending_count: usize,
}

/// A raw uploaded document stored per KB, so the graph can be rebuilt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbDoc {
    pub id: String,
    pub title: String,
    pub text: String,
    pub added_at_ms: u64,
}

/// Lightweight doc metadata for the frontend list (no full text).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbDocMeta {
    pub id: String,
    pub title: String,
    pub added_at_ms: u64,
    pub text_length: usize,
}

/// Pending LLM relation-typing task for one chunk's candidate pairs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRelationTask {
    pub kb_id: String,
    pub chunk_id: String,
    pub text: String,
    /// Candidate (subject, object) entity pairs to be typed.
    pub pairs: Vec<(String, String)>,
}

// ── Query result types ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbQueryEntity {
    pub id: String,
    pub label: String,
    pub score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbQueryRelation {
    pub subject: String,
    pub object: String,
    pub relation_type: String,
    pub weight: f32,
    pub typed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbQueryResult {
    pub entities: Vec<KbQueryEntity>,
    pub relations: Vec<KbQueryRelation>,
    pub snippets: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbGraphSummary {
    pub entity_count: usize,
    pub relation_count: usize,
    pub typed_relation_count: usize,
}

/// Per-KB Tantivy index state. Reader is lock-free; writer is serialized.
struct KbIndex {
    index: Index,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    fields: KbFields,
}

/// The knowledge base engine singleton.
pub struct KbEngine {
    kb_dir: PathBuf,
    /// kb_id -> open index. Lazily opened on first use.
    indices: Mutex<HashMap<String, Arc<KbIndex>>>,
}

static KB_ENGINE: std::sync::OnceLock<Arc<KbEngine>> = std::sync::OnceLock::new();

/// Install the engine singleton (called from lib.rs setup).
pub fn set_kb_engine(engine: Arc<KbEngine>) {
    let _ = KB_ENGINE.set(engine);
}

/// Access the engine singleton (management API handlers + tests).
pub fn get_kb_engine() -> Option<&'static Arc<KbEngine>> {
    KB_ENGINE.get()
}

impl KbEngine {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        let kb_dir = data_dir.join(KB_DIR_NAME);
        std::fs::create_dir_all(&kb_dir)
            .map_err(|e| format!("Failed to create kb dir: {}", e))?;
        Ok(Self {
            kb_dir,
            indices: Mutex::new(HashMap::new()),
        })
    }

    // ── helpers ──────────────────────────────────────────────────────────

    fn index_path(&self) -> PathBuf {
        self.kb_dir.join(INDEX_FILE)
    }
    fn mounts_path(&self) -> PathBuf {
        self.kb_dir.join(MOUNTS_FILE)
    }
    fn graph_path(&self, kb_id: &str) -> PathBuf {
        self.kb_dir.join(kb_id).join(GRAPH_FILE)
    }
    fn pending_path(&self, kb_id: &str) -> PathBuf {
        self.kb_dir.join(kb_id).join("pending.json")
    }
    fn docs_path(&self, kb_id: &str) -> PathBuf {
        self.kb_dir.join(kb_id).join("docs.json")
    }
    fn kb_dir_path(&self, kb_id: &str) -> PathBuf {
        self.kb_dir.join(kb_id)
    }

    fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, FileLockError> {
        let raw = std::fs::read_to_string(path).map_err(|e| lock_io(format!("read {}: {}", path.display(), e)))?;
        serde_json::from_str(&raw).map_err(|e| lock_io(format!("parse {}: {}", path.display(), e)))
    }

    fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), FileLockError> {
        let parent = path
            .parent()
            .ok_or_else(|| lock_io(format!("no parent for {}", path.display())))?;
        std::fs::create_dir_all(parent).map_err(|e| lock_io(format!("mkdir {}: {}", parent.display(), e)))?;
        let raw = serde_json::to_string_pretty(value)
            .map_err(|e| lock_io(format!("serialize {}: {}", path.display(), e)))?;
        std::fs::write(path, raw).map_err(|e| lock_io(format!("write {}: {}", path.display(), e)))
    }

    // ── CRUD ─────────────────────────────────────────────────────────────

    pub async fn list_kbs(&self) -> Result<Vec<KbInfo>, String> {
        let path = self.index_path();
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(vec![]);
            }
            Self::read_json(&path)
        })
        .await
        .map_err(|e| format!("kb list lock error: {}", e))
    }

    pub async fn create_kb(&self, name: String) -> Result<KbInfo, String> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("KB name must not be empty".into());
        }
        let path = self.index_path();
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut kbs: Vec<KbInfo> = if path.exists() {
                Self::read_json(&path)?
            } else {
                vec![]
            };
            if kbs.iter().any(|k| k.name.eq_ignore_ascii_case(&name)) {
                return Err(lock_io(format!("知识库名称已存在: {}", name)));
            }
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let id = format!("kb_{}", uuid_simple());
            let info = KbInfo {
                id: id.clone(),
                name,
                created_at_ms: now,
            };
            kbs.push(info.clone());
            Self::write_json(&path, &kbs)?;
            Ok(info)
        })
        .await
        .map_err(|e| format!("kb create lock error: {}", e))
    }

    pub async fn rename_kb(&self, kb_id: String, name: String) -> Result<(), String> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("KB name must not be empty".into());
        }
        let path = self.index_path();
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut kbs: Vec<KbInfo> = Self::read_json(&path)?;
            let kb = kbs
                .iter_mut()
                .find(|k| k.id == kb_id)
                .ok_or_else(|| lock_io(format!("知识库不存在: {}", kb_id)))?;
            kb.name = name;
            Self::write_json(&path, &kbs)
        })
        .await
        .map_err(|e| format!("kb rename lock error: {}", e))
    }

    pub async fn delete_kb(&self, kb_id: String) -> Result<(), String> {
        let index_path = self.index_path();
        let lock = lock_path_for(&index_path);
        let kb_id_for_closure = kb_id.clone();
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut kbs: Vec<KbInfo> = Self::read_json(&index_path)?;
            let before = kbs.len();
            kbs.retain(|k| k.id != kb_id_for_closure);
            if kbs.len() == before {
                return Err(lock_io(format!("知识库不存在: {}", kb_id_for_closure)));
            }
            Self::write_json(&index_path, &kbs)?;
            Ok(())
        })
        .await
        .map_err(|e| format!("kb delete lock error: {}", e))?;

        // Drop the open index and remove on-disk data.
        {
            let mut indices = self.indices.lock().unwrap();
            indices.remove(&kb_id);
        }
        let dir = self.kb_dir_path(&kb_id);
        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }

    // ── mounts ───────────────────────────────────────────────────────────

    pub async fn list_mounts(&self) -> Result<HashMap<String, Vec<String>>, String> {
        let path = self.mounts_path();
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(HashMap::new());
            }
            Self::read_json(&path)
        })
        .await
        .map_err(|e| format!("kb mounts read error: {}", e))
    }

    pub async fn set_mounts(&self, workspace: String, kb_ids: Vec<String>) -> Result<(), String> {
        let path = self.mounts_path();
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut map: HashMap<String, Vec<String>> = if path.exists() {
                Self::read_json(&path)?
            } else {
                HashMap::new()
            };
            let mut ids = kb_ids;
            ids.sort();
            ids.dedup();
            if ids.is_empty() {
                map.remove(&workspace);
            } else {
                map.insert(workspace, ids);
            }
            Self::write_json(&path, &map)
        })
        .await
        .map_err(|e| format!("kb mounts write error: {}", e))
    }

    pub async fn mounts_for_workspace(&self, workspace: &str) -> Result<Vec<String>, String> {
        let path = self.mounts_path();
        let lock = lock_path_for(&path);
        let workspace = workspace.to_string();
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(vec![]);
            }
            let map: HashMap<String, Vec<String>> = Self::read_json(&path)?;
            Ok(map.get(&workspace).cloned().unwrap_or_default())
        })
        .await
        .map_err(|e| format!("kb mounts read error: {}", e))
    }

    // ── ingest ───────────────────────────────────────────────────────────

    /// Add a text document to a KB. Parses into chunks, builds the deterministic
    /// skeleton (entities + co-occurrence edges), indexes the text, and emits
    /// pending LLM relation-typing tasks.
    pub async fn add_text(&self, kb_id: String, title: String, text: String) -> Result<KbGraphSummary, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("入库内容不能为空".into());
        }
        let idx = self.ensure_index(&kb_id)?;

        // LLM-only extraction: split the raw text into meaning-preserving
        // chunks (NO truncation — every character belongs to some chunk),
        // emit one pending task per chunk, and let the poller's LLM call
        // extract the knowledge. The skeleton (jieba entities + cooccurrence)
        // is deliberately NOT wired here anymore — the user wants the graph to
        // contain only real LLM-extracted knowledge.
        let chunks = chunk_text(&text, CHUNK_CHARS);

        // Persist the raw document so the graph can be rebuilt later.
        let docs_path = self.docs_path(&kb_id);
        let lock = lock_path_for(&docs_path);
        let doc_id = uuid_simple();
        let added_at_ms = now_ms();
        let doc_text = text.clone();
        let doc_title = title.clone();
        let doc_id_for_closure = doc_id.clone();
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut docs: Vec<KbDoc> = if docs_path.exists() {
                Self::read_json(&docs_path)?
            } else {
                vec![]
            };
            docs.push(KbDoc {
                id: doc_id_for_closure,
                title: doc_title,
                text: doc_text,
                added_at_ms,
            });
            Self::write_json(&docs_path, &docs)
        })
        .await
        .map_err(|e| format!("kb docs write error: {}", e))?;

        // Index each chunk in Tantivy (fine-grained full-text recall) and
        // queue an LLM extraction task for it.
        for (i, chunk) in chunks.iter().enumerate() {
            let chunk_id = format!("{}-{}", doc_id, i);
            index_chunk(&idx, &kb_id, &chunk_id, &title, chunk)?;

            let pending_path = self.pending_path(&kb_id);
            let lock = lock_path_for(&pending_path);
            let task = PendingRelationTask {
                kb_id: kb_id.clone(),
                chunk_id,
                text: chunk.clone(),
                pairs: vec![],
            };
            with_file_lock(&lock, FileLockOptions::default(), move || {
                let mut tasks: Vec<PendingRelationTask> = if pending_path.exists() {
                    Self::read_json(&pending_path)?
                } else {
                    vec![]
                };
                tasks.push(task);
                Self::write_json(&pending_path, &tasks)
            })
            .await
            .map_err(|e| format!("kb pending write error: {}", e))?;
        }

        // The graph is populated asynchronously by the LLM poller; report
        // current (probably empty until extraction lands) stats.
        let graph_path = self.graph_path(&kb_id);
        let lock = lock_path_for(&graph_path);
        let graph = with_file_lock(&lock, FileLockOptions::default(), move || {
            if graph_path.exists() {
                Self::read_json(&graph_path)
            } else {
                Ok(KbGraph::default())
            }
        })
        .await
        .map_err(|e| format!("kb graph read error: {}", e))?;

        Ok(KbGraphSummary {
            entity_count: graph.entities.len(),
            relation_count: graph.relations.len(),
            typed_relation_count: graph.relations.iter().filter(|r| r.typed).count(),
        })
    }

    // ── docs ─────────────────────────────────────────────────────────────

    /// List the raw documents stored in a KB (metadata only, newest first).
    pub async fn list_docs(&self, kb_id: String) -> Result<Vec<KbDocMeta>, String> {
        let path = self.docs_path(&kb_id);
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let docs: Vec<KbDoc> = if path.exists() {
                Self::read_json(&path)?
            } else {
                vec![]
            };
            let mut meta: Vec<KbDocMeta> = docs
                .into_iter()
                .map(|d| KbDocMeta {
                    id: d.id,
                    title: d.title,
                    added_at_ms: d.added_at_ms,
                    text_length: d.text.chars().count(),
                })
                .collect();
            meta.sort_by(|a, b| b.added_at_ms.cmp(&a.added_at_ms));
            Ok(meta)
        })
        .await
        .map_err(|e| format!("kb docs list error: {}", e))
    }

    /// Rebuild a KB's graph + index from its stored raw documents. Clears the
    /// existing graph, pending queue and index, then re-ingests every doc.
    pub async fn rebuild(&self, kb_id: String) -> Result<KbGraphSummary, String> {
        // 1. Read the raw docs.
        let docs_path = self.docs_path(&kb_id);
        let lock = lock_path_for(&docs_path);
        let docs: Vec<KbDoc> = with_file_lock(&lock, FileLockOptions::default(), move || {
            if docs_path.exists() {
                Self::read_json(&docs_path)
            } else {
                Ok(vec![])
            }
        })
        .await
        .map_err(|e| format!("kb docs read error: {}", e))?;

        // 2. Clear graph + pending.
        let graph_path = self.graph_path(&kb_id);
        let lock = lock_path_for(&graph_path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if graph_path.exists() {
                std::fs::remove_file(&graph_path).map_err(|e| lock_io(e.to_string()))?;
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("kb graph clear error: {}", e))?;

        let pending_path = self.pending_path(&kb_id);
        let lock = lock_path_for(&pending_path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if pending_path.exists() {
                std::fs::remove_file(&pending_path).map_err(|e| lock_io(e.to_string()))?;
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("kb pending clear error: {}", e))?;

        // 3. Drop + rebuild the Tantivy index (fresh schema).
        let kb_dir = self.kb_dir_path(&kb_id);
        let index_dir = kb_dir.join("index");
        if index_dir.exists() {
            std::fs::remove_dir_all(&index_dir)
                .map_err(|e| format!("clear index: {}", e))?;
        }
        let idx = self.ensure_index(&kb_id)?;

        // 4. Re-ingest every doc (LLM-only: chunk → index + pending; the graph
        // is repopulated by the poller as extractions land).
        let mut summary = KbGraphSummary {
            entity_count: 0,
            relation_count: 0,
            typed_relation_count: 0,
        };
        for doc in &docs {
            for (i, chunk) in chunk_text(&doc.text, CHUNK_CHARS).iter().enumerate() {
                let chunk_id = format!("{}-{}", doc.id, i);
                index_chunk(&idx, &kb_id, &chunk_id, &doc.title, chunk)?;

                let pending_path = self.pending_path(&kb_id);
                let lock = lock_path_for(&pending_path);
                let task = PendingRelationTask {
                    kb_id: kb_id.clone(),
                    chunk_id,
                    text: chunk.clone(),
                    pairs: vec![],
                };
                with_file_lock(&lock, FileLockOptions::default(), move || {
                    let mut tasks: Vec<PendingRelationTask> = if pending_path.exists() {
                        Self::read_json(&pending_path)?
                    } else {
                        vec![]
                    };
                    tasks.push(task);
                    Self::write_json(&pending_path, &tasks)
                })
                .await
                .map_err(|e| format!("kb pending write error: {}", e))?;
            }
        }

        Ok(summary)
    }

    // ── relations ────────────────────────────────────────────────────────

    /// Pop (and clear) the pending relation-typing queue for a KB.
    /// PEEK pending relation-typing tasks for a KB (does NOT consume them).
    /// The poller processes the peeked tasks and calls
    /// `remove_pending_relations` for the ones that succeeded — so a failed
    /// extraction stays queued and retries next poll, and `pending_count`
    /// (graph progress) reflects real remaining work instead of dropping to 0
    /// the moment tasks are picked up.
    pub async fn peek_pending_relations(&self, kb_id: String, limit: usize) -> Result<Vec<PendingRelationTask>, String> {
        let path = self.pending_path(&kb_id);
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(vec![]);
            }
            let tasks: Vec<PendingRelationTask> = Self::read_json(&path)?;
            Ok(tasks.into_iter().take(limit).collect())
        })
        .await
        .map_err(|e| format!("kb pending peek error: {}", e))
    }

    /// Remove successfully-processed pending tasks (by chunk id) from the queue.
    pub async fn remove_pending_relations(&self, kb_id: String, chunk_ids: Vec<String>) -> Result<(), String> {
        if chunk_ids.is_empty() {
            return Ok(());
        }
        let path = self.pending_path(&kb_id);
        let lock = lock_path_for(&path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(());
            }
            let mut tasks: Vec<PendingRelationTask> = Self::read_json(&path)?;
            let before = tasks.len();
            tasks.retain(|t| !chunk_ids.contains(&t.chunk_id));
            if tasks.is_empty() {
                let _ = std::fs::remove_file(&path);
            } else if tasks.len() != before {
                Self::write_json(&path, &tasks)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("kb pending remove error: {}", e))
    }

    /// PEEK pending tasks across all KBs (for the Node poller).
    pub async fn take_pending_relations_all(&self, limit: usize) -> Result<Vec<PendingRelationTask>, String> {
        let kbs = self.list_kbs().await?;
        let mut out: Vec<PendingRelationTask> = vec![];
        for kb in kbs {
            if out.len() >= limit {
                break;
            }
            let mut tasks = self.peek_pending_relations(kb.id, limit - out.len()).await?;
            out.append(&mut tasks);
        }
        Ok(out)
    }

    /// Merge LLM-extracted entities + typed relations into the graph.
    /// The LLM reads the chunk text and produces REAL named entities
    /// (company names, people, products…) plus typed relations between them.
    pub async fn save_relations(
        &self,
        kb_id: String,
        entities: Vec<KbEntity>,
        relations: Vec<KbRelation>,
    ) -> Result<(), String> {
        let graph_path = self.graph_path(&kb_id);
        let lock = lock_path_for(&graph_path);
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut graph: KbGraph = if graph_path.exists() {
                Self::read_json(&graph_path)?
            } else {
                KbGraph::default()
            };
            merge_entities(&mut graph, entities);
            merge_relations(&mut graph, relations);
            Self::write_json(&graph_path, &graph)
        })
        .await
        .map_err(|e| format!("kb relations write error: {}", e))
    }

    // ── query ────────────────────────────────────────────────────────────

    pub async fn query(&self, kb_ids: Vec<String>, query: String, limit: usize) -> Result<KbQueryResult, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(KbQueryResult {
                entities: vec![],
                relations: vec![],
                snippets: vec![],
            });
        }

        let mut all_entities: Vec<(String, String, f32)> = vec![]; // (id, label, score)
        let mut snippets: Vec<String> = vec![];

        for kb_id in &kb_ids {
            let idx = match self.indices.lock().unwrap().get(kb_id).cloned() {
                Some(i) => i,
                None => continue, // not indexed yet
            };
            let (mut ents, mut snips) = search_index(&idx, &query, limit)?;
            all_entities.append(&mut ents);
            snippets.append(&mut snips);
        }

        // Dedup entities by id, keep highest score.
        let mut seen: HashMap<String, KbQueryEntity> = HashMap::new();
        for (id, label, score) in all_entities {
            match seen.get_mut(&id) {
                Some(e) => {
                    if score > e.score {
                        e.score = score;
                    }
                }
                None => {
                    seen.insert(id.clone(), KbQueryEntity { id, label, score });
                }
            }
        }
        let mut entities: Vec<KbQueryEntity> = seen.into_values().collect();
        entities.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        // 1-hop neighborhood from matched entities across the mounted KBs.
        let mut matched_ids: HashSet<String> = entities.iter().map(|e| e.id.clone()).collect();
        // Also match graph entities by label (global id == label): the query's
        // tokens hit real nodes, not just the search-surface doc ids.
        let query_tokens: Vec<String> = tokenize(query);
        if !query_tokens.is_empty() {
            for kb_id in &kb_ids {
                let graph_path = self.graph_path(kb_id).clone();
                let graph: KbGraph = if graph_path.exists() {
                    Self::read_json(&graph_path).unwrap_or_default()
                } else {
                    KbGraph::default()
                };
                for e in graph.entities {
                    if query_tokens.iter().any(|t| e.label.to_lowercase().contains(t)) {
                        matched_ids.insert(e.id.clone());
                    }
                }
            }
        }
        let mut relations: Vec<KbQueryRelation> = vec![];
        for kb_id in &kb_ids {
            let graph_path = self.graph_path(kb_id).clone();
            let graph: KbGraph = if graph_path.exists() {
                Self::read_json(&graph_path).unwrap_or_default()
            } else {
                KbGraph::default()
            };
            for r in graph.relations {
                if matched_ids.contains(&r.subject) || matched_ids.contains(&r.object) {
                    relations.push(KbQueryRelation {
                        subject: r.subject,
                        object: r.object,
                        relation_type: r.relation_type,
                        weight: r.weight,
                        typed: r.typed,
                    });
                    if relations.len() >= MAX_HOP_RELATIONS {
                        break;
                    }
                }
            }
        }

        Ok(KbQueryResult {
            entities,
            relations,
            snippets,
        })
    }

    // ── internal index management ────────────────────────────────────────

    fn ensure_index(&self, kb_id: &str) -> Result<Arc<KbIndex>, String> {
        {
            let indices = self.indices.lock().unwrap();
            if let Some(i) = indices.get(kb_id) {
                return Ok(i.clone());
            }
        }
        let idx = Arc::new(open_kb_index(&self.kb_dir_path(kb_id))?);
        self.indices
            .lock()
            .unwrap()
            .insert(kb_id.to_string(), idx.clone());
        Ok(idx)
    }
}

// ── skeleton + indexing helpers ─────────────────────────────────────────

/// Common Chinese/English stopwords — frequent function words that are noise
/// as knowledge-graph entities. Short list keeps the graph meaningful without
/// bloating; extend as needed.
const STOPWORDS: &[&str] = &[
    "的", "了", "是", "在", "和", "与", "及", "或", "也", "都", "而", "但", "并", "且", "等",
    "一", "不", "这", "那", "之", "其", "被", "把", "对", "从", "向", "为", "以", "于",
    "我们", "你们", "他们", "它们", "这个", "那个", "这些", "那些", "可以", "能够", "因为",
    "所以", "但是", "如果", "没有", "不是", "就是", "什么", "怎么", "一个", "进行", "通过",
    "the", "a", "an", "of", "to", "in", "and", "is", "are", "was", "were", "for", "with",
    "on", "at", "by", "from", "as", "it", "this", "that", "these", "those", "we", "you",
    "they", "he", "she", "i", "be", "not", "or", "but", "if", "so", "can", "will",
];

/// Split text into meaning-preserving chunks of at most `max_chars` chars.
/// Every character lands in exactly one chunk (NO truncation). Breaks prefer
/// sentence/clause boundaries (。！？；\n) so each chunk keeps readable meaning
/// for the LLM; falls back to a hard character break when no boundary exists
/// within the window.
fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = vec![];
    let mut start = 0;
    let chars: Vec<char> = text.chars().collect();
    while start < chars.len() {
        let end = (start + max_chars).min(chars.len());
        if end == chars.len() {
            chunks.push(chars[start..end].iter().collect());
            break;
        }
        // Look back for the last sentence boundary within the window.
        let mut break_at = None;
        for i in (start..end).rev() {
            if matches!(chars[i], '。' | '！' | '？' | '；' | '\n' | '\r') {
                break_at = Some(i + 1);
                break;
            }
        }
        match break_at {
            // Found a boundary: end the chunk there.
            Some(pos) if pos > start => {
                chunks.push(chars[start..pos].iter().collect());
                start = pos;
            }
            // No boundary in this window: hard-break at the window edge, but
            // don't strand a single trailing char (keep at least one).
            _ => {
                chunks.push(chars[start..end].iter().collect());
                start = end;
            }
        }
    }
    if chunks.is_empty() {
        chunks.push(text.to_string());
    }
    chunks
}

/// Tokenize text with the shared jieba tokenizer into meaningful tokens.
/// Filters stopwords, single-char tokens (Chinese or ASCII), and punctuation.
fn tokenize(text: &str) -> Vec<String> {
    use tantivy::tokenizer::{TokenStream, Tokenizer};
    let mut tokenizer = tantivy_jieba::JiebaTokenizer {};
    let mut stream = tokenizer.token_stream(text);
    let mut out = vec![];
    while let Some(t) = stream.next() {
        let s = t.text.trim().to_lowercase();
        // Require >= 2 chars (a single Chinese char is 3 bytes — byte-length
        // checks would let single-char noise through).
        if s.chars().count() < 2 {
            continue;
        }
        // Skip pure punctuation / whitespace.
        if s.chars().all(|c| c.is_ascii_punctuation() || c.is_whitespace()) {
            continue;
        }
        if STOPWORDS.contains(&s.as_str()) {
            continue;
        }
        out.push(s);
    }
    out
}

/// Build the deterministic skeleton: frequent tokens -> entities, and
/// co-occurrence within a sliding window -> weighted "cooccur" edges.
/// Returns (entities, relations, candidate_pairs_for_llm).
fn build_skeleton(
    chunk_id: &str,
    text: &str,
) -> (Vec<KbEntity>, Vec<KbRelation>, Vec<(String, String)>) {
    let bounded: String = text.chars().take(MAX_CHUNK_CHARS).collect();
    let tokens = tokenize(&bounded);

    let mut freq: HashMap<&str, u32> = HashMap::new();
    for t in &tokens {
        *freq.entry(t.as_str()).or_insert(0) += 1;
    }

    // Top-N by frequency, but only tokens that appear enough to be
    // meaningful (a single mention is usually a spurious token).
    let mut ranked: Vec<(&str, u32)> = freq
        .into_iter()
        .filter(|(_, count)| *count >= MIN_ENTITY_FREQ)
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(TOP_ENTITIES_PER_CHUNK);

    // GLOBAL entity identity: id == the (normalized) label. The same label in
    // different chunks must resolve to ONE node, so merge_entities can unify
    // them and the graph stays connected across documents.
    let entities: Vec<KbEntity> = ranked
        .iter()
        .map(|(label, _)| KbEntity {
            id: entity_id(label),
            label: label.to_string(),
            entity_type: None,
            sources: vec![chunk_id.to_string()],
        })
        .collect();

    // Co-occurrence edges within a sliding window.
    let mut cooccur: HashMap<(usize, usize), u32> = HashMap::new();
    for i in 0..tokens.len() {
        for j in (i + 1)..(i + COOCCUR_WINDOW).min(tokens.len()) {
            if tokens[i] == tokens[j] {
                continue;
            }
            let a = tokens[i].clone();
            let b = tokens[j].clone();
            // Only link tokens that both made the top-N entity list.
            let ai = ranked.iter().position(|(l, _)| *l == a.as_str());
            let bi = ranked.iter().position(|(l, _)| *l == b.as_str());
            if let (Some(ai), Some(bi)) = (ai, bi) {
                let key = if ai < bi { (ai, bi) } else { (bi, ai) };
                *cooccur.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut relations: Vec<KbRelation> = vec![];
    let mut pairs: Vec<(String, String)> = vec![];
    for ((ai, bi), count) in cooccur {
        // Skip weak edges (single co-occurrence) — they are the bulk of the
        // dense noise ball and carry little signal.
        if count < MIN_COOCCUR_COUNT {
            continue;
        }
        let subj = entity_id(&ranked[ai].0);
        let obj = entity_id(&ranked[bi].0);
        relations.push(KbRelation {
            subject: subj.clone(),
            object: obj.clone(),
            relation_type: "cooccur".to_string(),
            weight: count as f32,
            typed: false,
        });
        pairs.push((subj, obj));
    }

    (entities, relations, pairs)
}

/// Global entity id — the normalized label itself. Chunk-scoped prefixes would
/// duplicate the same concept across documents.
fn entity_id(label: &str) -> String {
    label.trim().to_lowercase()
}

fn merge_entities(graph: &mut KbGraph, entities: Vec<KbEntity>) {
    for e in entities {
        match graph.entities.iter_mut().find(|existing| existing.id == e.id) {
            Some(existing) => {
                // Unify: merge new sources (dedup), keep first label casing.
                for s in e.sources {
                    if !existing.sources.contains(&s) {
                        existing.sources.push(s);
                    }
                }
                // Keep the first non-null entity type (LLM-labeled entities
                // may arrive before/after skeleton ones).
                if existing.entity_type.is_none() {
                    existing.entity_type = e.entity_type;
                }
            }
            None => graph.entities.push(e),
        }
    }
}

fn merge_relations(graph: &mut KbGraph, relations: Vec<KbRelation>) {
    for mut r in relations {
        // Typed relation upgrades/overrides a cooccur edge between the same pair.
        if r.typed {
            if let Some(prev) = graph.relations.iter_mut().find(|p| {
                p.subject == r.subject && p.object == r.object && !p.typed
            }) {
                prev.relation_type = r.relation_type.clone();
                prev.typed = true;
                prev.weight = r.weight.max(prev.weight);
                continue;
            }
        }
        // Same-direction cooccur edge seen again (same pair across chunks):
        // accumulate weight so stronger co-occurrence stands out.
        match graph.relations.iter_mut().find(|p| {
            p.subject == r.subject && p.object == r.object && p.relation_type == r.relation_type
        }) {
            Some(prev) => {
                prev.weight += r.weight;
            }
            None => {
                r.typed = r.typed || r.relation_type != "cooccur";
                graph.relations.push(r);
            }
        }
    }
}

fn open_kb_index(dir: &Path) -> Result<KbIndex, String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create kb index dir: {}", e))?;

    let index_dir = dir.join("index");
    std::fs::create_dir_all(&index_dir)
        .map_err(|e| format!("Failed to create kb index dir: {}", e))?;

    let (schema, fields) = schema::kb_schema();
    let version_file = index_dir.join(".schema_version");
    let stored_version = std::fs::read_to_string(&version_file)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());
    if stored_version != Some(KB_SCHEMA_VERSION) && index_dir.join("meta.json").exists() {
        let _ = std::fs::remove_dir_all(&index_dir);
        std::fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;
    }

    let index = if index_dir.join("meta.json").exists() {
        Index::open_in_dir(&index_dir).map_err(|e| format!("open kb index: {}", e))?
    } else {
        Index::create_in_dir(&index_dir, schema).map_err(|e| format!("create kb index: {}", e))?
    };
    let _ = std::fs::write(&version_file, KB_SCHEMA_VERSION.to_string());

    index.tokenizers().register(
        crate::search::TOKENIZER_NAME,
        crate::search::build_chinese_tokenizer(),
    );

    let writer = match index.writer(WRITER_HEAP_BYTES) {
        Ok(w) => w,
        Err(first_err) => {
            let lock_path = index_dir.join(".tantivy-writer.lock");
            if lock_path.exists() {
                let _ = std::fs::remove_file(&lock_path);
                index
                    .writer(WRITER_HEAP_BYTES)
                    .map_err(|e| format!("kb index writer after lock recovery: {}", e))?
            } else {
                return Err(format!("kb index writer: {}", first_err));
            }
        }
    };
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e| format!("kb index reader: {}", e))?;

    Ok(KbIndex {
        index,
        reader,
        writer: Mutex::new(writer),
        fields,
    })
}

fn index_chunk(idx: &KbIndex, kb_id: &str, chunk_id: &str, title: &str, text: &str) -> Result<(), String> {
    let bounded: String = text.chars().take(MAX_CHUNK_CHARS).collect();
    let mut writer = idx.writer.lock().unwrap();
    let doc = doc!(
        idx.fields.kb_id => kb_id,
        idx.fields.chunk_id => chunk_id,
        idx.fields.title => title,
        idx.fields.content => bounded,
    );
    writer.add_document(doc).map_err(|e| format!("kb add doc: {}", e))?;
    writer.commit().map_err(|e| format!("kb commit: {}", e))?;
    Ok(())
}

fn search_index(
    idx: &KbIndex,
    query: &str,
    limit: usize,
) -> Result<(Vec<(String, String, f32)>, Vec<String>), String> {
    let reader = idx.reader.clone();
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&idx.index, vec![idx.fields.title, idx.fields.content]);

    let query_obj = parser
        .parse_query(query)
        .map_err(|e| format!("kb query parse: {}", e))?;
    let top = searcher
        .search(&query_obj, &TopDocs::with_limit(limit.max(1)))
        .map_err(|e| format!("kb search: {}", e))?;

    let mut entities: Vec<(String, String, f32)> = vec![];
    let mut snippets: Vec<String> = vec![];
    for (score, doc_addr) in top {
        if let Ok(doc) = searcher.doc::<tantivy::TantivyDocument>(doc_addr) {
            let content = get_text_field(&doc, idx.fields.content);
            if !content.is_empty() {
                snippets.push(trim_snippet(&content));
            }
            let title = get_text_field(&doc, idx.fields.title);
            if !title.is_empty() {
                // Treat the document title as a lightweight entity surface.
                entities.push((format!("doc:{}", title), title, score));
            }
        }
    }
    Ok((entities, snippets))
}

fn get_text_field(doc: &tantivy::TantivyDocument, field: tantivy::schema::Field) -> String {
    doc.get_first(field)
        .and_then(|v| match v {
            tantivy::schema::OwnedValue::Str(s) => Some(s.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}

fn trim_snippet(text: &str) -> String {
    let bounded: String = text.chars().take(240).collect();
    if bounded.chars().count() < text.chars().count() {
        format!("{}…", bounded)
    } else {
        bounded
    }
}

/// Milliseconds since UNIX epoch (for doc added-at timestamps).
fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn uuid_simple() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}{:08x}", now, c as u32)
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_kb_list(state: tauri::State<'_, Arc<KbEngine>>) -> Result<Vec<KbInfo>, String> {
    state.list_kbs().await
}

#[tauri::command]
pub async fn cmd_kb_create(
    state: tauri::State<'_, Arc<KbEngine>>,
    name: String,
) -> Result<KbInfo, String> {
    state.create_kb(name).await
}

#[tauri::command]
pub async fn cmd_kb_rename(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
    name: String,
) -> Result<(), String> {
    state.rename_kb(kb_id, name).await
}

#[tauri::command]
pub async fn cmd_kb_delete(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<(), String> {
    state.delete_kb(kb_id).await
}

#[tauri::command]
pub async fn cmd_kb_add_text(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
    title: String,
    text: String,
) -> Result<KbGraphSummary, String> {
    state.add_text(kb_id, title, text).await
}

#[tauri::command]
pub async fn cmd_kb_list_docs(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<Vec<KbDocMeta>, String> {
    state.list_docs(kb_id).await
}

#[tauri::command]
pub async fn cmd_kb_rebuild(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<KbGraphSummary, String> {
    state.rebuild(kb_id).await
}

#[tauri::command]
pub async fn cmd_kb_graph(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<KbGraphSummary, String> {
    let path = state.graph_path(&kb_id);
    let lock = lock_path_for(&path);
    with_file_lock(&lock, FileLockOptions::default(), move || {
        if !path.exists() {
            return Ok(KbGraphSummary {
                entity_count: 0,
                relation_count: 0,
                typed_relation_count: 0,
            });
        }
        let graph: KbGraph = KbEngine::read_json(&path)?;
        Ok(KbGraphSummary {
            entity_count: graph.entities.len(),
            relation_count: graph.relations.len(),
            typed_relation_count: graph.relations.iter().filter(|r| r.typed).count(),
        })
    })
    .await
    .map_err(|e| format!("kb graph read error: {}", e))
}

/// Full knowledge graph (entities + relations) for a KB — used by the
/// renderer's graph visualization. Also reports how many LLM extraction tasks
/// are still queued (pendingCount) so the UI can show live progress.
#[tauri::command]
pub async fn cmd_kb_graph_data(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<KbGraph, String> {
    let path = state.graph_path(&kb_id);
    let lock = lock_path_for(&path);
    let mut graph: KbGraph = with_file_lock(&lock, FileLockOptions::default(), move || {
        if !path.exists() {
            return Ok(KbGraph::default());
        }
        KbEngine::read_json(&path)
    })
    .await
    .map_err(|e| format!("kb graph data read error: {}", e))?;

    // Live extraction progress: count queued pending tasks (pending.json is
    // drained as the poller consumes it, so this shrinks to 0 when done).
    let pending_path = state.pending_path(&kb_id);
    let plock = lock_path_for(&pending_path);
    let pending = with_file_lock(&plock, FileLockOptions::default(), move || {
        if !pending_path.exists() {
            return Ok(0usize);
        }
        let tasks: Vec<PendingRelationTask> = KbEngine::read_json(&pending_path)?;
        Ok(tasks.len())
    })
    .await
    .map_err(|e| format!("kb pending count error: {}", e))?;
    graph.pending_count = pending;

    Ok(graph)
}

#[tauri::command]
pub async fn cmd_kb_query(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_ids: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<KbQueryResult, String> {
    state.query(kb_ids, query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn cmd_kb_mount_list(
    state: tauri::State<'_, Arc<KbEngine>>,
) -> Result<HashMap<String, Vec<String>>, String> {
    state.list_mounts().await
}

#[tauri::command]
pub async fn cmd_kb_mount_set(
    state: tauri::State<'_, Arc<KbEngine>>,
    workspace: String,
    kb_ids: Vec<String>,
) -> Result<(), String> {
    state.set_mounts(workspace, kb_ids).await
}

// ── management API surface (called by the Node sidecar) ─────────────────

/// Query mounted KBs. Returns a serialized `KbQueryResult`.
pub async fn mgmt_kb_query(
    engine: &Arc<KbEngine>,
    kb_ids: Vec<String>,
    query: String,
    limit: usize,
) -> Result<KbQueryResult, String> {
    engine.query(kb_ids, query, limit).await
}

/// PEEK pending relation-typing tasks for a KB (does not consume — the
/// poller removes them via remove_pending_relations after success).
pub async fn mgmt_kb_take_pending(
    engine: &Arc<KbEngine>,
    kb_id: String,
    limit: usize,
) -> Result<Vec<PendingRelationTask>, String> {
    engine.peek_pending_relations(kb_id, limit).await
}

/// Take pending relation-typing tasks across all KBs.
pub async fn mgmt_kb_take_pending_all(
    engine: &Arc<KbEngine>,
    limit: usize,
) -> Result<Vec<PendingRelationTask>, String> {
    engine.take_pending_relations_all(limit).await
}

/// Save LLM-extracted entities + typed relations.
pub async fn mgmt_kb_save_relations(
    engine: &Arc<KbEngine>,
    kb_id: String,
    entities: Vec<KbEntity>,
    relations: Vec<KbRelation>,
) -> Result<(), String> {
    engine.save_relations(kb_id, entities, relations).await
}

/// Add a text document (used by the Node sidecar after URL/PDF/docx/xlsx
/// parsing — the sidecar cannot invoke Tauri IPC, so it writes back over the
/// management API).
pub async fn mgmt_kb_add_text(
    engine: &Arc<KbEngine>,
    kb_id: String,
    title: String,
    text: String,
) -> Result<KbGraphSummary, String> {
    engine.add_text(kb_id, title, text).await
}

// ── tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skeleton_extracts_entities_and_cooccurrence_edges() {
        // Repeated Chinese words should surface as entities with a cooccur edge.
        // Note: jieba tokenizes "知识图谱" as "知识" + "图谱", so the entity
        // labels are the split words (pre-existing jieba behavior, not a
        // regression of the skeleton builder).
        let text = "知识图谱 知识图谱 实体 实体 关系 关系 知识图谱 实体";
        let (entities, relations, pairs) = build_skeleton("c1", text);

        assert!(!entities.is_empty(), "should extract entities");
        let labels: HashSet<&str> = entities.iter().map(|e| e.label.as_str()).collect();
        assert!(labels.contains("知识"));
        assert!(labels.contains("图谱"));
        assert!(labels.contains("实体"));
        assert!(labels.contains("关系"));

        // Every relation's pair should also appear in the candidate pairs for LLM.
        assert_eq!(relations.len(), pairs.len());
        for r in &relations {
            assert_eq!(r.relation_type, "cooccur");
            assert!(!r.typed);
        }
    }

    #[test]
    fn typed_relation_upgrades_cooccurrence_edge() {
        let mut graph = KbGraph {
            entities: vec![KbEntity {
                id: "c1:a".into(),
                label: "a".into(),
                entity_type: None,
                sources: vec!["c1".into()],
            }],
            relations: vec![KbRelation {
                subject: "c1:a".into(),
                object: "c1:b".into(),
                relation_type: "cooccur".into(),
                weight: 2.0,
                typed: false,
            }],
            pending_count: 0,
        };

        merge_relations(
            &mut graph,
            vec![KbRelation {
                subject: "c1:a".into(),
                object: "c1:b".into(),
                relation_type: "depends_on".into(),
                weight: 5.0,
                typed: true,
            }],
        );

        assert_eq!(graph.relations.len(), 1);
        let r = &graph.relations[0];
        assert!(r.typed);
        assert_eq!(r.relation_type, "depends_on");
        assert_eq!(r.weight, 5.0);
    }

    #[test]
    fn chunk_text_preserves_every_character() {
        // No truncation: concatenating all chunks must equal the input.
        let text = "第一句。第二句话！第三句？\n换行后的第四句。最后一句没有句号";
        let chunks = chunk_text(&text, 6);
        assert!(chunks.len() >= 2, "long text should split into multiple chunks");
        let joined: String = chunks.iter().flat_map(|c| c.chars()).collect();
        assert_eq!(joined, text, "every char must survive chunking exactly once");
        assert!(
            chunks.iter().all(|c| c.chars().count() <= 8),
            "chunks may slightly exceed the window to keep a sentence boundary"
        );
    }
}
