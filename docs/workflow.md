# LexisLocal — Architecture & Workflow

## App Startup

```
lib.rs:run()
  ├── db::init_db() → SurrealDB (SurrealKV) at {app_data}/lexis.db
  │     Defines 5 tables: documents, chunks, definitions, sections, refs
  ├── spawn_llama() → llama-server sidecar on a free port
  │     Falls back to manual :8080 if binary/model missing
  └── Register 9 Tauri commands
```

## PDF Lifecycle (Ingest → Store → Query)

### 1. Ingest (`commands.rs:ingest_pdf`)

```
FilePicker → invoke("ingest_pdf", {name, bytes})
  │
  ├── pdf-extract::extract_text_from_mem() → raw_text  (Rust crate, no LLM)
  ├── Count pages via form-feed (\x0c) delimiters
  ├── Write {name, page_count, raw_text} → documents table
  │
  ├── Chunking (ai.rs:chunk_text):
  │     1024-char sliding window, 128 overlap, page-tagged by \x0c count
  │     For each chunk → embed() via llama-server /v1/embeddings → chunks table
  │     (INDEX: M-TREE 768d cosine for vector search, BM25 for text fallback)
  │
  ├── Definitions (ai.rs:extract_definitions):
  │     LLM call on first 6k chars → parse JSON array → definitions table
  │     (best-effort, no LLM call if prior steps fail)
  │
  └── Sections (ai.rs:extract_sections):
        Pure regex scan (section/article N(x)) → sections table + refs table
        First occurrence = heading (fixes page), later = backreference
```

### 2. Database Tables

Namespace `lexis`, database `lexis`. Backend: SurrealKV.

| Table | Fields | Purpose |
|-------|--------|---------|
| `documents` | id, name, page_count, raw_text, created_at | Raw ingested PDFs |
| `chunks` | id, doc→documents, text, page, embedding[768] | Vector + text search |
| `definitions` | id, doc→documents, term, explanation | Key term hover cards |
| `sections` | id, doc→documents, label, page | Section heading nav |
| `refs` | id, doc→documents, source_label, target_label, page | Cross-reference links |

Indexes on `chunks`:
- `chunk_vec` — M-TREE 768d COSINE on `embedding` (vector KNN search)
- `chunk_text` — BM25 on `text` (full-text fallback)
- Analyzer `doc_text`: TOKENIZERS blank,class; FILTERS lowercase

### 3. Query — Chat (`commands.rs:ask`)

```
ChatPanel → invoke("ask", {question})
  │
  ├── embed(question) → 768-dim query vector
  ├── M-TREE KNN: WHERE embedding <|5|> $qvec  (top 5 chunks)
  ├── BM25 fallback if 0 hits: WHERE text @@ $question LIMIT 5
  ├── Join top texts → LLM chat(question, context)
  └── Return { answer, page } → ChatPanel + PdfViewer jumps to page
```

### 4. Query — Definitions & References

```
Select doc → App loads via 3 parallel invokes:
  ├── list_definitions(docId) → definitions table → InsightsPanel + PdfViewer hover cards
  ├── list_sections(docId) → sections table → PdfViewer link targets
  └── list_references(docId) → refs table → InsightsPanel backlinks
```

### 5. Model Download (`commands.rs:download_model_llmfit`)

```
ModelLibrary → invoke("download_model_llmfit", {query:"mistral 7b"})
  │
  ├── shell().command("llmfit").args(["download", &query]).spawn()
  ├── Background task reads stdout/stderr lines
  │     Each line → emit("llmfit-progress", line) to frontend
  ├── On exit 0 → emit("llmfit-done")
  └── On error → emit("llmfit-error")
```

## Module Map

