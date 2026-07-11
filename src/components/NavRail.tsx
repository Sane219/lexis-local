import { MODULES, moduleStyle, type ViewId } from "../modules";
import { LogPanel } from "./LogPanel";

interface NavRailProps {
  view: ViewId;
  onNavigate: (id: ViewId) => void;
  onOpen: () => void;
  status: string;
  statusType: "info" | "success" | "error" | null;
}

export function NavRail({ view, onNavigate, onOpen, status, statusType }: NavRailProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-strong">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M4 5h16v14H4z" />
            <path d="M8 9h8M8 13h5" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">LexisLocal</div>
          <div className="text-xs text-gray-500">Offline PDF reader</div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onOpen}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Open PDF
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3" aria-label="Modules">
        <ul className="space-y-1">
          {MODULES.map((m) => {
            const active = view === m.id;
            return (
              <li key={m.id} style={moduleStyle(m.id)}>
                <button
                  onClick={() => onNavigate(m.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-accent-soft font-medium text-accent-strong"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <m.Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{m.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {status && (
        <div
          className={`border-t border-gray-200 px-4 py-2 text-xs text-gray-500 ${statusType === "error" ? "text-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="line-clamp-2">{status}</span>
        </div>
      )}
      <LogPanel />
    </aside>
  );
}
