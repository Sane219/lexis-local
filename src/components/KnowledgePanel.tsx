import { useMemo, useState } from "react";
import { moduleStyle } from "../modules";

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

type Tab = "outline" | "definitions" | "references" | "crossdoc" | "graph";

export function KnowledgePanel({
  docId,
  docName,
  definitions: defs,
  references,
  sections,
  crossLinks,
  onJump,
}: {
  docId: string | null;
  docName: string | null;
  definitions: Definition[];
  references: Reference[];
  sections: Section[];
  crossLinks: CrossLink[];
  onJump: (page: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("definitions");

  if (!docId) {
    return (
      <PageShell docName={docName}>
        <Empty label="Open a PDF to extract its knowledge graph." />
      </PageShell>
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "outline", label: "Outline", count: sections.length },
    { id: "definitions", label: "Definitions", count: defs.length },
    { id: "references", label: "References", count: references.length },
    { id: "crossdoc", label: "Cross-doc", count: crossLinks.length },
    { id: "graph", label: "Graph" },
  ];

  return (
    <PageShell docName={docName}>
      <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              tab === t.id ? "bg-accent-soft text-accent-strong" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1 text-gray-400">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "outline" && <Outline sections={sections} onJump={onJump} />}
        {tab === "definitions" && <DefList defs={defs} />}
        {tab === "references" && <RefList references={references} sections={sections} onJump={onJump} />}
        {tab === "crossdoc" && <CrossDoc links={crossLinks} />}
        {tab === "graph" && (
          <GraphPreview defs={defs} sections={sections} references={references} crossLinks={crossLinks} />
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ docName, children }: { docName: string | null; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6" style={moduleStyle("knowledge")}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Knowledge</h1>
        {docName && (
          <span className="truncate rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
            {docName}
          </span>
        )}
      </header>
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function Outline({ sections, onJump }: { sections: Section[]; onJump: (p: number) => void }) {
  if (sections.length === 0) return <p className="text-sm text-gray-500">No sections detected.</p>;
  return (
    <ul className="space-y-1">
      {sections.map((s, i) => (
        <li key={i}>
          <button
            onClick={() => onJump(s.page)}
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100"
          >
            <span className="truncate font-medium text-gray-800">{s.label}</span>
            <span className="shrink-0 text-xs text-gray-500">p. {s.page}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DefList({ defs }: { defs: Definition[] }) {
  if (defs.length === 0) return <p className="text-sm text-gray-500">No definitions extracted.</p>;
  return (
    <dl className="space-y-3">
      {defs.map((d, i) => (
        <div key={i} className="text-sm">
          <dt className="font-medium text-gray-800">{d.term}</dt>
          <dd className="text-gray-600">{d.explanation}</dd>
        </div>
      ))}
    </dl>
  );
}

function RefList({
  references,
  sections,
  onJump,
}: {
  references: Reference[];
  sections: Section[];
  onJump: (p: number) => void;
}) {
  const backlinks = useMemo(() => {
    const pageOf = new Map(sections.map((s) => [s.label, s.page]));
    const byTarget = new Map<string, Set<string>>();
    for (const r of references) {
      if (!byTarget.has(r.target_label)) byTarget.set(r.target_label, new Set());
      byTarget.get(r.target_label)!.add(r.source_label || "Preamble");
    }
    return [...byTarget.entries()]
      .map(([target, sources]) => ({ target, page: pageOf.get(target), sources: [...sources] }))
      .sort((a, b) => a.target.localeCompare(b.target, undefined, { numeric: true }));
  }, [references, sections]);

  if (backlinks.length === 0) return <p className="text-sm text-gray-500">No internal references found.</p>;
  return (
    <ul className="space-y-2">
      {backlinks.map((b) => (
        <li key={b.target} className="text-sm text-gray-700">
          {b.page ? (
            <button onClick={() => onJump(b.page!)} className="font-medium text-accent-strong hover:underline">
              {b.target}
            </button>
          ) : (
            <span className="font-medium text-gray-800">{b.target}</span>
          )}
          <span className="text-gray-500"> — referenced by {b.sources.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

function CrossDoc({ links }: { links: CrossLink[] }) {
  if (links.length === 0)
    return <p className="text-sm text-gray-500">No terms shared with other documents.</p>;
  return (
    <dl className="space-y-3">
      {links.map((c) => (
        <div key={c.term} className="text-sm">
          <dt className="font-medium text-gray-800">{c.term}</dt>
          <dd className="text-gray-600">{c.explanation}</dd>
          <dd className="mt-0.5 text-xs text-accent-strong">
            Also in:{" "}
            {c.matches.map((m, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-medium">{m.doc_name}</span>
                <span className="text-gray-500"> — {m.explanation}</span>
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Static circular preview of the in-document graph: definition + section nodes
// with reference edges. The interactive canvas (pan/zoom, cross-doc edges) is a
// later phase; this teaser shows the shape of the data now.
function GraphPreview({
  defs,
  sections,
  references,
  crossLinks,
}: {
  defs: Definition[];
  sections: Section[];
  references: Reference[];
  crossLinks: CrossLink[];
}) {
  const W = 640;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const r = 160;

  const nodes = useMemo(() => {
    const set: { id: string; label: string; type: "def" | "section" }[] = [];
    for (const d of defs.slice(0, 16)) set.push({ id: `d:${d.term}`, label: d.term, type: "def" });
    for (const s of sections.slice(0, 8)) set.push({ id: `s:${s.label}`, label: s.label, type: "section" });
    return set.slice(0, 24);
  }, [defs, sections]);

  const nodeIndex = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const pos = useMemo(() => {
    const n = nodes.length || 1;
    return nodes.map((_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }, [nodes.length]);

  const edges = useMemo(() => {
    const out: { a: number; b: number }[] = [];
    for (const ref of references) {
      const ai = nodeIndex.get(`s:${ref.source_label}`);
      const bi = nodeIndex.get(`s:${ref.target_label}`);
      if (ai != null && bi != null) out.push({ a: ai, b: bi });
    }
    return out.slice(0, 60);
  }, [references, nodeIndex]);

  if (nodes.length === 0)
    return <p className="text-sm text-gray-500">Not enough extracted structure to preview a graph yet.</p>;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-gray-200 bg-gray-50" role="img" aria-label="Preview of the document knowledge graph">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={pos[e.a].x}
            y1={pos[e.a].y}
            x2={pos[e.b].x}
            y2={pos[e.b].y}
            stroke="var(--accent)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {nodes.map((n, i) => (
          <g key={n.id}>
            <circle
              cx={pos[i].x}
              cy={pos[i].y}
              r={n.type === "def" ? 6 : 5}
              fill={n.type === "def" ? "var(--accent)" : "white"}
              stroke="var(--accent-strong)"
              strokeWidth={1.5}
            />
            <text
              x={pos[i].x}
              y={pos[i].y - 10}
              textAnchor="middle"
              className="fill-gray-500"
              style={{ fontSize: 9 }}
            >
              {n.label.length > 14 ? n.label.slice(0, 13) + "…" : n.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        Preview · {nodes.length} nodes, {edges.length} in-document edges
        {crossLinks.length > 0 && `, ${crossLinks.length} cross-document link${crossLinks.length === 1 ? "" : "s"}`}.
        The interactive canvas — pan, zoom, and follow links across documents — is coming next.
      </p>
    </div>
  );
}
