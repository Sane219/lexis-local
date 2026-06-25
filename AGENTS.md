# LexisLocal — Agent Guide

**Mission:** Privacy-first, 100% offline PDF intelligence desktop app.
**Stack:** Tauri 2.0 | React/TS/Tailwind/Radix | PDF.js | SurrealDB (RocksDB) | llama.cpp sidecar | nomic-embed-text-v1.5

## Hard Constraints

- **No Electron.** Tauri 2.0 only.
- **Zero cloud dependencies.** Every byte stays local. No API keys, no telemetry, no external services.
- **Ponytail mode (full) is the default.** Resist over-engineering at every step. See `plan.md` for phase-specific ponytail notes.
- **Phase order is strict.** Do not implement Phase 2 features during Phase 1. Phase 1 proves PDF → SurrealDB pipeline only — no chunking, no embeddings, no AI.

## Phases

| Phase | Goal | What to build | Ponytail rule |
|-------|------|---------------|---------------|
| 1 | Core PoC | Tauri scaffold, SurrealDB init, PDF render, text extraction → DB | No chunking/embeddings/graphs |
| 2 | RAG PoC | llama.cpp sidecar, chunking, embeddings, vector search, chat UI | Single model, no reranking, no history |
| 3 | Graph & Hover | Definition extraction, graph edges, hover cards with PDF coords | No real-time re-analysis, exact match only |
| 4 | Liquid Nav | Chat-driven viewport scroll, anomaly detection, multi-doc graph | — |

## Key Technical Decisions (locked in `plan.md`)

- SurrealDB embedded via **RocksDB** (`surrealdb = { version = "2", features = ["kv-rocksdb"] }`)
- SurrealDB namespace: `lexis`, database: `lexis`
- llama.cpp runs as **Tauri sidecar** exposing OpenAI-compatible REST API on port 8081
- Embeddings: CPU-only via nomic-embed-text-v1.5 through llama.cpp `/embeddings` endpoint
- Chunk size: 1024 chars, 128 char overlap
- PDF text extraction: `pdf-extract` crate on Rust side
- PDF rendering: PDF.js on canvas (frontend)
- Schema on startup via `DEFINE TABLE documents SCHEMAFULL`

## Directory Layout (target)

```
lexis-local/
├── src/                          # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── PdfViewer.tsx
│   │   ├── FilePicker.tsx
│   │   └── DocumentList.tsx
│   ├── hooks/
│   │   └── useTauriCommand.ts
│   └── styles/
│       └── globals.css
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs
│   │   ├── db.rs
│   │   ├── commands.rs
│   │   └── extractor.rs
│   └── capabilities/
└── package.json
```

## Startup (Phase 1)

```bash
npx create-tauri-app lexis-local --template react-ts --manager npm
cd lexis-local
npm install @radix-ui/react-dialog @radix-ui/react-tooltip \
  @radix-ui/react-scroll-area tailwindcss @tailwindcss/vite
```

Add SurrealDB + pdf-extract to `src-tauri/Cargo.toml` — see `plan.md` for exact deps.

## Source of Truth

- `plan.md` — full execution plan with inline code snippets for `db.rs`, `commands.rs`, `main.rs`, `PdfViewer.tsx`
- This file captures intent and constraints. If anything conflicts, `plan.md` wins.

## Current State

Pre-scaffold. Only `plan.md` and `AGENTS.md` exist. No git repo. No CI/CD.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
