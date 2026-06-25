import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Definition {
  term: string;
  explanation: string;
}

// Phase 3 (definitions) + Phase 4 (anomaly check) for the selected document.
// Definitions are fetched once in App and shared with PdfViewer's hover cards.
export function InsightsPanel({
  docId,
  definitions: defs,
}: {
  docId: string;
  definitions: Definition[];
}) {
  const [anomalies, setAnomalies] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAnomalies(null);
  }, [docId]);

  const check = async () => {
    setBusy(true);
    try {
      setAnomalies(await invoke<string>("detect_anomalies", { docId }));
    } catch (e) {
      setAnomalies(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2">Definitions</h2>
        {defs.length === 0 ? (
          <p className="text-xs text-gray-400">None extracted.</p>
        ) : (
          <dl className="space-y-2">
            {defs.map((d, i) => (
              <div key={i} className="text-sm">
                <dt className="font-medium text-gray-800">{d.term}</dt>
                <dd className="text-gray-600">{d.explanation}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section>
        <button
          onClick={check}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded-md bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check anomalies"}
        </button>
        {anomalies && (
          <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{anomalies}</p>
        )}
      </section>
    </div>
  );
}
