//! Tantivy schema for the knowledge base full-text index.
//!
//! This is a SEPARATE index from `crate::search::schema` (session/file search).
//! It reuses the shared jieba tokenizer registered under
//! `crate::search::tokenizer::TOKENIZER_NAME` so Chinese text is segmented the
//! same way at index and query time.

use tantivy::schema::*;

use crate::search::TOKENIZER_NAME;

/// Bump when the field list or tokenizer wiring changes; existing per-KB
/// indices are rebuilt on mismatch.
pub const KB_SCHEMA_VERSION: u32 = 1;

fn chinese_text_options() -> TextOptions {
    TextOptions::default().set_stored().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(TOKENIZER_NAME)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    )
}

/// Build the KB index schema.
pub fn kb_schema() -> (Schema, KbFields) {
    let mut builder = Schema::builder();

    let text_opts = chinese_text_options();

    let kb_id = builder.add_text_field("kb_id", STRING | STORED);
    let chunk_id = builder.add_text_field("chunk_id", STRING | STORED);
    let title = builder.add_text_field("title", text_opts.clone());
    let content = builder.add_text_field("content", text_opts);

    let schema = builder.build();
    let fields = KbFields {
        kb_id,
        chunk_id,
        title,
        content,
    };

    (schema, fields)
}

/// Named field handles for the KB index.
#[derive(Clone)]
pub struct KbFields {
    pub kb_id: Field,
    pub chunk_id: Field,
    pub title: Field,
    pub content: Field,
}
