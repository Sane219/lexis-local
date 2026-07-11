# Contributing

## Prerequisites

- **Rust** (latest stable via [rustup](https://rustup.rs/)) + [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)
  - On Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- **Node.js** 18+ (LTS recommended)
- **llama.cpp** `llama-server` binary on your `$PATH`
- A **GGUF model** supporting both `/v1/embeddings` and `/v1/chat/completions` (e.g. nomic-embed-text-v1.5, 768-dim)

## Setup

```bash
git clone https://github.com/your-org/lexis-local.git
cd lexis-local

# Install JavaScript dependencies
npm install

# Point at your GGUF model (defaults to ~/.cache/lexis/model.gguf)
export LEXIS_MODEL_PATH=/path/to/your/model.gguf

# Run in development mode
npm run tauri dev
```

The app auto-spawns `llama-server` on a free port. If the binary or model is missing, the app falls back to `http://localhost:8080` — start one manually:

```bash
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 --embeddings
```

## Development Commands

```bash
# Frontend dev server (Vite, hot-reload)
npm run dev

# Full typecheck + build
npm run build
npx tsc --noEmit

# Rust backend
cd src-tauri
cargo check -j 4
cargo test -j 4
cd ..

# Production build
npm run tauri build
```

> **Note:** Always pass `-j 4` to cargo on machines with less than 16 GB RAM to avoid OOM during linking.

## Project Structure

See [`docs/architecture.md`](./docs/architecture.md) for a full breakdown of the codebase.

## Code Conventions

- **Rust**: One concern per module (`db`, `commands`, `ai`, `lib`). Use `anyhow::Result` for fallible functions.
- **TypeScript/React**: `App.tsx` owns all state; components are presentational with explicit props. Prefer `useRef` + event delegation over per-element listeners.
- **Translucent text layer**: The PDF text overlay uses transparent spans with `user-select: text`. Never give them a background or visible text color.
- **Ponytail shortcuts**: Deliberate simplifications are marked `// ponytail:` with a comment explaining the ceiling and the upgrade path. Keep these honest.
- **Tests**: Rust tests live in `src-tauri/tests/` and use `tauri::test::mock_builder` for integration tests. Frontend testing is not yet set up.

## Pull Request Process

1. Open an issue describing what you're fixing or adding.
2. Fork the repo and create a feature branch.
3. Run `cargo test -j 4` and `npm run build` before submitting.
4. Keep changes focused. If you find yourself touching more than 3 modules, consider splitting into multiple PRs.
5. Update `docs/` if you change the public API or architecture.
