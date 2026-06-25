import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PdfViewer } from "./components/PdfViewer";
import { FilePicker } from "./components/FilePicker";
import { DocumentList } from "./components/DocumentList";
import { ChatPanel } from "./components/ChatPanel";
import { InsightsPanel } from "./components/InsightsPanel";
import { ModelLibrary } from "./components/ModelLibrary";

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

function App() {
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [selected, setSelected] = useState<DocInfo | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [status, setStatus] = useState<string>("");
  const bytesMap = useRef<Map<string, Uint8Array>>(new Map());

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

  const handleFile = async (name: string, bytes: Uint8Array) => {
    setStatus("Ingesting...");
    try {
      const doc = await invoke<DocInfo>("ingest_pdf", { name, bytes });
      bytesMap.current.set(doc.id, bytes);
      setPdfBytes(bytes);
      setSelected(doc);
      setStatus(`Ingested: ${doc.name} (${doc.page_count} pages)`);
      await loadDocs();
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleSelect = (doc: DocInfo) => {
    setSelected(doc);
    setPageNum(1);
    const bytes = bytesMap.current.get(doc.id);
    setPdfBytes(bytes ?? null);
  };

  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <FilePicker onFile={handleFile} disabled={status === "Ingesting..."} />
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
          <div className="p-2 text-xs text-gray-500 border-t border-gray-200 truncate">
            {status}
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-y-auto p-4 bg-white">
        {pdfBytes && selected ? (
          <div>
            <h1 className="text-lg font-semibold mb-2">{selected.name}</h1>
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
              onJump={setPageNum}
              docId={selected.id}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select or ingest a PDF to begin
          </div>
        )}
      </main>
      <ChatPanel onNavigate={setPageNum} />
    </div>
  );
}

export default App;
