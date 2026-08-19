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
/// Top-N frequent tokens kept as entities per chunk.
const TOP_ENTITIES_PER_CHUNK: usize = 40;
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
    /// Source doc/chunk ids this entity was extracted from.
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
        let lock = path.clone();
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
        let lock = path.clone();
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
        let lock = path.clone();
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
        let lock = index_path.clone();
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
        let lock = path.clone();
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
        let lock = path.clone();
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
        let lock = path.clone();
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
        let chunk_id = uuid_simple();

        // Build skeleton.
        let (entities, relations, pairs) = build_skeleton(&chunk_id, &text);

        // Persist graph (merge).
        let graph_path = self.graph_path(&kb_id);
        let lock = graph_path.clone();
        let graph = with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut graph: KbGraph = if graph_path.exists() {
                Self::read_json(&graph_path)?
            } else {
                KbGraph::default()
            };
            merge_entities(&mut graph, entities);
            merge_relations(&mut graph, relations);
            Self::write_json(&graph_path, &graph)?;
            Ok(graph)
        })
        .await
        .map_err(|e| format!("kb graph write error: {}", e))?;

        // Index the chunk text (title + content) in Tantivy for full-text recall.
        index_chunk(&idx, &kb_id, &chunk_id, &title, &text)?;

        // Emit pending relation tasks.
        if !pairs.is_empty() {
            let pending_path = self.pending_path(&kb_id);
            let lock = pending_path.clone();
            let task = PendingRelationTask {
                kb_id: kb_id.clone(),
                chunk_id: chunk_id.clone(),
                text: text.chars().take(MAX_CHUNK_CHARS).collect(),
                pairs,
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

        Ok(KbGraphSummary {
            entity_count: graph.entities.len(),
            relation_count: graph.relations.len(),
            typed_relation_count: graph.relations.iter().filter(|r| r.typed).count(),
        })
    }

    // ── relations ────────────────────────────────────────────────────────

    /// Pop (and clear) the pending relation-typing queue for a KB.
    pub async fn take_pending_relations(&self, kb_id: String, limit: usize) -> Result<Vec<PendingRelationTask>, String> {
        let path = self.pending_path(&kb_id);
        let lock = path.clone();
        with_file_lock(&lock, FileLockOptions::default(), move || {
            if !path.exists() {
                return Ok(vec![]);
            }
            let mut tasks: Vec<PendingRelationTask> = Self::read_json(&path)?;
            let taken: Vec<PendingRelationTask> = tasks.drain(..tasks.len().min(limit)).collect();
            if tasks.is_empty() {
                let _ = std::fs::remove_file(&path);
            } else {
                Self::write_json(&path, &tasks)?;
            }
            Ok(taken)
        })
        .await
        .map_err(|e| format!("kb pending read error: {}", e))
    }

    /// Merge LLM-typed relations into the graph.
    pub async fn save_relations(&self, kb_id: String, relations: Vec<KbRelation>) -> Result<(), String> {
        let graph_path = self.graph_path(&kb_id);
        let lock = graph_path.clone();
        with_file_lock(&lock, FileLockOptions::default(), move || {
            let mut graph: KbGraph = if graph_path.exists() {
                Self::read_json(&graph_path)?
            } else {
                KbGraph::default()
            };
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
        let matched_ids: HashSet<String> = entities.iter().map(|e| e.id.clone()).collect();
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

/// Tokenize text with the shared jieba tokenizer into lowercased tokens.
fn tokenize(text: &str) -> Vec<String> {
    use tantivy::tokenizer::{TokenStream, Tokenizer};
    let mut tokenizer = tantivy_jieba::JiebaTokenizer {};
    let mut stream = tokenizer.token_stream(text);
    let mut out = vec![];
    while let Some(t) = stream.next() {
        let s = t.text.trim().to_lowercase();
        if s.is_empty() || s.len() < 2 {
            continue;
        }
        // Skip pure punctuation / whitespace.
        if s.chars().all(|c| c.is_ascii_punctuation() || c.is_whitespace()) {
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

    // Top-N by frequency.
    let mut ranked: Vec<(&str, u32)> = freq.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(TOP_ENTITIES_PER_CHUNK);

    let entities: Vec<KbEntity> = ranked
        .iter()
        .map(|(label, _)| KbEntity {
            id: entity_id(chunk_id, label),
            label: label.to_string(),
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
        let subj = entity_id(chunk_id, &ranked[ai].0);
        let obj = entity_id(chunk_id, &ranked[bi].0);
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

fn entity_id(chunk_id: &str, label: &str) -> String {
    // Stable, chunk-scoped entity id: label prefixed with the chunk id.
    format!("{}:{}", chunk_id, label)
}

fn merge_entities(graph: &mut KbGraph, entities: Vec<KbEntity>) {
    let existing: HashSet<String> = graph.entities.iter().map(|e| e.id.clone()).collect();
    for e in entities {
        if existing.contains(&e.id) {
            continue;
        }
        graph.entities.push(e);
    }
}

fn merge_relations(graph: &mut KbGraph, relations: Vec<KbRelation>) {
    let existing: HashSet<(String, String, String)> = graph
        .relations
        .iter()
        .map(|r| (r.subject.clone(), r.object.clone(), r.relation_type.clone()))
        .collect();
    for mut r in relations {
        // A typed relation upgrades/overrides a cooccur edge between the same
        // subject/object pair.
        if let Some(prev) = graph.relations.iter_mut().find(|p| {
            p.subject == r.subject && p.object == r.object && !p.typed && r.typed
        }) {
            prev.relation_type = r.relation_type.clone();
            prev.typed = true;
            prev.weight = r.weight;
            continue;
        }
        let key = (r.subject.clone(), r.object.clone(), r.relation_type.clone());
        if existing.contains(&key) {
            continue;
        }
        r.typed = r.typed || r.relation_type != "cooccur";
        graph.relations.push(r);
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
pub async fn cmd_kb_graph(
    state: tauri::State<'_, Arc<KbEngine>>,
    kb_id: String,
) -> Result<KbGraphSummary, String> {
    let path = state.graph_path(&kb_id);
    let lock = path.clone();
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

/// Take pending relation-typing tasks for a KB.
pub async fn mgmt_kb_take_pending(
    engine: &Arc<KbEngine>,
    kb_id: String,
    limit: usize,
) -> Result<Vec<PendingRelationTask>, String> {
    engine.take_pending_relations(kb_id, limit).await
}

/// Save LLM-typed relations.
pub async fn mgmt_kb_save_relations(
    engine: &Arc<KbEngine>,
    kb_id: String,
    relations: Vec<KbRelation>,
) -> Result<(), String> {
    engine.save_relations(kb_id, relations).await
}

// ── tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skeleton_extracts_entities_and_cooccurrence_edges() {
        // Repeated Chinese words should surface as entities with a cooccur edge.
        let text = "知识图谱 知识图谱 实体 实体 关系 关系 知识图谱 实体";
        let (entities, relations, pairs) = build_skeleton("c1", text);

        assert!(!entities.is_empty(), "should extract entities");
        let labels: HashSet<&str> = entities.iter().map(|e| e.label.as_str()).collect();
        assert!(labels.contains("知识图谱"));
        assert!(labels.contains("实体"));

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
                sources: vec!["c1".into()],
            }],
            relations: vec![KbRelation {
                subject: "c1:a".into(),
                object: "c1:b".into(),
                relation_type: "cooccur".into(),
                weight: 2.0,
                typed: false,
            }],
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
}
