import type { CSSProperties } from "react";

export type ViewId =
  | "home"
  | "documents"
  | "reader"
  | "chat"
  | "knowledge"
  | "models";

export interface ModuleDef {
  id: ViewId;
  label: string;
  blurb: string;
  /** Mid accent — fills, icons, active markers. */
  accent: string;
  /** Darker accent — text on light, hover, borders. */
  accentStrong: string;
  /** Near-white wash — selected/active backgrounds. */
  accentSoft: string;
  Icon: (p: { className?: string }) => JSX.Element;
}

// Per-module accent hues double as wayfinding: each module owns a distinct
// color so the eye tracks where it is. Hues avoid the semantic success
// (~150), error (~25), and warning (~75) bands so accents never read as state.
const C = {
  reader: { a: "oklch(0.55 0.21 255)", s: "oklch(0.45 0.21 255)", w: "oklch(0.97 0.025 255)" },
  documents: { a: "oklch(0.62 0.15 205)", s: "oklch(0.50 0.15 205)", w: "oklch(0.97 0.03 205)" },
  chat: { a: "oklch(0.60 0.13 168)", s: "oklch(0.47 0.13 168)", w: "oklch(0.97 0.03 168)" },
  knowledge: { a: "oklch(0.58 0.20 300)", s: "oklch(0.46 0.20 300)", w: "oklch(0.97 0.03 300)" },
  models: { a: "oklch(0.62 0.19 330)", s: "oklch(0.50 0.19 330)", w: "oklch(0.97 0.03 330)" },
  home: { a: "oklch(0.55 0.21 255)", s: "oklch(0.45 0.21 255)", w: "oklch(0.97 0.025 255)" },
};

function IconHome({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}
function IconDocuments({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M7 3h7l4 4v13.5H7z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </svg>
  );
}
function IconReader({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 5C9 3 5 3 4 4v14c1-1 5-1 8 1 3-2 7-2 8-1V4c-1-1-5-1-8 1Z" />
      <path d="M12 5v15" />
    </svg>
  );
}
function IconChat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4V5Z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}
function IconKnowledge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M8 8l8 0M7.5 9l3.5 6M16.5 10l-3.5 5" />
    </svg>
  );
}
function IconModels({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" />
    </svg>
  );
}

export const MODULES: ModuleDef[] = [
  { id: "home", label: "Home", blurb: "Your offline reading hub", accent: C.home.a, accentStrong: C.home.s, accentSoft: C.home.w, Icon: IconHome },
  { id: "documents", label: "Documents", blurb: "Ingested PDFs on this device", accent: C.documents.a, accentStrong: C.documents.s, accentSoft: C.documents.w, Icon: IconDocuments },
  { id: "reader", label: "Reader", blurb: "Read with definitions in place", accent: C.reader.a, accentStrong: C.reader.s, accentSoft: C.reader.w, Icon: IconReader },
  { id: "chat", label: "Chat", blurb: "Ask the document, grounded answers", accent: C.chat.a, accentStrong: C.chat.s, accentSoft: C.chat.w, Icon: IconChat },
  { id: "knowledge", label: "Knowledge", blurb: "Terms, links, and the graph", accent: C.knowledge.a, accentStrong: C.knowledge.s, accentSoft: C.knowledge.w, Icon: IconKnowledge },
  { id: "models", label: "Models", blurb: "Local models that run it all", accent: C.models.a, accentStrong: C.models.s, accentSoft: C.models.w, Icon: IconModels },
];

const BY_ID: Record<ViewId, ModuleDef> = MODULES.reduce(
  (acc, m) => ({ ...acc, [m.id]: m }),
  {} as Record<ViewId, ModuleDef>,
);

export function getModule(id: ViewId): ModuleDef {
  return BY_ID[id];
}

/** CSS custom properties that scope a module's accent to a subtree. */
export function moduleStyle(id: ViewId): CSSProperties {
  const m = getModule(id);
  return {
    "--accent": m.accent,
    "--accent-strong": m.accentStrong,
    "--accent-soft": m.accentSoft,
  } as CSSProperties;
}
