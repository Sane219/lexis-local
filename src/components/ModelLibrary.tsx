import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Model {
  id: string;
  name: string;
  query: string;
  size: string;
  description: string;
}

const MODELS: Model[] = [
  { id: "mistral", name: "Mistral 7B", query: "mistral 7b", size: "~4 GB", description: "General purpose, good quality/speed balance" },
  { id: "llama3", name: "Llama 3 8B", query: "llama 3 8b", size: "~4.5 GB", description: "Latest Meta LLM, strong reasoning" },
  { id: "qwen", name: "Qwen 3B", query: "qwen 3b", size: "~1.8 GB", description: "Lightweight, fast on low-RAM machines" },
];

export function ModelLibrary() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    (async () => {
      unlisteners.push(
        await listen<string>("llmfit-progress", (e) => {
          setProgress((prev) => [...prev.slice(-50), e.payload]);
        }),
        await listen("llmfit-done", () => {
          setDownloading(null);
          setProgress((prev) => [...prev, "✅ Download complete"]);
        }),
        await listen<string>("llmfit-error", (e) => {
          setDownloading(null);
          setProgress((prev) => [...prev, `❌ ${e.payload}`]);
        }),
      );
    })();
    return () => unlisteners.forEach((fn) => fn());
  }, []);

  const download = async (model: Model) => {
    setDownloading(model.id);
    setProgress([`Starting download of ${model.name}…`]);
    try {
      await invoke("download_model_llmfit", { query: model.query });
    } catch (e) {
      setDownloading(null);
      setProgress((prev) => [...prev, `❌ ${e}`]);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-500 uppercase">Model Library</h2>
      {MODELS.map((m) => (
        <div key={m.id} className="rounded border border-gray-200 p-2.5 text-sm">
          <div className="font-medium text-gray-800">{m.name}</div>
          <div className="text-xs text-gray-500">{m.size} — {m.description}</div>
          <button
            onClick={() => download(m)}
            disabled={downloading !== null}
            className="mt-1.5 text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {downloading === m.id ? "Downloading…" : "Download"}
          </button>
        </div>
      ))}
      {progress.length > 0 && (
        <div className="text-xs text-gray-500 max-h-24 overflow-y-auto space-y-0.5">
          {progress.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  );
}
