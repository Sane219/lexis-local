# LexisLocal

> Privacy-first, 100% offline PDF intelligence on your desktop.

LexisLocal ingests your PDFs, lets you ask questions about them, and surfaces
definitions and anomalies — all without a single byte leaving your machine. No
API keys, no telemetry, no cloud. The only network call it ever makes is to a
llama.cpp server running on your own `localhost`, which it starts for you.

Built with **Tauri 2** (Rust) + **React/TypeScript/Tailwind**, **SurrealDB**
(embedded, with native vector search), and **llama.cpp** for local embeddings
and chat.

## Features

- **Local RAG chat** — ask questions about your documents; answers are grounded
  in the actual text via embedding + M-TREE vector search over chunks.
- **Selectable PDF text layer** — a pixel-aligned, natively-selectable text
  overlay on top of the PDF.js canvas (real bounding-box mapping).
- **Definitions** — key terms and explanations extracted on ingest.
- **Anomaly check** — flags contradictions, missing clauses, and unusual language.
- **Liquid navigation** — answers jump the viewer to the source page.
- **BM25 full-text fallback** when vector search comes up empty.
- **Auto-spawned AI backend** — the app boots its own `llama-server` on a free
  port and shuts it down on exit.

## Requirements

- [Rust](https://rustup.rs/) + the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
  (on Linux: `webkit2gtk`).
- Node.js 18+.
- A [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` binary on
  your `PATH`, and a local GGUF model that serves both chat and the
  `/v1/embeddings` endpoint (e.g. nomic-embed-text-v1.5, 768-dim).

## Quick start

```bash
npm install
npm run tauri dev
```

The app auto-spawns `llama-server` using the model at `MODEL_PATH` (top of
`src-tauri/src/lib.rs` — point this at your GGUF). If the binary or model isn't
found, the app still launches and falls back to a manually-run server on
`http://localhost:8080`.

## Development

```bash
npm run dev                       # frontend only (Vite)
npm run build                     # tsc typecheck + vite production build
npx tsc --noEmit                  # frontend typecheck

cd src-tauri
cargo check -j 4                  # backend typecheck (use -j 4 — see note)
cargo test -j 4                   # chunk_text + sidecar lifecycle tests
```

> **Low-RAM note:** the full Tauri/SurrealDB dependency tree is heavy. Always
> pass `-j 4` to cargo on memory-constrained machines to avoid OOM during the
> link step.

See [`plan.md`](./plan.md) for the phased build plan and current status, and
[`CLAUDE.md`](./CLAUDE.md) for architecture notes.

## Architecture

```
PDF bytes ─▶ pdf_extract ─▶ documents row
                              │
                              ├─▶ chunk_text (1024/128) ─▶ embed() ─▶ chunks (+ vector, page)
                              └─▶ extract_definitions ─▶ definitions

ask(question) ─▶ embed ─▶ KNN vector search (M-TREE) ─▶ context ─▶ chat ─▶ answer (+ page)
```

- `src-tauri/src/` — Rust backend, one concern per module (`db`, `commands`,
  `ai`, `lib`).
- `src/` — React frontend; `App.tsx` holds state, components are presentational.

## License

[MIT](./LICENSE)
