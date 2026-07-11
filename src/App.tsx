import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PdfViewer } from "./components/PdfViewer";
import { errMsg } from "./utils";
import { FilePicker } from "./components/FilePicker";
import { DocumentList } from "./components/DocumentList";
import { ChatPanel } from "./components/ChatPanel";
import { InsightsPanel } from "./components/InsightsPanel";
import { ModelLibrary } from "./components/ModelLibrary";
import { LogPanel } from "./components/LogPanel";
import { info, error, initLogBridge } from "./log";

interface DocInfo {
  id: string;
  name: string;
  page_count: number;
  raw_text: string;
  created_at: string;
}

interface Definition {
  term: string;
  explanation: string;
}

interface Section {
  label: string;
  page: number;
}

interface Reference {
  source_label: string;
  target_label: string;
  page: number;
}

interface OtherDef {
  term: string;
  explanation: string;
  doc_name: string;
}

interface CrossLink {
  term: string;
  explanation: string;
  matches: OtherDef[];
}

function App() {
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [selected, setSelected] = useState<DocInfo | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [crossLinks, setCrossLinks] = useState<CrossLink[]>([]);
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"info" | "success" | "error" | null>(null);
  const bytesMap = useRef<Map<string, Uint8Array>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openPicker = useCallback(() => {
    info("Open PDF picker");
    fileInputRef.current?.click();
  }, []);

  const handleFile = async (name: string, bytes: Uint8Array) => {
    info(`Ingesting PDF: ${name}`);
    setStatus("Ingesting...");
    setStatusType("info");
    try {
      const doc = await invoke<DocInfo>("ingest_pdf", { name, bytes });
      bytesMap.current.set(doc.id, bytes);
      setPdfBytes(bytes);
      setSelected(doc);
      setStatus(`Ingested: ${doc.name} (${doc.page_count} pages)`);
      setStatusType("success");
      await loadDocs();
    } catch (e) {
      const m = errMsg(e);
      error(`Ingest failed: ${m}`);
      setStatus(`Failed to ingest: ${m}`);
      setStatusType("error");
    }
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      handleFile(file.name, new Uint8Array(buf));
      e.target.value = "";
    },
    [handleFile],
  );

  useEffect(() => {
    if (!selected) {
      setDefinitions([]);
      setSections([]);
      setReferences([]);
      return;
    }
    const docId = selected.id;
    invoke<Definition[]>("list_definitions", { docId }).then(setDefinitions).catch(() => setDefinitions([]));
    invoke<Section[]>("list_sections", { docId }).then(setSections).catch(() => setSections([]));
    invoke<Reference[]>("list_references", { docId }).then(setReferences).catch(() => setReferences([]));
    invoke<CrossLink[]>("cross_doc_links", { docId }).then(setCrossLinks).catch(() => setCrossLinks([]));
  }, [selected]);

  const loadDocs = useCallback(async () => {
    try {
      const docs = await invoke<DocInfo[]>("list_documents");
      setDocuments(docs);
    } catch (e) {
      console.error("Failed to load documents", e);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    initLogBridge();
  }, []);

  const goPage = useCallback(
    (delta: number) => {
      if (!selected) return;
      setPageNum((n) => Math.min(Math.max(1, n + delta), selected.page_count));
    },
    [selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goPage(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goPage(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPage]);

  const handleSelect = (doc: DocInfo) => {
    info(`Opened document: ${doc.name}`);
    setSelected(doc);
    setPageNum(1);
    const bytes = bytesMap.current.get(doc.id);
    setPdfBytes(bytes ?? null);
  };

  return (
    <div className="flex h-screen">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        className="hidden"
      />
      <aside className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <FilePicker onOpen={openPicker} disabled={status === "Ingesting..."} />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Documents
            </h2>
            <DocumentList
              documents={documents}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
            />
          </div>
          <ModelLibrary />
        </div>
        {status && (
          <div
            className={`p-2 text-xs border-t border-gray-200 truncate ${
              statusType === "error"
                ? "text-error"
                : statusType === "success"
                  ? "text-success"
                  : "text-gray-500"
            }`}
            role="status"
            aria-live="polite"
          >
            {status}
          </div>
        )}
        <LogPanel />
      </aside>
      <main className="flex-1 overflow-y-auto p-4 bg-white">
        {pdfBytes && selected ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-lg font-semibold">{selected.name}</h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goPage(-1)}
                  disabled={pageNum <= 1}
                  className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  ‹ Prev
                </button>
                <span className="text-xs text-gray-500 tabular-nums">
                  Page {pageNum} / {selected.page_count}
                </span>
                <button
                  onClick={() => goPage(1)}
                  disabled={pageNum >= selected.page_count}
                  className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                  aria-label="Next page"
                >
                  Next ›
                </button>
              </div>
            </div>
            <PdfViewer
              file={pdfBytes}
              pageNum={pageNum}
              definitions={definitions}
              sections={sections}
              onJump={setPageNum}
            />
            <InsightsPanel
              definitions={definitions}
              references={references}
              sections={sections}
              crossLinks={crossLinks}
              onJump={setPageNum}
              docId={selected.id}
            />
          </div>
        ) : (
          <FirstRun onOpen={openPicker} />
        )}
      </main>
      <ChatPanel onNavigate={setPageNum} />
    </div>
  );
}

export default App;

// First-run empty state: the prime onboarding surface. It sequences the user
// from a fresh install to a working AI reader — install local tools, download a
// model, open a PDF — reflecting live setup state as they act in the Model
// Library rail. Reading a PDF is never blocked (the document is the subject);
// steps 1–2 only gate the AI features. No forced tour, no modal; returning
// users with a doc open never see it.
function FirstRun({ onOpen }: { onOpen: () => void }) {
  const [toolsReady, setToolsReady] = useState(false);
  const [hasModel, setHasModel] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<{ llama_cpp_installed: boolean; llmfit_installed: boolean }>(
        "tool_status",
      );
      setToolsReady(s.llama_cpp_installed && s.llmfit_installed);
    } catch {
      setToolsReady(false);
    }
    try {
      const models = await invoke<unknown[]>("list_downloaded_models");
      setHasModel(models.length > 0);
    } catch {
      setHasModel(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const uns: Promise<() => void>[] = [
      listen("dependency-install", (e) => {
        if ((e.payload as { stage?: string })?.stage === "done") refresh();
      }),
      listen("llmfit-done", () => refresh()),
    ];
    return () => uns.forEach((u) => u.then((f) => f()));
  }, [refresh]);

  const steps = [
    {
      title: "Install the local tools",
      body: "llama.cpp and llmfit run models fully offline. Install both from the Model Library on the left.",
      done: toolsReady,
    },
    {
      title: "Download a model",
      body: toolsReady
        ? "Pick a recommended model in the Model Library — it activates automatically when ready."
        : "Available once the local tools are installed.",
      done: hasModel,
      locked: !toolsReady,
    },
    {
      title: "Open a PDF",
      body: "Read, ask questions, and surface definitions — grounded in the document itself.",
      done: false,
    },
  ];
  const current = steps.findIndex((s) => !s.done && !s.locked);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 text-blue-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
            aria-hidden="true"
          >
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <path d="M9 13h6M9 17h6" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Set up your offline reader</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          A few one-time steps to enable AI features. You can open and read a PDF
          at any time.
        </p>

        <ol className="mt-5 space-y-2">
          {steps.map((s, i) => {
            const isCurrent = i === current;
            return (
              <li
                key={s.title}
                className={`rounded-md border p-3 transition-colors ${
                  isCurrent ? "border-blue-200 bg-blue-50" : "border-gray-200"
                } ${s.locked ? "opacity-60" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="flex items-start gap-2.5">
                  <StepMarker done={s.done} current={isCurrent} index={i + 1} />
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        s.done ? "text-gray-500 line-through" : "text-gray-900"
                      }`}
                    >
                      {s.title}
                    </p>
                    {!s.done && <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{s.body}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <button
          onClick={() => {
            info("Open PDF picker");
            onOpen();
          }}
          className="mt-5 w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Open PDF
        </button>
        <p className="mt-4 text-center text-xs text-gray-600">
          100% offline · No account · Your files never leave this device
        </p>
      </div>
    </div>
  );
}

function StepMarker({ done, current, index }: { done: boolean; current: boolean; index: number }) {
  if (done) {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
        current ? "border-blue-500 text-blue-600" : "border-gray-300 text-gray-400"
      }`}
    >
      {index}
    </span>
  );
}