| Module | File | Role |
|--------|------|-------|
| **lib.rs** | `src-tauri/src/lib.rs` | Entry, plugins, sidecar lifecycle, command registration |
| **commands.rs** | `src-tauri/src/commands.rs` | 9 IPC commands (ingest, list, ask, detect, download) |
| **db.rs** | `src-tauri/src/db.rs` | Schema init (5 tables, 2 indexes, 1 analyzer) |
| **ai.rs** | `src-tauri/src/ai.rs` | Embedding client, chat completions, chunking, section regex, def extraction |
| **App.tsx** | `src/App.tsx` | Root layout, state orchestration, bytes cache |
| **PdfViewer.tsx** | `src/components/PdfViewer.tsx` | PDF.js canvas + text layer, hover cards, ref links, simplify |
| **ChatPanel.tsx** | `src/components/ChatPanel.tsx` | Chat input, message list, page navigation |
| **InsightsPanel.tsx** | `src/components/InsightsPanel.tsx` | Definitions list, cross-reference backlinks, anomaly check |
| **ModelLibrary.tsx** | `src/components/ModelLibrary.tsx` | 3 curated models, download with live progress |
| **FilePicker.tsx** | `src/components/FilePicker.tsx` | File input → Uint8Array → ingest |
| **DocumentList.tsx** | `src/components/DocumentList.tsx` | Sidebar list of ingested docs |

## Data Flow Diagram

```
PDF file ──▶ FilePicker ──▶ ingest_pdf ──▶ pdf-extract ──▶ documents (DB)
                               │                  │
                               ├── chunk_text ────┤
                               │     │             │
                               │     └── embed() ──┼──▶ chunks (DB) with M-TREE index
                               │                    │
                               ├── extract_definitions ──▶ definitions (DB)
                               │                    │
                               └── extract_sections ──▶ sections + refs (DB)

User question ──▶ ChatPanel ──▶ ask ──▶ embed() ──▶ M-TREE KNN ──▶ chat(LLM) ──▶ answer
                                              │                       │
                                              └── BM25 fallback ──────┘

Doc select ──▶ list_definitions ──▶ PdfViewer (hover cards)
            │─▶ list_sections ──▶ PdfViewer (link targets)
            └─▶ list_references ──▶ InsightsPanel (backlinks)
```

## Event Flow (Backend → Frontend)

| Event | Emitted By | Listened By | Payload |
|-------|------------|-------------|---------|
| `llmfit-progress` | `download_model_llmfit` | `ModelLibrary` | String (progress line) |
| `llmfit-done` | `download_model_llmfit` | `ModelLibrary` | "" |
| `llmfit-error` | `download_model_llmfit` | `ModelLibrary` | String (error message) |

## Chunking Strategy

```
Parameters: size=1024 chars, overlap=128 chars
Algorithm: sliding window over Vec<char>
Page tag: count \x0c (form-feed) before chunk start + 1
Empty chunks skipped
```

## llama-server Sidecar

```
Start: spawn_llama() in lib.rs setup
  ├── Bind 127.0.0.1:0 → free port
  ├── llama-server -m {MODEL_PATH} --host 127.0.0.1 --port {port} --embeddings
  ├── On success: set ai::BASE_URL, drain pipes in background
  └── On fail: fall back to manual server on :8080

Stop: kill child on RunEvent::Exit / ExitRequested
```

## Backend Commands Summary

| Command | Args | Returns | Purpose |
|---------|------|---------|---------|
| `ingest_pdf` | name, bytes | DocInfo | Full ingest pipeline |
| `list_documents` | — | Vec\<DocInfo\> | All documents |
| `ask` | question | AskResult | RAG query |
| `list_definitions` | doc_id | Vec\<Definition\> | Key terms |
| `detect_anomalies` | doc_id | String | LLM anomaly scan |
| `list_sections` | doc_id | Vec\<Section\> | Section headings |
| `list_references` | doc_id | Vec\<Reference\> | Cross-references |
| `simplify_text` | text | String | LLM plain-English rewrite |
| `download_model_llmfit` | query | String | Spawn llmfit download |
