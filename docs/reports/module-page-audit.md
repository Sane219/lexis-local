# Module / Page Audit — LexisLocal

One-line summary: all four `plan.md` phases are technically "done" and every
page has real backend data behind it, but the frontend is mid-refactor
(`InsightsPanel.tsx` was just folded into `KnowledgePanel.tsx`) and lost one
feature (anomaly detection UI) in the move; beyond that, most pages are thin
single-purpose views that don't yet surface data the backend already computes
(cross-doc graph edges, BM25 fallback, per-model verify commands, sidecar
health).

## In-flight refactor context (read this before the rest)

Per `git status` / `git diff --stat` at audit time, the working tree has
uncommitted changes to `src-tauri/src/lib.rs`, `src-tauri/src/models.rs`,
`src/App.tsx`, `src/components/ChatPanel.tsx`, `src/components/KnowledgePanel.tsx`,
`src/components/ModelLibrary.tsx`, `src/modules.tsx`, and a **deletion** of
`src/components/InsightsPanel.tsx` (177 lines removed).

`git log -p --follow -- src/components/InsightsPanel.tsx` shows `InsightsPanel`
was the original Phase 3/4 "Knowledge" surface: definitions, cross-references
(backlinks), cross-document links, and a "Check anomalies" button that called
`detect_anomalies`. Diffing it against the current `src/components/KnowledgePanel.tsx`
(read via `git show HEAD:...` vs. working tree) confirms the definitions,
references, and cross-doc sections were **carried forward** (now as tabs, plus
a new SVG graph-preview tab that didn't exist in `InsightsPanel`). What was
**not** carried forward: the "Check anomalies" button and its `detect_anomalies`
call (`InsightsPanel.tsx:76-92` in the pre-deletion version). The backend
command (`src-tauri/src/commands.rs:76-83`, `detect_anomalies`) and its
registration in `src-tauri/src/lib.rs:133` are both still present and wired —
this is backend capability with no remaining frontend entry point. Treat this
as a regression to restore, not a "missing page" to design from scratch.

`ModelLibrary.tsx` also shows the largest uncommitted diff (1008 lines changed)
— it appears to have grown from a simpler installer into the current
hardware-aware hub (`llmfit recommend`/`search`/`info` integration). This is
consistent with the current file being fairly complete already (see below).

## Current pages/modules

Module registry: `src/modules.tsx:1-9` (`ViewId` union: `home | documents |
reader | chat | knowledge | models`) and `src/modules.tsx:89-96` (`MODULES`
array feeding `NavRail` and `Home`). Routing is a single `view` state var in
`src/App.tsx:52` switched over in `src/App.tsx:204-303` — no router, no
per-page URL, no deep-linking.

### Home (`src/components/Home.tsx`)

**What it does now:** A single dashboard (`Home.tsx:13-54`) rendering a
first-run onboarding checklist (`Onboarding`, `Home.tsx:59-153`: install
tools → download model → open PDF, driven live off `tool_status` and
`list_downloaded_models` via Tauri events `dependency-install`/`llmfit-done`)
plus a grid of module tiles with live stat badges (`Home.tsx:14-20`: doc
count, model count, term count, open doc name).

**Gaps:**
- No recent-documents list or "continue reading" — it only shows a count,
  not which doc, even though `App.tsx` already tracks `selected`.
- No global search across ingested documents (no such backend command
  exists either — see Missing Pages).
- Stats are recomputed from whichever document happens to be `selected`
  (`App.tsx:57`, `definitions.length`) — "terms" badge reflects one open
  doc's definitions, not a library-wide term count. Misleading once >1
  doc is ingested.
- Onboarding never gets a fourth step for "ask a question" — a user can
  complete steps 1–3 and still not know Chat exists.

**Recommendations:** Add a "recent documents" strip (data already in
`documents` state, just needs surfacing beyond the count); make the terms
badge a true `COUNT` query across all docs (needs a new lightweight backend
command, e.g. `count_definitions()` doing `SELECT count() FROM definitions
GROUP ALL` — cheap, avoids shipping every definition to compute a badge);
add a 4th onboarding step for first chat message.

### Documents (`App.tsx:217-230`, list component `src/components/DocumentList.tsx`)

**What it does now:** A bare list of ingested docs (name + page count,
`DocumentList.tsx:26-47`) with an "Open PDF" button in the header
(`App.tsx:221-226`). Clicking a row calls `handleSelect` (`App.tsx:184-191`)
which switches to Reader.

**Gaps:**
- No delete/remove document action — there's no backend command for it
  either (`commands.rs` has no `delete_document`), so a mis-ingested PDF is
  permanent until the SurrealKV file is manually edited.
- No search/filter/sort (by name, date, size) even at small scale.
- No metadata beyond page count — `created_at` is fetched
  (`App.tsx:20`, `DocInfo.created_at`) but never rendered anywhere in the UI.
- No indication of ingestion-in-progress state per document (only a
  transient global `status` string in the nav rail, `App.tsx:62-63`).
- No file-size or embedding-count display (chunk count would confirm the
  doc was actually indexed for chat, not just text-extracted).

**Recommendations:** Show `created_at` (already fetched, unused); add a
delete action + matching `delete_document` Tauri command (mirror the
`delete_model` pattern in `lib.rs:90-102`/`models.rs:704-720` — refuse to
delete active/mid-ingest docs); add per-doc chunk count (`SELECT count()
FROM chunks WHERE doc = $doc`) as a "ready for chat" indicator; add a
search box once doc count grows past a page.

### Reader (`App.tsx:232-279`, viewer `src/components/PdfViewer.tsx`)

**What it does now:** The most fully-built page. Canvas + PDF.js `TextLayer`
overlay (`PdfViewer.tsx:101-186`) with: hover/focus term-definition cards via
Radix Tooltip (`PdfViewer.tsx:313-344`), clickable cross-reference spans that
jump pages (`PdfViewer.tsx:188-192`, `214-223`), text-selection → "Simplify"
button calling `simplify_text` with results appended to a margin notes
column (`PdfViewer.tsx:234-246`, `364-381`), zoom/fit-width controls
(`PdfViewer.tsx:225-232`, `270-293`), and keyboard page navigation wired at
the `App.tsx` level (`App.tsx:167-182`, arrows/j/k).

**Gaps:**
- No search-within-document (find text on page / jump to match).
- No thumbnail/page-strip sidebar for fast navigation on long PDFs — only
  prev/next and jump-via-reference.
- Simplify results (`summaries` state, `PdfViewer.tsx:54`) are React state
  only — lost on page/document switch, never persisted to the DB even
  though `definitions`/`sections`/`references` all get haunted (persisted)
  tables. A user's simplifications vanish on reopen.
- No print/export of the annotated view (e.g. "export simplifications as
  notes").
- Highlighting matches text **content**, not real bounding boxes from
  layout analysis — multi-column PDFs or repeated terms across the page
  could over/under-match (acceptable ponytail-scope shortcut, but worth a
  `// ponytail:` comment near `PdfViewer.tsx:82` since it isn't marked yet).

**Recommendations:** Persist `Simplify` output (`ai::HttpLlm` → new
`simplifications` table keyed by doc+page, mirroring `definitions`);
in-page find bar (client-side text-layer search, no backend needed);
optional page thumbnail rail once perf is verified on large PDFs.

### Chat (`App.tsx:281-285`, `src/components/ChatPanel.tsx`)

**What it does now:** Minimal RAG chat — send box, message list, jump to the
answer's source page on send (`ChatPanel.tsx:29-31`, uses `ask`'s returned
`page`). No conversation persistence; `messages` is local `useState`
(`ChatPanel.tsx:17`), wiped on view switch or document change.

**Gaps:**
- No chat history across sessions/documents — every reopen starts blank.
  Backend has nothing to support this either (no `chat_messages` table in
  `db.rs`).
- No citation/source display — `ask` only returns `{ answer, page }`
  (`repo::AskResult`, referenced `App.tsx:11-14` shape), not which chunks
  were used, so the user can't see *why* the model said something beyond
  one page jump.
- No per-document scoping indicator — chat is global (`ask` in
  `commands.rs:51-58` has no `doc_id` parameter at all), so in a multi-doc
  library the user has no way to know (or control) which document(s) are
  being searched against.
- No streaming — `ask` waits for the full completion
  (`ai.rs:108-127`, `stream: false`), so longer answers show only a
  "Thinking…" spinner with no partial output.
- No stop/regenerate/clear controls.

**Recommendations:** This is the biggest capability gap relative to the
"RAG chat" mission. Concretely: extend `ask` to accept an optional `doc_id`
to scope the KNN search (schema already has `doc` on `chunks`, `db.rs:16`,
so this is a `WHERE` clause, not new infrastructure); return the matched
chunk texts/pages alongside the answer so the UI can show "Sources: p.4,
p.12" chips; persist chat turns to a new `chat_messages` table so history
survives navigation; consider `stream: true` + SSE parsing for perceived
latency (llama.cpp already supports it — this is a `ai.rs` + `ChatPanel.tsx`
change, no new dependency).

### Knowledge (`src/components/KnowledgePanel.tsx`)

**What it does now:** Tabbed view — Outline (sections, `KnowledgePanel.tsx:119-136`),
Definitions (`138-150`), References/backlinks (`152-190`), Cross-doc links
(`192-215`), and a static SVG "Graph" preview tab (`220-310`) that lays out
definition/section nodes in a circle with reference edges — explicitly
labeled in-code as a placeholder ("interactive canvas... is coming next",
`KnowledgePanel.tsx:306`).

**Gaps:**
- **Anomaly detection is gone.** `InsightsPanel`'s "Check anomalies" button
  and its call to `detect_anomalies` (backend command still live,
  `commands.rs:76-83`, `repo::detect_anomalies`) has no home in
  `KnowledgePanel` or anywhere else in the current tree. This is plan.md
  Phase 4.3, marked "✅ Done" in `plan.md:15`, but is currently
  unreachable from the UI. This is the single clearest concrete gap to fix.
- The Graph tab is non-interactive (no pan/zoom/click-to-navigate,
  `GraphPreview`, `KnowledgePanel.tsx:220-310` is SVG text only) and caps
  at 24 nodes (`.slice(0, 24)`, line 241) — doesn't scale to real documents.
  It also only shows the *current* document's nodes; cross-doc links
  (already fetched as `crossLinks`, line 44) aren't drawn as edges in the
  graph, only listed in a separate tab.
- No per-term/section search or filter within a long definitions/outline
  list.
- No manual add/edit for a definition the LLM missed or got wrong (all
  definitions are LLM-extracted at ingest, `ai.rs:140-150`, one-shot,
  first-6000-chars only — no correction path).

**Recommendations:** Restore an "Anomalies" tab (or floating action) that
calls `detect_anomalies` — trivial re-wire, the backend is untouched.
Make the Graph tab interactive (pan/zoom via a lightweight approach —
CSS transforms + pointer events, no new charting dependency needed at
current node counts) and merge cross-doc edges into it. Add inline
edit/delete for a wrong definition (`UPDATE definitions SET explanation =
$x WHERE id = $id` — schema already supports it, `db.rs:24-27`).

### Models (`src/components/ModelLibrary.tsx`)

**What it does now:** The most complete non-reader page. Two-phase UI:
dependency setup (llama.cpp + llmfit install with live progress,
`SetupView`/`DepRow`, lines 199-294) then a Hub (`Hub`, lines 298-400) with
hardware profile bar, installed-models management (set active/delete,
`InstalledSection`, 456-517), and two model-discovery tabs — "Recommended"
(hardware-scored via `llmfit recommend`, `RecommendedGrid`/`RecommendedCard`,
587-696) and "Search catalog" (full-text search + filters against the
cached GGUF catalog, `SearchPanel`/`SearchRow`, 700-929) with one-click
install and live download progress (`InstallButton`, 943-1049).

**Gaps:**
- No visibility into llama-server's actual runtime health — `lib.rs`
  spawns the sidecar and tracks it in `Sidecar` state
  (`lib.rs:26,124-125`), but the frontend has no command to query
  "is it currently up, what port, what model is loaded" beyond inferring
  from `list_downloaded_models().active`. A crashed sidecar shows no
  distinct error state in Models — only surfaces later as an opaque
  "is llama-server running?" string from `ai.rs:67,118` when Chat/ingest
  fails.
- No model uninstall confirmation of disk-space reclaimed, no total
  disk-usage summary across installed models.
- No context-length or resource override controls (e.g. `--ctx-size`,
  `--n-gpu-layers`) — everything is auto; power users have no manual
  tuning knob even though `llmfit info` returns `context_length` per model
  (`ModelLibrary.tsx:42`, already parsed, only shown as read-only spec).

**Recommendations:** Add a `sidecar_status` Tauri command (wraps the
existing `Sidecar` mutex — `lib.rs:26` — to expose up/down + port + loaded
model path) and a small health chip in `ModelLibrary`'s header; add a
"restart llama-server" action for when it's silently dead. This closes the
biggest diagnosability gap in the app — right now a dead sidecar just
looks like every AI feature mysteriously failing.

### Dead / orphaned files

- `src/components/FilePicker.tsx` is never imported anywhere in `src/`
  (confirmed via repo-wide grep) — `App.tsx` builds its own hidden
  `<input type="file">` (`App.tsx:195-201`) instead. Either delete this file
  or replace the ad hoc input with it; keeping both is dead code.
- `src/components/LogPanel.tsx` is used only inside `NavRail`
  (`NavRail.tsx:2,70`) as a collapsible terminal-style activity log — this
  is working and reasonably scoped, no changes needed.

## Missing pages

These are proposed net-new pages/surfaces, each tied either to a backend
capability that already exists but isn't surfaced anywhere, or to explicit
later-phase intent in `plan.md` that the current 6-module nav doesn't cover.
Rationale for each is grounded primarily in this repo's own code; where a
comparable offline/local-first tool independently arrived at the same
feature, that's cited as supporting evidence, not as the primary driver.

**Comparative research (web, July 2026):** surveyed AnythingLLM
([docs.anythingllm.com](https://docs.anythingllm.com/introduction),
[chatting-with-documents](https://docs.anythingllm.com/chatting-with-documents/introduction)),
PrivateGPT ([github.com/zylon-ai/private-gpt](https://github.com/zylon-ai/private-gpt)),
Khoj ([github.com/khoj-ai/khoj](https://github.com/khoj-ai/khoj)),
LARS — LLM Annotation and Response System
([github.com/abgulati/LARS](https://github.com/abgulati/LARS)), GPT4All
LocalDocs (via [itsfoss.com/local-ai-docs-tools](https://itsfoss.com/local-ai-docs-tools/)),
and Obsidian's graph/backlinks model
([deepwiki.com/obsidianmd/obsidian-help](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view),
[techtimes.com](https://www.techtimes.com/articles/315717/20260407/why-use-obsidian-note-taking-graph-view-linked-notes-powerful-knowledge-management.htm)).

### 1. Settings / Data page

No settings surface exists at all today — no way to see or change the app
data directory, no way to see total disk usage (documents DB + all
downloaded GGUF models can easily be tens of GB), no "reset app data" or
"export/import my library" action. `models_dir`/`bin_dir`/DB path are all
computed in Rust (`models.rs:25-54`, `db.rs:6`) but never exposed to the
user. Rationale: privacy-first, offline apps live or die on the user
trusting *where* their data is — the CLAUDE.md-stated hard constraint
("zero cloud dependencies... your files never leave this device") is
currently only asserted in copy (`Home.tsx:150`), never verifiable from
inside the app itself. A Settings page showing the literal app-data path,
per-category disk usage, and a "reveal in file manager" button would make
that promise checkable, not just stated.

### 2. Anomalies as a first-class page (not just a KnowledgePanel tab)

Given `detect_anomalies` is currently orphaned entirely (see Knowledge
page gaps above) and Phase 4's stated goal is "Chat drives the viewport...
anomaly detection flags inconsistencies" (`plan.md:73`), anomalies arguably
deserve their own module rather than a buried tab — especially once
anomaly results start referencing specific pages/clauses (they're currently
freeform LLM prose, `ai.rs:152-158`, with no structured location data). A
dedicated page could list anomalies with jump-to-page links once
`detect_anomalies` is extended to return structured `{finding, page}` pairs
instead of a single string blob — mirroring the `Definition`/`Section`
shape already used elsewhere. Minimum-effort version: just restore the
button in Knowledge first: don't build a new page until the anomaly output
itself is structured enough to warrant one.

### 3. Cross-library search (spans Documents + Chat)

There is no command today that searches text/definitions across *all*
ingested documents at once — `list_definitions`/`list_sections`/
`list_references` (`commands.rs:35-66`) all take a single `doc_id`. The
`chunks` table has a working BM25 index already (`db.rs:21-22`,
`chunk_text` SEARCH ANALYZER) that `ask`'s fallback presumably uses
(per `plan.md:15`, "BM25 full-text fallback in ask... (4.5)"), but it's only
reachable through the chat flow, scoped to whatever `ask` decides, never as
a direct "search my library" experience. A lightweight search page (or a
search bar promoted onto Documents) hitting a new `search_chunks(query)`
command wrapping the existing BM25 index would surface capability that's
already built and paid for, just not exposed. Comparable tools converge on
exactly this as a first-class surface: PrivateGPT's UI has a dedicated
Documents tab where `#`-selecting a document (or all of them) scopes a
query ([github.com/zylon-ai/private-gpt](https://github.com/zylon-ai/private-gpt)),
and GPT4All's "LocalDocs" mode is built specifically around indexing local
PDFs for privacy-preserving search
([itsfoss.com/local-ai-docs-tools](https://itsfoss.com/local-ai-docs-tools/)) —
both validate that "search across everything I've ingested" is an expected
top-level capability, not a chat side-effect.

### 3a. Chat citations / source highlighting (strengthens item in Chat gaps above)

The Chat page gap already noted above — `ask` returns only `{answer, page}`
with no indication of which chunks were used
(`repo::AskResult` shape referenced at `App.tsx:11-14`) — has a direct,
well-established precedent worth calling out: LARS (LLM Annotation and
Response System) is built specifically around "detailed citations
comprising document names, page numbers, text highlighting... with a
document reader to scroll through documents within the response window"
([github.com/abgulati/LARS](https://github.com/abgulati/LARS)), and other
local-RAG-over-PDF tools implement "citation-anchored sources" where
clicking an inline citation navigates to and highlights the cited text in
the source document (via search results, no single canonical URL). LexisLocal
already has the two building blocks LARS combines — a `PdfViewer` capable of
jumping to a page (`PdfViewer.tsx`, `onJump`) and a chat flow that returns a
page number (`ChatPanel.tsx:29-31`) — it just stops at "jump to page"
instead of "highlight the exact cited passage," which is the smaller,
concrete next step once `ask` returns chunk text/offsets instead of just a
page number.

### 4. Model activity / diagnostics (folds into Models, above)

Covered under Models' recommendations — not big enough to be a standalone
page, but flagged again here because it's the most user-visible blind
spot: a dead llama-server currently degrades silently into every AI
feature (chat, ingest, definitions, simplify, anomalies) failing with the
same generic string, with no single place to check "is my local model
actually running."

### 5. Interactive, library-wide knowledge graph (Knowledge page's biggest gap, competitively)

The current Graph tab (`KnowledgePanel.tsx:220-310`) is explicitly a
placeholder — static SVG, one document, capped at 24 nodes, no pan/zoom/
click. This is the single feature area where LexisLocal's own stated
identity ("PDFs that talk to each other," `plan.md:57`) most directly
overlaps with two mature reference implementations: Obsidian's graph view,
where "the local Graph view shows notes connected to the active note" with
full pan/zoom and click-to-navigate, and an automatic, bidirectional
backlinks pane for every link
([deepwiki.com/obsidianmd/obsidian-help](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view)),
and Khoj's "minimal implementation of GraphRAG... to prototype whether you
can get good sense-making out of a large dataset" via knowledge-graph
construction over ingested docs
([github.com/khoj-ai/khoj](https://github.com/khoj-ai/khoj)). LexisLocal
already has the graph *data* these tools visualize — `same_term` RELATE
edges linking definitions across documents (`plan.md:14`,
`cross_doc_links` command, `commands.rs:69-74`) — it's the interactive
canvas and the *cross-document* edges in that canvas that are missing, not
the underlying graph structure. This reinforces (rather than replaces) the
recommendation already made under the Knowledge page: make the existing
Graph tab pan/zoomable and merge in `crossLinks` as edges, rather than
treating it as a wholly new page.

## Priority ordering (if only fixing a few things)

1. Restore anomaly detection UI (near-zero backend work, pure re-wire —
   biggest "we shipped this, then lost it" gap).
2. Scope `ask` to a document + return source chunks (unblocks real RAG
   trust — currently a black box).
3. Sidecar health visibility in Models (fixes the #1 support-burden failure
   mode: "nothing works and I don't know why").
4. Persist chat history and Simplify notes (currently both vanish on
   navigation — surprising for a "local-first, your data stays here" app
   where the expectation is usually *more* persistence, not less).
5. Add chat citations/source-highlighting (LARS-style) and make the
   Knowledge graph tab interactive with cross-doc edges (Obsidian/Khoj-style)
   — the two areas where competitive tooling most clearly outpaces the
   current build.
