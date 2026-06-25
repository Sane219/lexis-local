# LexisLocal — Execution Plan

**Mission:** Privacy-first, 100% offline PDF intelligence desktop app.
**Stack:** Tauri 2.0 | React/TS/Tailwind/Radix | PDF.js | SurrealDB (embedded) | llama.cpp sidecar | nomic-embed-text-v1.5

---

## 0. Status (as built)

| Phase | State | Notes |
|-------|-------|-------|
| 1 — Core PoC | ✅ Done | PDF → text → SurrealDB pipeline, PDF.js render. **SurrealKV** instead of RocksDB (C++ build OOMs this machine). |
| 2 — RAG PoC | ✅ Done | Chunk → embed → M-TREE vector search → chat. **Sidecar auto-spawn done** (2.1/2.2): `lib.rs` boots `llama-server` on a free port via `tauri-plugin-shell` and kills it on `RunEvent::Exit` (verified by `tests/sidecar.rs`); falls back to a manual :8080 server if the binary/model is missing. GGUF JIT-download still deferred (model path hardcoded). |
| 3 — Graph & Hover | ✅ Done | Definition extraction + storage + `InsightsPanel`. **PDF.js text-layer overlay done** (3.4): `PdfViewer` renders a transparent, natively-selectable `TextLayer` pixel-aligned to the canvas (verified in real Chromium — 0px layer/canvas delta, 100% spans inside canvas). **Deferred:** `RELATE` graph edges (a `doc` field + query covers the lookup). |
| 4 — Liquid Nav & Anomalies | ◑ Partial | Per-chunk page numbers (4.1), chat answer jumps the viewer to the top chunk's page (4.2), anomaly-detection command + button (4.3), BM25 full-text fallback in `ask` (4.5). **Deferred:** explicit multi-doc graph merge (4.4). |

Build with `cargo check -j 4` (RAM-constrained — see CLAUDE.md). All phases compile; `chunk_text` has a self-check.

---

## 1. Phased Master Plan

### Phase 1: Core PoC — "PDF renders, data exists"
**Goal:** Tauri window opens, PDF renders via PDF.js, a document is "ingested" into SurrealDB.

| Step | What | Deliverable |
|------|------|-------------|
| 1.1 | Scaffold Tauri 2.0 + React + TypeScript + Tailwind | `cargo tauri init`, Vite React TS template |
| 1.2 | Embed SurrealDB in Rust backend (RocksDB) | SurrealDB `with rocksdb` init on app start |
| 1.3 | Build PDF upload/selection UI | File picker → renders first page via PDF.js canvas |
| 1.4 | Define SurrealDB schema for `documents` table | SQL migration on startup: `DEFINE TABLE documents` with id, name, page_count, raw_text |
| 1.5 | Extract raw text from PDF (worker thread) | Tauri command: extract text via pdf-extract or pdf.js text content API piped to Rust |
| 1.6 | Store extracted text in SurrealDB | `INSERT INTO documents { ... }` |
| 1.7 | Verify pipeline: file in → text in DB | App shows "Ingested" status |

**ponytail:** No chunking, no embeddings, no graph edges. Just raw text storage. Skip the AI entirely.

---

### Phase 2: RAG & AI PoC — "Ask questions about your PDF"
**Goal:** Type a question → chunk + embed → vector search → LLM answer.

| Step | What | Deliverable |
|------|------|-------------|
| 2.1 | Bundle llama.cpp as Tauri sidecar | `tauri-plugin-shell` sidecar config, JIT-download GGUF model on first launch |
| 2.2 | Start llama.cpp REST server on app boot | Tauri command spawns sidecar with `--server --port 8081` |
| 2.3 | Chunk document text into overlapping segments | Rust function: `chunk_text(raw: &str) -> Vec<Chunk>` (1024 chars, 128 overlap) |
| 2.4 | Define SurrealDB `DEFINE TABLE chunks` with `DEFINE INDEX vector_idx ON chunks FIELDS vector M-TREE` | Schema with native vector index |
| 2.5 | Generate embeddings via CPU (nomic-embed-text-v1.5 via llama.cpp embeddings endpoint) | Tauri Rust client: POST `/embeddings` → store in SurrealDB |
| 2.6 | Build RAG query flow: question → embed → vector search → prompt → LLM → answer | Full loop via Rust orchestration |
| 2.7 | Chat UI component (Radix textarea + scrollable messages) | React component, calls Tauri command, streams answer |

