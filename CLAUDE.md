# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LexisLocal — a privacy-first, 100% offline PDF intelligence desktop app. Tauri 2.0 (Rust backend) + React/TS/Tailwind frontend, SurrealDB embedded for storage + vector search, and a local llama.cpp server for embeddings and chat. **Zero cloud dependencies** is a hard constraint: no API keys, no telemetry, no external network calls except to the user's own `localhost` llama-server.

## Commands

```bash
npm run tauri dev        # run the full desktop app (Vite + Rust, hot reload)
npm run dev              # frontend only (Vite) — no Tauri backend
npm run build            # tsc typecheck + vite production build
npx tsc --noEmit         # frontend typecheck only

cd src-tauri
cargo check -j 4         # backend typecheck. ALWAYS use -j 4 (see RAM note below)
cargo test -j 4 --lib chunk   # run the chunk_text self-check
```

**Always pass `-j 4` to cargo.** This machine has ~6.7 GB RAM; the full dependency tree (SurrealDB, Tauri) OOMs and appears to hang under default parallelism. `cargo check` was already cheap (~8s) once deps are built.

## Running the AI features

`ask` and PDF ingestion require a local llama.cpp server on `http://localhost:8080` serving OpenAI-compatible `/v1/embeddings` and `/v1/chat/completions` (one model used for both). Without it, ingestion and chat return a clear "is llama-server running?" error. The URL and embedding dimension are constants at the top of `src-tauri/src/ai.rs` (`LLAMA_URL`, `EMBED_DIM`).

## Architecture

**Backend (`src-tauri/src/`)** — Rust, organized as one concern per module:
- `lib.rs` — Tauri builder; `setup()` opens the DB and `manage()`s it as shared state; registers the `#[tauri::command]` handlers. `main.rs` just calls `run()`.
- `db.rs` — opens SurrealDB and runs the schema migration on every startup (idempotent `DEFINE`s). Returns `Surreal<Db>` (the engine markers like `SurrealKv` are *not* the handle type — `Db` is). The `chunks` M-TREE vector index dimension is built from `ai::EMBED_DIM` so there's one source of truth.
- `commands.rs` — the IPC surface: `ingest_pdf` (extract text → store doc → chunk → embed each → store chunks), `ask` (embed question → KNN vector search over chunks → assemble context → chat), `list_documents`.
- `ai.rs` — all llama.cpp HTTP calls (`embed`, `chat`) and pure `chunk_text` (1024 chars, 128 overlap). The only place that knows about the LLM.

**Data flow:** PDF bytes from frontend → `pdf_extract` → `documents` row → `chunk_text` → per-chunk `embed()` → `chunks` rows with vectors. Query: question → `embed()` → SurrealQL `embedding <|5|> $vec` KNN → top chunks become LLM context.

**Frontend (`src/`):** `App.tsx` holds all state (documents, selection, in-memory `bytesMap` of PDF bytes by id). Components are presentational: `FilePicker`, `DocumentList`, `PdfViewer` (PDF.js canvas), `ChatPanel` (calls the `ask` command). All backend calls go through `invoke()` from `@tauri-apps/api/core`.

## Conventions

- **Ponytail (full) is the default working mode.** Resist over-engineering: no speculative abstractions, stdlib/native before dependencies, shortest diff that works. Deliberate shortcuts are marked with `// ponytail:` comments naming the deferred work — grep for them to find the known-incomplete spots.
- **Phased build, strict order** — see `plan.md` for the canonical phase plan (1: PDF→DB pipeline, 2: RAG chat, 3: definitions/graph/hover, 4: liquid nav/anomalies). Don't pull later-phase features forward.
- Tauri commands return `Result<T, String>` — map errors with `.map_err(|e| e.to_string())`.

## Source-of-truth note

`plan.md` and `AGENTS.md` describe the original design and are **partly stale** vs. the implemented code. Where they conflict, the code wins. Known divergences made for build/runtime pragmatism:
- Storage engine is **SurrealKV** (`kv-surrealkv`), not RocksDB — RocksDB's C++ build exhausts this machine's RAM. Pure-Rust SurrealKV builds fast and is still on-disk persistent.
- **One** llama-server on port **8080** serving both embeddings and chat, not two models / port 8081.
- llama.cpp sidecar bundling + GGUF auto-download is **not implemented** — the server is assumed to be running. This is the main `ponytail:`-marked deferral.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Agent skills

### Issue tracker

Issues live in the repo's GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.
