use anyhow::Result;
use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::Surreal;

pub async fn init_db(app_data_dir: &std::path::Path) -> Result<Surreal<Db>> {
    let db_path = app_data_dir.join("lexis.db");
    std::fs::create_dir_all(&db_path)?;

    let db = Surreal::new::<SurrealKv>(db_path).await?;
    db.use_ns("lexis").use_db("lexis").await?;

    let schema = format!(
        "{}\n
         DEFINE TABLE chunks SCHEMAFULL;
         DEFINE FIELD doc ON chunks TYPE record<documents>;
         DEFINE FIELD text ON chunks TYPE string;
         DEFINE FIELD page ON chunks TYPE int DEFAULT 1;
         DEFINE FIELD embedding ON chunks TYPE array<float>;
         DEFINE INDEX chunk_vec ON chunks FIELDS embedding MTREE DIMENSION {} DIST COSINE;

         DEFINE ANALYZER doc_text TOKENIZERS blank,class FILTERS lowercase;
         DEFINE INDEX chunk_text ON chunks FIELDS text SEARCH ANALYZER doc_text BM25;

          DEFINE TABLE definitions SCHEMAFULL;
          DEFINE FIELD doc ON definitions TYPE record<documents>;
          DEFINE FIELD term ON definitions TYPE string;
          DEFINE FIELD explanation ON definitions TYPE string;

          DEFINE TABLE same_term TYPE ANY;

         DEFINE TABLE sections SCHEMAFULL;
         DEFINE FIELD doc ON sections TYPE record<documents>;
         DEFINE FIELD label ON sections TYPE string;
         DEFINE FIELD page ON sections TYPE int;

         DEFINE TABLE refs SCHEMAFULL;
         DEFINE FIELD doc ON refs TYPE record<documents>;
         DEFINE FIELD source_label ON refs TYPE string;
         DEFINE FIELD target_label ON refs TYPE string;
         DEFINE FIELD page ON refs TYPE int;

         DEFINE TABLE chat_messages SCHEMAFULL;
         DEFINE FIELD doc ON chat_messages TYPE option<record<documents>>;
         DEFINE FIELD question ON chat_messages TYPE string;
         DEFINE FIELD answer ON chat_messages TYPE string;
         DEFINE FIELD page ON chat_messages TYPE option<int>;
         DEFINE FIELD created_at ON chat_messages TYPE datetime DEFAULT time::now();

         DEFINE TABLE simplifications SCHEMAFULL;
         DEFINE FIELD doc ON simplifications TYPE record<documents>;
         DEFINE FIELD page ON simplifications TYPE int;
         DEFINE FIELD original ON simplifications TYPE string;
         DEFINE FIELD simplified ON simplifications TYPE string;
         DEFINE FIELD created_at ON simplifications TYPE datetime DEFAULT time::now();",
        crate::documents::schema_ddl(),
        crate::ai::EMBED_DIM
    );
    db.query(schema).await?;

    Ok(db)
}
