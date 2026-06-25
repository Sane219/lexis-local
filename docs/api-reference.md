# API Reference

LexisLocal exposes a set of **Tauri commands** callable from the frontend via `invoke()` from `@tauri-apps/api/core` and a **local HTTP API** from the llama.cpp sidecar for AI operations.

## Tauri Commands

The frontend communicates with the Rust backend through `@tauri-apps/api/core`'s `invoke` function:

```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<T>("command_name", { arg1: value1 });
```

### ingest_pdf

Extract text from a PDF, chunk and embed it, extract definitions and sections, and store everything in SurrealDB.

**Signature:**
```rust
#[tauri::command]
pub async fn ingest_pdf(db: State<'_, Surreal<Db>>, name: String, bytes: Vec<u8>) -> Result<DocInfo, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Original filename of the PDF |
| `bytes` | `Uint8Array` | Raw PDF bytes |

**Returns:** `DocInfo`
```typescript
{
  id: string;        // SurrealDB record ID (e.g. "documents:abc123")
  name: string;      // Original filename
  page_count: number;
  raw_text: string;  // Extracted plain text
  created_at: string; // ISO-8601 timestamp
}
```

**Side effects:** Creates records in `documents`, `chunks` (with embeddings), `definitions`, `sections`, and `refs` tables.

### list_documents

List all ingested documents ordered by creation date (newest first).

**Signature:**
```rust
#[tauri::command]
pub async fn list_documents(db: State<'_, Surreal<Db>>) -> Result<Vec<DocInfo>, String>
```

**Parameters:** None

**Returns:** `DocInfo[]`

### ask

Ask a question about your documents. Embeds the question, performs vector search (with BM25 fallback), and returns an LLM-generated answer.

**Signature:**
```rust
#[tauri::command]
pub async fn ask(db: State<'_, Surreal<Db>>, question: String) -> Result<AskResult, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `question` | `string` | Natural language question |

**Returns:** `AskResult`
```typescript
{
  answer: string;   // LLM-generated answer
  page: number | null; // Page number of the top matching chunk
}
```

### list_definitions

Retrieve extracted definitions for a document.

**Signature:**
```rust
#[tauri::command]
pub async fn list_definitions(db: State<'_, Surreal<Db>>, doc_id: String) -> Result<Vec<Definition>, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `doc_id` | `string` | Document record ID |

**Returns:** 
```typescript
{ term: string; explanation: string }[]
```

### detect_anomalies

Run anomaly detection on a document's text via LLM.

**Signature:**
```rust
#[tauri::command]
pub async fn detect_anomalies(db: State<'_, Surreal<Db>>, doc_id: String) -> Result<String, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `doc_id` | `string` | Document record ID |

**Returns:** `string` — bullet-point analysis or "None found"

### list_sections

List sections extracted from a document.

**Signature:**
```rust
#[tauri::command]
pub async fn list_sections(db: State<'_, Surreal<Db>>, doc_id: String) -> Result<Vec<Section>, String>
```

**Returns:**
```typescript
{ label: string; page: number }[]
```

### list_references

List cross-references between sections.

**Signature:**
```rust
#[tauri::command]
pub async fn list_references(db: State<'_, Surreal<Db>>, doc_id: String) -> Result<Vec<Reference>, String>
```

**Returns:**
```typescript
{ source_label: string; target_label: string; page: number }[]
```

## Local HTTP API (llama.cpp)

The sidecar exposes an OpenAI-compatible REST API on `localhost`. The app auto-spawns `llama-server` on a free port during startup.

### POST /v1/embeddings

Generate embeddings for text input.

**Request:**
```json
{ "input": "text to embed" }
```

**Response:**
```json
{
  "data": [{ "embedding": [0.001, ...] }]
}
```

Dimension: 768 (nomic-embed-text-v1.5)

### POST /v1/chat/completions

Generate a chat completion.

**Request:**
```json
{
  "messages": [{ "role": "user", "content": "prompt" }],
  "stream": false
}
```

**Response:**
```json
{
  "choices": [{ "message": { "content": "answer text" } }]
}
```

## SurrealDB Schema

The following tables are defined at startup in `db.rs`:

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `documents` | `name`, `page_count`, `raw_text`, `created_at` | PDF metadata and raw text |
| `chunks` | `doc`, `text`, `page`, `embedding` | Text chunks with vector index |
| `definitions` | `doc`, `term`, `explanation` | Extracted term definitions |
| `sections` | `doc`, `label`, `page` | Section headings |
| `refs` | `doc`, `source_label`, `target_label`, `page` | Cross-section references |

The `chunks` table has:
- An **M-TREE vector index** on `embedding` (768-dim, cosine distance) for similarity search
- A **BM25 full-text index** on `text` for fallback search
