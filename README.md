# LexisLocal

> Privacy-first, 100% offline PDF intelligence for your desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.85+-orange)](https://rustup.rs/)
[![Tauri](https://img.shields.io/badge/Tauri-2-blueviolet)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)

LexisLocal ingests your PDFs, extracts text and definitions, chunks and embeds everything locally, and lets you ask natural-language questions about your documents — **all without a single byte leaving your machine**. No API keys, no telemetry, no cloud. The only network call is to a `llama-server` process on your own `localhost`.

## Features

- **Local RAG Chat** — Ask questions about your documents. Answers are grounded in the actual text via embedding similarity search (M-TREE vector index) with BM25 full-text fallback.
- **Pixel-Perfect PDF Viewer** — A canvas-rendered PDF with a transparent, natively-selectable text overlay via PDF.js. Every text span lines up 1:1 with its canvas bitmap.
- **Smart Definitions** — Key terms and explanations extracted automatically on ingest via LLM, displayed as hover cards over the PDF text layer.
- **Anomaly Detection** — Flags contradictions, missing clauses, and unusual language in your documents.
- **Liquid Navigation** — Answers include the source page number; clicking jumps the PDF viewer directly to that page.
- **Auto-Spawned AI** — The app boots its own `llama-server` sidecar on a free port and shuts it down on exit.
- **Embedded Database** — SurrealDB with SurrealKv engine. Zero configuration, no separate server process.
- **Section Extraction** — Pure-regex section heading detection with cross-reference tracking between sections.

## Quick Start

```bash
# Prerequisites: Rust, Node.js 18+, llama-server on PATH + a GGUF model

git clone https://github.com/your-org/lexis-local.git
cd lexis-local
npm install

# Point at your GGUF model (defaults to ~/.cache/lexis/model.gguf)
export LEXIS_MODEL_PATH=/path/to/your/model.gguf

npm run tauri dev
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for detailed setup instructions and development commands.

## Requirements

- **Rust** (latest stable) + [Tauri 2 system deps](https://v2.tauri.app/start/prerequisites/)
- **Node.js** 18+
- **llama-server** binary (from [llama.cpp](https://github.com/ggml-org/llama.cpp)) on `$PATH`
- A **GGUF model** supporting `/v1/embeddings` and `/v1/chat/completions` (e.g. [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF), 768-dim)

## Architecture

```
PDF bytes ─▶ pdf_extract ─▶ documents table
                              │
                              ├─▶ chunk_text (1024/128) ─▶ embed() ─▶ chunks (+ vector, page)
                              └─▶ extract_definitions ─▶ definitions table

ask(question) ─▶ embed ─▶ M-TREE KNN search ─▶ context ─▶ chat ─▶ answer (+ page)
```

**Stack:** Tauri 2 (Rust) · React 19 / TypeScript / Tailwind 4 · SurrealDB (SurrealKv) · PDF.js 6 · llama.cpp (sidecar)

## Documentation Hub

| Document | Description |
|----------|-------------|
| [`docs/architecture.md`](./docs/architecture.md) | System architecture with Mermaid diagrams and data flow |
| [`docs/api-reference.md`](./docs/api-reference.md) | Tauri commands, HTTP endpoints, and SurrealDB schema |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Developer onboarding, setup, and code conventions |
| [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) | Community guidelines |
| [`plan.md`](./plan.md) | Phased build plan and current status |
| [`CLAUDE.md`](./CLAUDE.md) | Agent guide and architecture constraints |

## Development

```bash
npm run dev            # Frontend only (Vite hot-reload)
npm run build          # tsc typecheck + Vite production build
npx tsc --noEmit       # Frontend typecheck only

cd src-tauri && cargo check -j 4 && cargo test -j 4 && cd ..
```

> Low-RAM note: use `-j 4` with cargo on machines with <16 GB to avoid OOM.

## License

[MIT](./LICENSE)
