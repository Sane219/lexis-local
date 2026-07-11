import { useState } from "react";
import { useLogs, LogLevel } from "../log";

const colors: Record<LogLevel, string> = {
  info: "text-gray-500",
  warn: "text-warning",
  error: "text-error",
  success: "text-success",
};

function fmt(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour12: false });
}

export function LogPanel() {
  const logs = useLogs();
  const [open, setOpen] = useState(true);
  const recent = logs.slice(-60);

  return (
    <div className="border-t border-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
      >
        <span>
          Logs{recent.length > 0 && ` (${recent.length})`}
          {recent.some((l) => l.level === "error") && (
            <span className="ml-2 h-1.5 w-1.5 inline-block rounded-full bg-error align-middle" />
          )}
        </span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto bg-gray-950 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {recent.length === 0 ? (
            <p className="text-gray-600">No activity yet.</p>
          ) : (
            recent.map((l, i) => (
              <p key={i} className={colors[l.level] ?? "text-gray-400"}>
                <span className="text-gray-600">{fmt(l.t)} </span>
                {l.msg}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}