**ponytail:** Single-model. No hybrid search. No reranking. No session history beyond current chat.

---

### Phase 3: Graph & Semantic Hover — "PDFs that talk to each other"
**Goal:** Definitions detected, cross-references built, hover over term → see source.

| Step | What | Deliverable |
|------|------|-------------|
| 3.1 | `DEFINE TABLE definitions` in SurrealDB | Schema for term, explanation, source_chunk_id |
| 3.2 | LLM-driven definition extraction on ingest | Prompt: "extract key terms and their definitions from this text" |
| 3.3 | SurrealDB graph edges: `RELATE chunk->references->definition` | Native graph traversal for cross-refs |
| 3.4 | Text layer overlay on PDF.js canvas | Map bounding boxes from PDF.js text content to `<span>` overlays |
| 3.5 | Semantic hover card: hover on term → card appears with definition + sources | React popover component, query via Tauri command |
| 3.6 | Bidirectional cross-referencing | "Referenced by" and "References" sections in hover card |

**ponytail:** No real-time re-analysis. Definitions extracted once at ingest. No fuzzy term matching—exact match only.

---

### Phase 4: Liquid Navigation & Anomalies — "Chat drives the viewport"
**Goal:** Ask "Show me the indemnification clause" → viewport scrolls there. Anomaly detection flags inconsistencies.

| Step | What | Deliverable |
|------|------|-------------|
| 4.1 | Store per-chunk page numbers + bounding boxes | Extend chunk schema with `page_num`, `bbox` |
| 4.2 | Chat-to-viewport mapping: LLM returns chunk IDs → scroll PDF to that chunk | Tauri command `scroll_to_chunk(id)` → frontend navigates PDF.js |
| 4.3 | Anomaly detection prompt | "Find contradictions, missing clauses, unusual language" → highlight regions |
| 4.4 | Multi-document graph merge | Ingest multiple PDFs → cross-doc definition graph |
| 4.5 | Full-text search fallback | SurrealDB search index on chunks for terms not in vector top-k |

---

## 2. Skill Mapping & Delegation

### Phase 1 — Skills Activated

| Task | Skill | Why |
|------|-------|-----|
| Architecture design, ADRs | `senior-architect` | System decomposition, Tauri 2.0 component boundaries |
| Project scaffolding, build config | `senior-fullstack` | `create-tauri-app`, Vite React TS setup, Tailwind init |
| Rust backend, SurrealDB embed | `senior-backend` | SurrealDB init with RocksDB, Tauri commands, SQL schema |
| React UI, PDF.js integration | `senior-frontend` | File picker, PDF canvas rendering, basic layout |
| Data pipeline design | `senior-data-engineer` | Document → text extraction → SurrealDB insert flow |
| Build/packaging | `senior-devops` | Tauri sidecar config, build scripts |
| **Ponytail enforcement** | `ponytail (full)` | No chunking, no AI, no graphs — pure pipeline proof |

### Phase 2 — Skills Activated

| Task | Skill | Why |
|------|-------|-----|
| llama.cpp sidecar integration | `senior-ml-engineer` | GGUF model download, server lifecycle, embeddings API |
| RAG prompt templates | `senior-prompt-engineer` | Context assembly, system prompt, answer formatting |
| Chunking & embedding pipeline | `senior-data-engineer` | Overlapping chunk strategy, batch embedding, vector DB insert |
| Vector search implementation | `senior-backend` | SurrealDB M-Tree index, cosine similarity query |
| Chat UI, streaming responses | `senior-frontend` | Radix components, streaming text render, message list |
| End-to-end test | `senior-qa` | Verify: ingest → question → answer pipeline |
| Security audit (local-only) | `senior-security` | Verify no data leaves the machine, sidecar sandboxing |

---

## 3. First Actionable Step

### Initialize Phase 1 — Today

```bash
# 1. Install prerequisites (skip if already present)
rustup update stable
cargo install create-tauri-app
cargo install tauri-cli --version "^2.0"

# 2. Scaffold the project
npx create-tauri-app lexis-local --template react-ts --manager npm
cd lexis-local

# 3. Install frontend deps
npm install @radix-ui/react-dialog @radix-ui/react-tooltip \
  @radix-ui/react-scroll-area tailwindcss @tailwindcss/vite \
  react-pdf-pages

# 4. Init Tailwind
npx tailwindcss init -p

# 5. Add SurrealDB to Rust deps
# Edit src-tauri/Cargo.toml
```

