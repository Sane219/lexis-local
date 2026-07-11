import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { info, error as logErr } from "../log";
import { errMsg } from "../utils";

// ---- types ------------------------------------------------------------------
// Shapes below are transcribed from actually invoking `llmfit` (v1.1.2) on this
// machine — `system`, `recommend --json --runtime llamacpp --output-llamacpp`,
// `list --json`, and `info <name> --json` — not assumed from docs.

interface ToolStatus {
  llmfit_installed: boolean;
  llama_cpp_installed: boolean;
  llmfit_version: string | null;
  llama_cpp_version: string | null;
}

interface SystemInfo {
  cpu_name: string;
  cpu_cores: number;
  total_ram_gb: number;
  available_ram_gb: number;
  has_gpu: boolean;
  gpu_name: string | null;
  gpu_vram_gb: number | null;
  backend: string;
}

interface GgufSource {
  provider: string;
  repo: string;
}

interface RecommendModel {
  name: string;
  provider: string;
  parameter_count: string;
  best_quant?: string;
  capabilities?: string[];
  category?: string;
  context_length?: number;
  disk_size_gb?: number;
  estimated_tps?: number;
  fit_level?: "Perfect" | "Good" | "Marginal" | string;
  memory_required_gb?: number;
  memory_available_gb?: number;
  utilization_pct?: number;
  license?: string | null;
  installed?: boolean;
  use_case?: string;
  runtime_label?: string;
  verify_command?: string | null;
  notes?: string[];
  gguf_sources?: GgufSource[];
}

interface RecommendResponse {
  system: SystemInfo;
  models: RecommendModel[];
}

interface CatalogModel {
  name: string;
  provider: string;
  parameter_count: string;
  parameters_raw?: number;
  min_ram_gb?: number;
  recommended_ram_gb?: number;
  min_vram_gb?: number;
  quantization?: string;
  context_length?: number;
  use_case?: string;
  is_moe?: boolean;
  capabilities?: string[];
  license?: string | null;
  gguf_sources?: GgufSource[];
  architecture?: string | null;
}

interface DownloadedModel {
  name: string;
  path: string;
  size_gb: number;
  active: boolean;
}

interface DepProgress {
  stage: string;
  detail: string;
  percent: number | null;
}

const CAPABILITIES = ["tool_use", "vision", "audio", "tts"] as const;

// llama.cpp can only run GGUF. Return the GGUF repo to hand to `llmfit
// download`, or null if this model has no GGUF source (GPTQ/AWQ/base weights).
function ggufRepo(m: { gguf_sources?: GgufSource[] }): string | null {
  return m.gguf_sources?.[0]?.repo ?? null;
}

function fitTone(level?: string): { bg: string; text: string; label: string } {
  switch (level) {
    case "Perfect":
      return { bg: "bg-success-bg", text: "text-success", label: "Fits well" };
    case "Good":
      return { bg: "bg-info/10", text: "text-info", label: "Fits" };
    case "Marginal":
      return { bg: "bg-warning/15", text: "text-warning", label: "Tight fit" };
    default:
      return { bg: "bg-gray-100", text: "text-gray-500", label: level ?? "Unknown" };
  }
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-success" : "bg-gray-300"}`}
      aria-hidden="true"
    />
  );
}

// ---- root ---------------------------------------------------------------

