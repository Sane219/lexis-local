import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

// Phase 3 (definitions) + 3.6 (cross-references) + 4 (anomalies) for the
// selected document. All structured data is fetched once in App and shared with
// PdfViewer; this panel is the read-out side of the bidirectional links.
export function InsightsPanel({
  docId,
  definitions: defs,
  references,
  sections,
  onJump,
}: {
  docId: string;
  definitions: Definition[];
  references: Reference[];
  sections: Section[];
  onJump: (page: number) => void;
}) {
  const [anomalies, setAnomalies] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAnomalies(null);
  }, [docId]);

  // Backlinks: per referenced section, the distinct sections that point at it.
  const backlinks = useMemo(() => {
    const pageOf = new Map(sections.map((s) => [s.label, s.page]));
    const byTarget = new Map<string, Set<string>>();
    for (const r of references) {
      if (!byTarget.has(r.target_label)) byTarget.set(r.target_label, new Set());
      byTarget.get(r.target_label)!.add(r.source_label || "Preamble");
    }
    return [...byTarget.entries()]
      .map(([target, sources]) => ({
        target,
        page: pageOf.get(target),
        sources: [...sources],
      }))
      .sort((a, b) => a.target.localeCompare(b.target, undefined, { numeric: true }));
  }, [references, sections]);

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
        <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2">Cross-references</h2>
        {backlinks.length === 0 ? (
          <p className="text-xs text-gray-400">No internal references found.</p>
        ) : (
          <ul className="space-y-1.5">
            {backlinks.map((b) => (
              <li key={b.target} className="text-sm text-gray-700">
                {b.page ? (
                  <button
                    onClick={() => onJump(b.page!)}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {b.target}
                  </button>
                ) : (
                  <span className="font-medium text-gray-800">{b.target}</span>
                )}
                <span className="text-gray-500">
                  {" "}— referenced by {b.sources.join(", ")}
                </span>
              </li>
            ))}
          </ul>
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
