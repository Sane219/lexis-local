// The single owner of the Document shape across its lifecycle: the insert
// payload, the persisted record, and the frontend-facing info. Previously
// `DocRecord`/`DocInfo`/`NewDocument` were declared three times in
// commands.rs; one module, one source of truth, conversions between stages.
use serde::{Deserialize, Serialize};
use surrealdb::sql::Thing;

/// Insert payload written on ingest.
#[derive(Debug, Serialize)]
pub struct NewDocument {
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
}

/// Row materialised back from SurrealDB.
#[derive(Debug, Serialize, Deserialize)]
pub struct DocRecord {
    pub id: Thing,
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
    pub created_at: String,
}

/// What the frontend receives.
#[derive(Debug, Serialize)]
pub struct DocInfo {
    pub id: String,
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
    pub created_at: String,
}

impl DocInfo {
    pub fn from_record(r: DocRecord) -> DocInfo {
        DocInfo {
            id: r.id.to_string(),
            name: r.name,
            page_count: r.page_count,
            raw_text: r.raw_text,
            created_at: r.created_at,
        }
    }
}

/// The `documents` table shape, declared once. The schema builder in `db.rs`
/// calls this so the SurrealQL `DEFINE FIELD` list can't drift from the Rust
/// struct above.
pub fn schema_ddl() -> String {
    let fields: &[(&str, &str)] = &[
        ("name", "string"),
        ("page_count", "int"),
        ("raw_text", "string"),
        ("created_at", "datetime DEFAULT time::now()"),
    ];
    let defines = fields
        .iter()
        .map(|(name, ty)| format!("DEFINE FIELD {name} ON documents TYPE {ty};"))
        .collect::<Vec<_>>()
        .join("\n         ");
    format!("DEFINE TABLE documents SCHEMAFULL;\n         {defines}")
}