export function ModelLibrary() {
  const [status, setStatus] = useState<ToolStatus | null>(null);
  const [depProgress, setDepProgress] = useState<Record<string, DepProgress>>({});
  const [installing, setInstalling] = useState<Record<string, boolean>>({});

  const loadStatus = useCallback(
    () => invoke<ToolStatus>("tool_status").then(setStatus).catch(() => setStatus(null)),
    [],
  );

  useEffect(() => {
    loadStatus();
    const unlistens: UnlistenFn[] = [];
    let alive = true;
    listen<{ dependency: string; stage: string; detail: string; percent: number | null }>(
      "dependency-install",
      (e) => {
        const { dependency, stage, detail, percent } = e.payload;
        setDepProgress((p) => ({ ...p, [dependency]: { stage, detail, percent } }));
        if (stage === "done" || stage === "error") {
          setInstalling((s) => ({ ...s, [dependency]: false }));
          if (stage === "done" && alive) loadStatus();
        }
      },
    ).then((u) => unlistens.push(u));
    return () => {
      alive = false;
      unlistens.forEach((u) => u());
    };
  }, [loadStatus]);

  const install = async (dependency: "llama_cpp" | "llmfit") => {
    info(`Installing ${dependency}`);
    setInstalling((s) => ({ ...s, [dependency]: true }));
    try {
      await invoke("install_dependency", { dependency });
    } catch (e) {
      logErr(`Install of ${dependency} failed: ${errMsg(e)}`);
      setDepProgress((p) => ({
        ...p,
        [dependency]: { stage: "error", detail: errMsg(e), percent: null },
      }));
      setInstalling((s) => ({ ...s, [dependency]: false }));
    }
  };

  const ready = status?.llama_cpp_installed && status?.llmfit_installed;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-gray-900">Models</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Local inference, powered by llama.cpp. Everything here runs on this device — nothing is
          uploaded.
        </p>
      </header>

      {!ready && (
        <SetupView status={status} installing={installing} progress={depProgress} onInstall={install} />
      )}
      {ready && <Hub />}
      {!ready && status?.llama_cpp_installed && !status.llmfit_installed && (
        <p className="text-sm text-gray-500">
          llama.cpp is installed — llmfit is still required to browse and download models.
        </p>
      )}
    </div>
  );
}

// ---- setup (dependency install) ------------------------------------------

function SetupView({
  status,
  installing,
  progress,
  onInstall,
}: {
  status: ToolStatus | null;
  installing: Record<string, boolean>;
  progress: Record<string, DepProgress>;
  onInstall: (d: "llama_cpp" | "llmfit") => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-gray-200 p-4">
      <p className="text-sm text-gray-600">
        LexisLocal needs two local tools to run models fully offline. Both install into the app's
        own data folder — your system is not modified.
      </p>
      <div className="space-y-2 pt-1">
        <DepRow
          title="llama.cpp"
          subtitle="The local inference server (llama-server)."
          installed={status?.llama_cpp_installed ?? false}
          version={status?.llama_cpp_version ?? null}
          busy={installing["llama_cpp"] ?? false}
          progress={progress["llama_cpp"]}
          onInstall={() => onInstall("llama_cpp")}
        />
        <DepRow
          title="llmfit"
          subtitle="Discovers, scores, and downloads GGUF models for your hardware."
          installed={status?.llmfit_installed ?? false}
          version={status?.llmfit_version ?? null}
          busy={installing["llmfit"] ?? false}
          progress={progress["llmfit"]}
          onInstall={() => onInstall("llmfit")}
        />
      </div>
    </div>
  );
}

function DepRow({
  title,
  subtitle,
  installed,
  version,
  busy,
  progress,
  onInstall,
}: {
  title: string;
  subtitle: string;
  installed: boolean;
  version: string | null;
  busy: boolean;
  progress?: DepProgress;
  onInstall: () => void;
}) {
  const pct = progress?.percent ?? null;
  const errored = progress?.stage === "error";
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot ok={installed} />
            <span className="text-sm font-medium text-gray-800">{title}</span>
            {version && <span className="text-xs text-gray-500">{version}</span>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
        {installed ? (
          <span className="shrink-0 text-xs font-medium text-success">Installed</span>
        ) : (
          <button
            onClick={onInstall}
            disabled={busy}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Installing…" : "Install"}
          </button>
        )}
      </div>
      {busy && progress && (
        <div className="mt-2">
          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className={`mt-1 text-xs ${errored ? "text-error" : "text-gray-500"}`}>{progress.detail}</p>
        </div>
      )}
    </div>
  );
}

// ---- hub: hardware + installed + recommended + search --------------------