### Directory Structure (Phase 1)

```
lexis-local/
├── src/                          # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── PdfViewer.tsx         # PDF.js canvas wrapper
│   │   ├── FilePicker.tsx        # File upload / open dialog
│   │   └── DocumentList.tsx      # Shows ingested docs
│   ├── hooks/
│   │   └── useTauriCommand.ts    # Typed Tauri invoke wrapper
│   └── styles/
│       └── globals.css
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs               # Tauri entry, SurrealDB init
│   │   ├── db.rs                 # SurrealDB connection + schema
│   │   ├── commands.rs           # Tauri IPC commands
│   │   └── extractor.rs          # PDF text extraction (pdf-extract)
│   └── capabilities/
└── package.json
```

### SurrealDB Initialization Code

**`src-tauri/Cargo.toml` dependencies:**
```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
surrealdb = { version = "2", features = ["kv-rocksdb"] }
tokio = { version = "1", features = ["full"] }
pdf-extract = "0.7"
anyhow = "1"
```

**`src-tauri/src/db.rs` — SurrealDB init + schema:**
```rust
use anyhow::Result;
use surrealdb::engine::local::RocksDb;
use surrealdb::Surreal;

pub async fn init_db(app_data_dir: &std::path::Path) -> Result<Surreal<RocksDb>> {
    let db_path = app_data_dir.join("lexis.db");
    std::fs::create_dir_all(&db_path)?;

    let db = Surreal::new::<RocksDb>(db_path).await?;
    db.use_ns("lexis").use_db("lexis").await?;

    // Schema migration
    let schema = "
        DEFINE TABLE documents SCHEMAFULL;
        DEFINE FIELD name ON documents TYPE string;
        DEFINE FIELD page_count ON documents TYPE int;
        DEFINE FIELD raw_text ON documents TYPE string;
        DEFINE FIELD created_at ON documents TYPE datetime DEFAULT time::now();
    ";
    db.query(schema).await?;

    Ok(db)
}
```

**`src-tauri/src/commands.rs` — Tauri IPC command:**
```rust
use surrealdb::Surreal;
use surrealdb::engine::local::RocksDb;
use tauri::State;
use serde::Serialize;

#[derive(Serialize)]
pub struct Document {
    pub id: String,
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
}

#[tauri::command]
pub async fn ingest_pdf(
    db: State<'_, Surreal<RocksDb>>,
    path: String,
) -> Result<Document, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(&path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    // count pages (approximate via \x0c form feeds)
    let page_count = text.matches('\x0c').count() as u32 + 1;

    let doc: Document = db
        .create("documents")
        .content(Document {
            id: String::new(),
            name,
            page_count,
            raw_text: text,
        })
        .await
        .map_err(|e| e.to_string())?;

    Ok(doc)
}
```

**`src-tauri/src/main.rs`:**
```rust
mod db;
mod commands;

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().unwrap();
            let db = tauri::async_runtime::block_on(db::init_db(&app_data_dir)).unwrap();
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ingest_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**`src/components/PdfViewer.tsx` — Minimal PDF.js render:**
```tsx
import { useEffect, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

interface PdfViewerProps {
  file: Uint8Array;
  pageNum?: number;
}

export function PdfViewer({ file, pageNum = 1 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    (async () => {
      const pdf = await pdfjs.getDocument({ data: file }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    })();
  }, [file, pageNum]);

  return <canvas ref={canvasRef} className="w-full border shadow-sm" />;
}
```

---

## Execution Cadence

```
Day  1: Phase 1 scaffold + SurrealDB init + PDF render
Day  2: Phase 1 text extraction → DB pipeline
Day  3: Phase 2 llama.cpp sidecar + chunking
Day  4: Phase 2 embeddings + vector search
Day  5: Phase 2 RAG chat UI
Day  6: Phase 3 definition extraction + graph edges
Day  7: Phase 3 hover cards + coordinate mapping
Day  8: Phase 4 liquid navigation + anomaly detection
Day  9: Polish, test, package
```

**Start with Phase 1. Run the scaffold command above.**
