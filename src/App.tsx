import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PdfViewer } from "./components/PdfViewer";
import { errMsg } from "./utils";
import { DocumentList } from "./components/DocumentList";
import { ChatPanel } from "./components/ChatPanel";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { ModelLibrary } from "./components/ModelLibrary";
import { Home } from "./components/Home";
import { NavRail } from "./components/NavRail";
import { moduleStyle, type ViewId } from "./modules";
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
  const [view, setView] = useState<ViewId>("home");
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [selected, setSelected] = useState<DocInfo | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [crossLinks, setCrossLinks] = useState<CrossLink[]>([]);
  const [modelCount, setModelCount] = useState(0);
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
      setPageNum(1);
      setView("reader");
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
      setCrossLinks([]);
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

  const refreshModelCount = useCallback(async () => {
    try {
      const models = await invoke<unknown[]>("list_downloaded_models");
      setModelCount(models.length);
    } catch {
      setModelCount(0);
    }
  }, []);

  useEffect(() => {
    loadDocs();
    refreshModelCount();
  }, [loadDocs, refreshModelCount]);

  useEffect(() => {
    const uns: Promise<() => void>[] = [
      listen("llmfit-done", () => refreshModelCount()),
    ];
    return () => void uns.forEach((u) => u.then((f) => f()));
  }, [refreshModelCount]);

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

  const jumpToPage = useCallback((page: number) => {
    setPageNum(page);
    setView("reader");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "reader") return;
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
  }, [goPage, view]);

  const handleSelect = (doc: DocInfo) => {
    info(`Opened document: ${doc.name}`);
    setSelected(doc);
    setPageNum(1);
    const bytes = bytesMap.current.get(doc.id);
    setPdfBytes(bytes ?? null);
    setView("reader");
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
      <NavRail view={view} onNavigate={setView} onOpen={openPicker} status={status} statusType={statusType} />
      <main className="flex-1 overflow-y-auto bg-white">
        {view === "home" && (
          <Home
            onNavigate={setView}
            onOpen={openPicker}
            stats={{
              docs: documents.length,
              models: modelCount,
              terms: definitions.length,
              docName: selected?.name ?? null,
            }}
          />
        )}

        {view === "documents" && (
          <div className="mx-auto max-w-2xl px-6 py-8" style={moduleStyle("documents")}>
            <header className="mb-4 flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold text-gray-900">Documents</h1>
              <button
                onClick={openPicker}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Open PDF
              </button>
            </header>
            <DocumentList documents={documents} selectedId={selected?.id ?? null} onSelect={handleSelect} />
          </div>
        )}

        {view === "reader" &&
          (pdfBytes && selected ? (
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h1 className="text-lg font-semibold text-gray-900">{selected.name}</h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goPage(-1)}
                    disabled={pageNum <= 1}
                    className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    ‹ Prev
                  </button>
                  <span className="text-xs tabular-nums text-gray-500">
                    Page {pageNum} / {selected.page_count}
                  </span>
                  <button
                    onClick={() => goPage(1)}
                    disabled={pageNum >= selected.page_count}
                    className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
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
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="text-center">
                <p className="text-sm text-gray-600">No document open yet.</p>
                <button
                  onClick={openPicker}
                  className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Open PDF
                </button>
              </div>
            </div>
          ))}

        {view === "chat" && (
          <div className="mx-auto h-full max-w-2xl px-6 py-8" style={moduleStyle("chat")}>
            <ChatPanel onNavigate={jumpToPage} />
          </div>
        )}

        {view === "knowledge" && (
          <KnowledgePanel
            docId={selected?.id ?? null}
            docName={selected?.name ?? null}
            definitions={definitions}
            references={references}
            sections={sections}
            crossLinks={crossLinks}
            onJump={jumpToPage}
          />
        )}

        {view === "models" && (
          <div className="mx-auto max-w-5xl px-6 py-8" style={moduleStyle("models")}>
            <ModelLibrary />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