function Hub() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [recommended, setRecommended] = useState<RecommendModel[] | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<DownloadedModel[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [tab, setTab] = useState<"recommended" | "search">("recommended");

  const loadInstalled = useCallback(async () => {
    try {
      const list = await invoke<DownloadedModel[]>("list_downloaded_models");
      setInstalled(list);
      // First model becomes active automatically so chat works without a step.
      if (list.length > 0 && !list.some((m) => m.active)) {
        await setActive(list[0].path, list);
      }
    } catch (e) {
      logErr(`Failed to list downloaded models: ${errMsg(e)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActive = useCallback(async (path: string, current?: DownloadedModel[]) => {
    setSwitching(path);
    try {
      await invoke("set_active_model", { path });
      setInstalled((base) => (current ?? base).map((m) => ({ ...m, active: m.path === path })));
      info("Active model switched");
    } catch (e) {
      logErr(`Failed to switch model: ${errMsg(e)}`);
    } finally {
      setSwitching(null);
    }
  }, []);

  const loadRecommended = useCallback(async () => {
    try {
      const r = await invoke<RecommendResponse>("llmfit_recommend");
      setSystem(r.system);
      setRecommended(r.models);
      setRecError(null);
    } catch (e) {
      setRecError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    loadInstalled();
    loadRecommended();
    let alive = true;
    const un = listen("llmfit-done", () => {
      if (alive) {
        loadInstalled();
        loadRecommended();
      }
    });
    return () => {
      alive = false;
      un.then((u) => u());
    };
  }, [loadInstalled, loadRecommended]);

  const deleteInstalled = useCallback(async (path: string) => {
    try {
      await invoke("delete_model", { path });
      setInstalled((list) => list.filter((m) => m.path !== path));
      info("Model deleted");
    } catch (e) {
      logErr(`Failed to delete model: ${errMsg(e)}`);
    }
  }, []);

  return (
    <div className="space-y-6">
      {system && <HardwareBar system={system} />}

      <InstalledSection
        list={installed}
        switching={switching}
        onSetActive={(p) => setActive(p)}
        onDelete={deleteInstalled}
      />

      <div>
        <div className="flex gap-1 border-b border-gray-200">
          <TabButton active={tab === "recommended"} onClick={() => setTab("recommended")}>
            Recommended for your hardware
          </TabButton>
          <TabButton active={tab === "search"} onClick={() => setTab("search")}>
            Search catalog
          </TabButton>
        </div>
        <div className="pt-4">
          {tab === "recommended" ? (
            <RecommendedGrid models={recommended} error={recError} installed={installed} />
          ) : (
            <SearchPanel installed={installed} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-accent text-accent-strong"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ---- hardware profile ------------------------------------------------------

function HardwareBar({ system }: { system: SystemInfo }) {
  const stats: { label: string; value: string }[] = [
    { label: "CPU", value: `${system.cpu_name} · ${system.cpu_cores} cores` },
    { label: "RAM", value: `${system.available_ram_gb.toFixed(1)} / ${system.total_ram_gb.toFixed(1)} GB free` },
    {
      label: system.has_gpu ? "GPU" : "Backend",
      value: system.has_gpu
        ? `${system.gpu_name ?? "GPU"} · ${system.gpu_vram_gb?.toFixed(1) ?? "?"} GB VRAM`
        : `${system.backend} (CPU-only)`,
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-accent-soft px-4 py-3">
      {stats.map((s) => (
        <div key={s.label} className="text-sm">
          <span className="font-medium text-accent-strong">{s.label}</span>
          <span className="ml-1.5 text-gray-600">{s.value}</span>
        </div>
      ))}
      <span className="text-xs text-gray-500">
        Recommendations below are scored against this hardware.
      </span>
    </div>
  );
}

// ---- installed models management -------------------------------------------

function InstalledSection({
  list,
  switching,
  onSetActive,
  onDelete,
}: {
  list: DownloadedModel[];
  switching: string | null;
  onSetActive: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  if (list.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center">
        <p className="text-sm text-gray-500">
          No models installed yet — pick one below to get chat and definitions working.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Installed ({list.length})
      </h2>
      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {list.map((m) => {
          const isSwitching = switching === m.path;
          return (
            <li key={m.path} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot ok={m.active} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-800">{m.name}</span>
                  <span className="block text-xs text-gray-500">{m.size_gb.toFixed(1)} GB on disk</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {isSwitching ? (
                  <span className="text-xs text-gray-500">Switching…</span>
                ) : m.active ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                    Active
                  </span>
                ) : (
                  <button
                    onClick={() => onSetActive(m.path)}
                    disabled={switching !== null}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    Set active
                  </button>
                )}
                <DeleteButton onConfirm={() => onDelete(m.path)} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Two-step delete (click once to arm, again to confirm) instead of a modal —
// the destructive action stays inline where the user already is.
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (armed) {
    return (
      <button
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        }}
        className="rounded-md bg-error px-2 py-1 text-xs font-medium text-white hover:opacity-90"
      >
        Confirm delete
      </button>
    );
  }
  return (
    <button
      onClick={() => {
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), 3000);
      }}
      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-500 hover:border-error hover:text-error"
      aria-label="Delete model"
    >
      Delete
    </button>
  );
}

// ---- fit / spec chips -------------------------------------------------------

function FitBadge({ level }: { level?: string }) {
  if (!level) return null;
  const tone = fitTone(level);
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}>
      {tone.label}
    </span>
  );
}

function MemoryBar({ required, available }: { required?: number; available?: number }) {
  if (required == null || available == null || available <= 0) return null;
  const pct = Math.min(100, Math.round((required / available) * 100));
  const color = pct >= 95 ? "bg-warning" : "bg-accent";
  return (
    <div className="mt-1.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {required.toFixed(1)} GB of {available.toFixed(1)} GB available ({pct}%)
      </p>
    </div>
  );
}

// ---- recommended grid -------------------------------------------------------

function RecommendedGrid({
  models,
  error,
  installed,
}: {
  models: RecommendModel[] | null;
  error: string | null;
  installed: DownloadedModel[];
}) {
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!models) return <p className="text-sm text-gray-500">Scoring models for your hardware…</p>;

  const runnable = models.filter((m) => ggufRepo(m));
  if (runnable.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No llama.cpp-compatible models fit your current hardware. Try Search catalog for smaller
        quantizations.
      </p>
    );
  }

  const installedRepos = new Set(installed.map((m) => m.name));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {runnable.map((m) => (
        <RecommendedCard
          key={m.name}
          model={m}
          alreadyInstalled={[...installedRepos].some((n) => m.name.toLowerCase().includes(n.toLowerCase()))}
        />
      ))}
    </div>
  );
}

function RecommendedCard({
  model: m,
  alreadyInstalled,
}: {
  model: RecommendModel;
  alreadyInstalled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col rounded-md border border-gray-200 p-3 transition-colors hover:border-accent/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{m.name}</p>
          <p className="text-xs text-gray-500">
            {m.provider} · {m.parameter_count} · {m.best_quant ?? "—"}
          </p>
        </div>
        <FitBadge level={m.fit_level} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        {m.estimated_tps != null && <span>~{m.estimated_tps.toFixed(0)} tok/s</span>}
        {m.context_length != null && <span>{(m.context_length / 1000).toFixed(0)}k context</span>}
        {m.disk_size_gb != null && <span>{m.disk_size_gb.toFixed(1)} GB download</span>}
      </div>

      {m.capabilities && m.capabilities.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.capabilities.map((c) => (
            <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {c}
            </span>
          ))}
        </div>
      )}

      <MemoryBar required={m.memory_required_gb} available={m.memory_available_gb} />

      {(m.notes?.length || m.verify_command) && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 self-start text-xs font-medium text-accent-strong hover:underline"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      )}
      {expanded && (
        <div className="mt-1.5 space-y-1 border-t border-gray-100 pt-2">
          {m.notes?.map((n, i) => (
            <p key={i} className="text-xs text-gray-500">
              {n}
            </p>
          ))}
          {m.verify_command && (
            <code className="block truncate rounded bg-gray-50 px-1.5 py-1 text-xs text-gray-500">
              {m.verify_command}
            </code>
          )}
        </div>
      )}

      <div className="mt-auto pt-2">
        {alreadyInstalled ? (
          <span className="block rounded-md border border-gray-200 px-3 py-1.5 text-center text-xs font-medium text-gray-500">
            Already installed
          </span>
        ) : (
          <InstallButton query={ggufRepo(m)} />
        )}
      </div>
    </div>
  );
}

// ---- search catalog ---------------------------------------------------------

function SearchPanel({ installed }: { installed: DownloadedModel[] }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [capability, setCapability] = useState("");
  const [sort, setSort] = useState<"relevance" | "params" | "context" | "ram">("relevance");
  const [providers, setProviders] = useState<string[]>([]);
  const [results, setResults] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  useEffect(() => {
    invoke<string[]>("llmfit_catalog_providers").then(setProviders).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      invoke<CatalogModel[]>("llmfit_search", { query, limit: 60 })
        .then((r) => setResults(r))
        .catch((e) => setError(errMsg(e)));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = results.filter((m) => {
      if (provider && m.provider !== provider) return false;
      if (capability && !(m.capabilities ?? []).includes(capability)) return false;
      return true;
    });
    if (sort !== "relevance") {
      list = [...list].sort((a, b) => {
        switch (sort) {
          case "params":
            return (b.parameters_raw ?? 0) - (a.parameters_raw ?? 0);
          case "context":
            return (b.context_length ?? 0) - (a.context_length ?? 0);
          case "ram":
            return (a.recommended_ram_gb ?? 0) - (b.recommended_ram_gb ?? 0);
          default:
            return 0;
        }
      });
    }
    return list;
  }, [results, provider, capability, sort]);

  const installedNames = new Set(installed.map((m) => m.name));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 1,000+ GGUF models by name or provider…"
          className="min-w-[240px] flex-1 rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Select value={provider} onChange={setProvider} label="Provider">
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={capability} onChange={setCapability} label="Capability">
          <option value="">Any capability</option>
          {CAPABILITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(v) => setSort(v as typeof sort)} label="Sort">
          <option value="relevance">Relevance</option>
          <option value="params">Parameters</option>
          <option value="context">Context</option>
          <option value="ram">RAM needed</option>
        </Select>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!error && !results && <p className="text-sm text-gray-500">Loading catalog…</p>}
      {!error && results && (
        <p className="text-xs text-gray-500">
          {filtered.length} model{filtered.length === 1 ? "" : "s"}
          {results.length >= 60 && " (showing top 60 matches — refine your search for more)"}
        </p>
      )}

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {filtered.map((m) => (
          <SearchRow
            key={m.name}
            model={m}
            expanded={expandedName === m.name}
            onToggle={() => setExpandedName((n) => (n === m.name ? null : m.name))}
            alreadyInstalled={installedNames.has(m.name)}
          />
        ))}
      </ul>
      {results && filtered.length === 0 && (
        <p className="px-1 text-sm text-gray-500">No matches. Try a different search or provider.</p>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {children}
      </select>
    </label>
  );
}

// A row expands in place to show live hardware-fit analysis (`llmfit info`),
// fetched only on demand — no modal, no dialog stacking.
function SearchRow({
  model: m,
  expanded,
  onToggle,
  alreadyInstalled,
}: {
  model: CatalogModel;
  expanded: boolean;
  onToggle: () => void;
  alreadyInstalled: boolean;
}) {
  const [fit, setFit] = useState<RecommendModel | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [loadingFit, setLoadingFit] = useState(false);

  useEffect(() => {
    if (!expanded || fit || loadingFit) return;
    setLoadingFit(true);
    invoke<RecommendResponse>("llmfit_model_info", { name: m.name })
      .then((r) => setFit(r.models[0] ?? null))
      .catch((e) => setFitError(errMsg(e)))
      .finally(() => setLoadingFit(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-800">{m.name}</span>
          <span className="block text-xs text-gray-500">
            {m.parameter_count} · {m.quantization ?? "—"} ·{" "}
            {m.context_length ? `${(m.context_length / 1000).toFixed(0)}k ctx` : "—"}
            {m.use_case ? ` · ${m.use_case}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {m.capabilities?.includes("Tool Use") && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">tools</span>
          )}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-3">
            <Spec label="Provider" value={m.provider} />
            <Spec label="Architecture" value={m.architecture} />
            <Spec label="License" value={m.license} />
            <Spec label="Min RAM" value={m.min_ram_gb != null ? `${m.min_ram_gb} GB` : undefined} />
            <Spec
              label="Recommended RAM"
              value={m.recommended_ram_gb != null ? `${m.recommended_ram_gb} GB` : undefined}
            />
            <Spec label="Min VRAM" value={m.min_vram_gb != null ? `${m.min_vram_gb} GB` : undefined} />
            <Spec label="MoE" value={m.is_moe ? "Yes" : "No"} />
          </div>

          {loadingFit && <p className="mt-2 text-xs text-gray-500">Checking fit against your hardware…</p>}
          {fitError && <p className="mt-2 text-xs text-error">{fitError}</p>}
          {fit && (
            <div className="mt-2 flex items-center gap-2">
              <FitBadge level={fit.fit_level} />
              {fit.estimated_tps != null && (
                <span className="text-xs text-gray-500">~{fit.estimated_tps.toFixed(0)} tok/s estimated</span>
              )}
            </div>
          )}
          {fit && <MemoryBar required={fit.memory_required_gb} available={fit.memory_available_gb} />}

          <div className="mt-3">
            {alreadyInstalled ? (
              <span className="inline-block rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500">
                Already installed
              </span>
            ) : (
              <InstallButton query={ggufRepo(m)} />
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Spec({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="inline text-gray-400">{label}: </dt>
      <dd className="inline text-gray-700">{value}</dd>
    </div>
  );
}

// ---- one-click install with live progress --------------------------------

function InstallButton({ query, compact }: { query: string | null; compact?: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>("");
  const [pct, setPct] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (!query) return;
    const unlistens: UnlistenFn[] = [];
    listen<{ query: string; line: string }>("llmfit-progress", (e) => {
      if (e.payload.query !== query) return;
      const line = e.payload.line;
      setLines((l) => [...l.slice(-40), line]);
      const m = line.match(/(\d{1,3})%/);
      if (m) setPct(parseInt(m[1], 10));
      if (/download/i.test(line)) setPhase("Downloading model…");
      else if (/fetch|search/i.test(line)) setPhase("Finding best quantization…");
      else if (/verif|check/i.test(line)) setPhase("Verifying…");
    }).then((u) => unlistens.push(u));
    listen<{ query: string }>("llmfit-done", (e) => {
      if (e.payload.query !== query) return;
      setDownloading(false);
      setDone(true);
    }).then((u) => unlistens.push(u));
    listen<{ query: string; error: string }>("llmfit-error", (e) => {
      if (e.payload.query !== query) return;
      setDownloading(false);
      setError(e.payload.error);
    }).then((u) => unlistens.push(u));
    return () => unlistens.forEach((u) => u());
  }, [query]);

  const start = async () => {
    if (!query) return;
    info(`Installing model: ${query}`);
    setDownloading(true);
    setDone(false);
    setError(null);
    setLines([]);
    setPct(null);
    setPhase("Starting…");
    try {
      await invoke("download_model_llmfit", { query });
    } catch (e) {
      logErr(`Model install of ${query} failed: ${errMsg(e)}`);
      setDownloading(false);
      setError("Couldn't start the download. Please try again.");
    }
  };

  const label = !query
    ? "Unavailable"
    : downloading
      ? "Downloading…"
      : done
        ? "Downloaded"
        : error
          ? "Retry"
          : "Install";

  return (
    <div className={compact ? "" : "w-full"} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={start}
        disabled={downloading || !query || done}
        className={`rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 ${
          compact ? "" : "w-full"
        }`}
      >
        {label}
      </button>
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
      {downloading && (
        <div className="mt-2">
          {pct !== null ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full w-1/3 animate-pulse bg-accent/40" />
            </div>
          )}
          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>
              {phase}
              {pct !== null ? ` ${pct}%` : ""}
            </span>
            {lines.length > 0 && (
              <button onClick={() => setShowLog((s) => !s)} className="text-gray-400 hover:text-gray-600">
                {showLog ? "Hide details" : "Show details"}
              </button>
            )}
          </div>
          {showLog && lines.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-gray-400">
              {lines.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
