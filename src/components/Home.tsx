import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MODULES, moduleStyle, type ViewId } from "../modules";
import { info } from "../log";

interface HomeProps {
  onNavigate: (id: ViewId) => void;
  onOpen: () => void;
  stats: { docs: number; models: number; terms: number; docName: string | null };
}

export function Home({ onNavigate, onOpen, stats }: HomeProps) {
  const meta: Partial<Record<ViewId, string>> = {
    documents: stats.docs === 1 ? "1 document" : `${stats.docs} documents`,
    models: stats.models === 1 ? "1 model" : `${stats.models} models`,
    knowledge: stats.terms === 1 ? "1 term" : `${stats.terms} terms`,
    reader: stats.docName ?? "No document open",
    chat: stats.docName ?? "No document open",
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Your offline reading hub</h1>
        <p className="mt-1 text-sm text-gray-600">
          Everything stays on this device. Pick a module to begin.
        </p>
      </header>

      <Onboarding onOpen={onOpen} />

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.filter((m) => m.id !== "home").map((m) => (
          <button
            key={m.id}
            onClick={() => onNavigate(m.id)}
            style={moduleStyle(m.id)}
            className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-accent/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent-strong">
              <m.Icon className="h-5 w-5" />
            </span>
            <span className="mt-3 text-sm font-semibold text-gray-900">{m.label}</span>
            <span className="mt-0.5 text-xs leading-relaxed text-gray-500">{m.blurb}</span>
            {meta[m.id] && (
              <span className="mt-2 text-xs font-medium text-accent-strong">{meta[m.id]}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// First-run onboarding: sequences a fresh install to a working AI reader —
// install local tools, download a model, open a PDF — reflecting live setup
// state. Reading a PDF is never blocked; steps 1–2 only gate the AI features.
function Onboarding({ onOpen }: { onOpen: () => void }) {
  const [toolsReady, setToolsReady] = useState(false);
  const [hasModel, setHasModel] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<{ llama_cpp_installed: boolean; llmfit_installed: boolean }>("tool_status");
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
    return () => void uns.forEach((u) => u.then((f) => f()));
  }, [refresh]);

  const steps = [
    {
      title: "Install the local tools",
      body: "llama.cpp and llmfit run models fully offline. Install both from the Models module.",
      done: toolsReady,
    },
    {
      title: "Download a model",
      body: toolsReady
        ? "Pick a recommended model in Models — it activates automatically when ready."
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
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h2 className="text-sm font-semibold text-gray-900">Get started</h2>
      <p className="mt-0.5 text-xs text-gray-600">
        A few one-time steps to enable AI features. You can open and read a PDF at any time.
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={s.title}
              className={`flex items-start gap-2.5 rounded-md border p-3 transition-colors ${
                isCurrent ? "border-accent/40 bg-accent-soft" : "border-gray-200"
              } ${s.locked ? "opacity-60" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <StepMarker done={s.done} current={isCurrent} index={i + 1} />
              <div className="min-w-0">
                <p className={`text-sm font-medium ${s.done ? "text-gray-500 line-through" : "text-gray-900"}`}>
                  {s.title}
                </p>
                {!s.done && <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{s.body}</p>}
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
        className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Open PDF
      </button>
      <p className="mt-3 text-center text-xs text-gray-500">
        100% offline · No account · Your files never leave this device
      </p>
    </section>
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
        current ? "border-accent text-accent-strong" : "border-gray-300 text-gray-400"
      }`}
    >
      {index}
    </span>
  );
}
