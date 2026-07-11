import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { info, error as logErr } from "../log";

// ---- types ----------------------------------------------------------------

interface ToolStatus {
  llmfit_installed: boolean;
  llama_cpp_installed: boolean;
  llmfit_version: string | null;
  llama_cpp_version: string | null;
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
  license?: string;
  gguf_sources?: { provider: string; repo: string }[];
  architecture?: string;
}

interface RecommendModel {
  name: string;
  best_quant?: string;
  capabilities?: string[];
  category?: string;
  context_length?: number;
  disk_size_gb?: number;
  estimated_tps?: number;
  fit_level?: string;
  memory_required_gb?: number;
  license?: string;
  installed?: boolean;
}

interface DepProgress {
  stage: string;
  detail: string;
  percent: number | null;
}

// ---- helpers --------------------------------------------------------------

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-gray-400"}`}
      aria-hidden="true"
    />
  );
}

function fmtParams(p: CatalogModel | RecommendModel): string {
  if ("parameter_count" in p && p.parameter_count) return p.parameter_count;
  if ("disk_size_gb" in p && p.disk_size_gb) return `${p.disk_size_gb} GB`;
  return "—";
}

// ---- main component -------------------------------------------------------

export function ModelLibrary() {
  const [status, setStatus] = useState<ToolStatus | null>(null);
  const [depProgress, setDepProgress] = useState<Record<string, DepProgress>>({});
  const [installing, setInstalling] = useState<Record<string, boolean>>({});

  const loadStatus = () => invoke<ToolStatus>("tool_status").then(setStatus).catch(() => setStatus(null));

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
  }, []);

  const install = async (dependency: "llama_cpp" | "llmfit") => {
    info(`Installing ${dependency}`);
    setInstalling((s) => ({ ...s, [dependency]: true }));
    try {
      await invoke("install_dependency", { dependency });
    } catch (e) {
      logErr(`Install of ${dependency} failed: ${String(e)}`);
      setDepProgress((p) => ({
        ...p,
        [dependency]: { stage: "error", detail: String(e), percent: null },
      }));
      setInstalling((s) => ({ ...s, [dependency]: false }));
    }
  };

  const ready = status?.llama_cpp_installed && status?.llmfit_installed;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-500 uppercase">Model Library</h2>

      {!status || !status.llama_cpp_installed || !status.llmfit_installed ? (
        <SetupView
          status={status}
          installing={installing}
          progress={depProgress}
          onInstall={install}
        />
      ) : null}

      {ready ? (
        <ModelManager />
      ) : status?.llama_cpp_installed && !status.llmfit_installed ? (
        <p className="text-xs text-gray-600">
          llama.cpp is installed — llmfit is still required to browse and download models.
        </p>
      ) : null}
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
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        LexisLocal needs two local tools to run models fully offline. Both are
        installed into the app's data folder — your system is not modified.
      </p>
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
        subtitle="Discovers, scores, and downloads GGUF models."
        installed={status?.llmfit_installed ?? false}
        version={status?.llmfit_version ?? null}
        busy={installing["llmfit"] ?? false}
        progress={progress["llmfit"]}
        onInstall={() => onInstall("llmfit")}
      />
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
    <div className="rounded border border-gray-200 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot ok={installed} />
            <span className="text-sm font-medium text-gray-800">{title}</span>
            {version && <span className="text-xs text-gray-500">{version}</span>}
          </div>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        {installed ? (
          <span className="text-xs font-medium text-success">Installed</span>
        ) : (
          <button
            onClick={onInstall}
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Installing…" : "Install"}
          </button>
        )}
      </div>
      {busy && progress && (
        <div className="mt-2">
          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className={`mt-1 text-xs ${errored ? "text-error" : "text-gray-500"}`}>
            {progress.detail}
          </p>
        </div>
      )}
      {errored && progress && (
        <p className="mt-1 text-xs text-error">{progress.detail}</p>
      )}
    </div>
  );
}

// ---- model manager (recommend + browse) -----------------------------------

function ModelManager() {
  const [tab, setTab] = useState<"recommended" | "browse">("recommended");

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <TabButton active={tab === "recommended"} onClick={() => setTab("recommended")}>
          Recommended
        </TabButton>
        <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
          Browse all
        </TabButton>
      </div>
      {tab === "recommended" ? <RecommendedTab /> : <BrowseTab />}
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
      className={`rounded px-2.5 py-1 text-xs font-medium ${
        active ? "bg-blue-100 text-blue-900" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

function FitBadge({ level }: { level?: string }) {
  if (!level) return null;
  const cls =
    level.toLowerCase() === "perfect" || level.toLowerCase() === "good"
      ? "bg-success-bg text-success"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{level}</span>
  );
}

function RecommendedTab() {
  const [models, setModels] = useState<RecommendModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ models: RecommendModel[] }>("llmfit_recommend")
      .then((r) => setModels(r.models))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!models) return <p className="text-xs text-gray-500">Scoring models for your hardware…</p>;
  if (models.length === 0)
    return <p className="text-xs text-gray-500">No models fit your current hardware.</p>;

  return (
    <ul className="space-y-1.5">
      {models.map((m) => (
        <li key={m.name} className="rounded border border-gray-200 p-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-gray-800">{m.name}</div>
              <div className="text-xs text-gray-500">
                {fmtParams(m)} · {m.best_quant ?? "—"} · {m.category ?? "general"}
              </div>
            </div>
            <FitBadge level={m.fit_level} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
            {m.estimated_tps != null && <span>{m.estimated_tps.toFixed(1)} tok/s</span>}
            {m.memory_required_gb != null && <span>{m.memory_required_gb.toFixed(1)} GB RAM</span>}
            {m.context_length != null && <span>{(m.context_length / 1000).toFixed(0)}k ctx</span>}
          </div>
          <InstallButton query={m.name} />
        </li>
      ))}
    </ul>
  );
}

function BrowseTab() {
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "params" | "context" | "ram">("name");
  const [provider, setProvider] = useState("");
  const [capability, setCapability] = useState("");
  const [useCase, setUseCase] = useState("");
  const [selected, setSelected] = useState<CatalogModel | null>(null);

  useEffect(() => {
    invoke<CatalogModel[]>("llmfit_catalog")
      .then(setCatalog)
      .catch((e) => setError(String(e)));
  }, []);

  const providers = useMemo(
    () => unique(catalog?.map((m) => m.provider) ?? []),
    [catalog],
  );
  const capabilities = useMemo(
    () => unique((catalog ?? []).flatMap((m) => m.capabilities ?? [])),
    [catalog],
  );
  const useCases = useMemo(() => unique(catalog?.map((m) => m.use_case ?? "") ?? []), [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    let list = catalog.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q))
        return false;
      if (provider && m.provider !== provider) return false;
      if (capability && !(m.capabilities ?? []).includes(capability)) return false;
      if (useCase && (m.use_case ?? "") !== useCase) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "params":
          return (b.parameters_raw ?? 0) - (a.parameters_raw ?? 0);
        case "context":
          return (b.context_length ?? 0) - (a.context_length ?? 0);
        case "ram":
          return (a.recommended_ram_gb ?? 0) - (b.recommended_ram_gb ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [catalog, query, sort, provider, capability, useCase]);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!catalog) return <p className="text-xs text-gray-500">Loading model catalog…</p>;

  const shown = filtered.slice(0, 200);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search models…"
        className="w-full rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex flex-wrap gap-2">
        <Select value={sort} onChange={(v) => setSort(v as typeof sort)} label="Sort">
          <option value="name">Name</option>
          <option value="params">Parameters</option>
          <option value="context">Context</option>
          <option value="ram">RAM</option>
        </Select>
        <Select value={provider} onChange={setProvider} label="Provider">
          <option value="">All</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={capability} onChange={setCapability} label="Capability">
          <option value="">All</option>
          {capabilities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={useCase} onChange={setUseCase} label="Use case">
          <option value="">All</option>
          {useCases.map((u) => (
            <option key={u} value={u}>
              {u || "—"}
            </option>
          ))}
        </Select>
      </div>

      <p className="text-xs text-gray-500">
        {filtered.length.toLocaleString()} models
        {filtered.length > shown.length && ` · showing first ${shown.length}`}
      </p>

      <ul className="space-y-1">
        {shown.map((m) => (
          <li key={m.name}>
            <button
              onClick={() => setSelected(m)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-800">{m.name}</span>
                <span className="block text-xs text-gray-500">
                  {m.parameter_count} · {m.quantization ?? "—"} ·{" "}
                  {m.context_length ? `${(m.context_length / 1000).toFixed(0)}k` : "—"} ctx
                </span>
              </span>
              <InstallButton query={m.name} compact />
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <ModelDetail model={selected} onClose={() => setSelected(null)} />
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
    <label className="flex items-center gap-1 text-xs text-gray-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {children}
      </select>
    </label>
  );
}

function ModelDetail({ model, onClose }: { model: CatalogModel; onClose: () => void }) {
  const rows: [string, string | undefined][] = [
    ["Provider", model.provider],
    ["Parameters", model.parameter_count],
    ["Quantization", model.quantization],
    ["Context length", model.context_length?.toLocaleString()],
    ["Min RAM", model.min_ram_gb != null ? `${model.min_ram_gb} GB` : undefined],
    ["Recommended RAM", model.recommended_ram_gb != null ? `${model.recommended_ram_gb} GB` : undefined],
    ["Min VRAM", model.min_vram_gb != null ? `${model.min_vram_gb} GB` : undefined],
    ["Architecture", model.architecture],
    ["Use case", model.use_case],
    ["License", model.license],
    ["MoE", model.is_moe ? "yes" : "no"],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{model.name}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800" aria-label="Close">
            ✕
          </button>
        </div>
        <dl className="mt-3 space-y-1.5">
          {rows
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 text-sm">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right text-gray-800">{v}</dd>
              </div>
            ))}
        </dl>
        {model.capabilities && model.capabilities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {model.capabilities.map((c) => (
              <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {c}
              </span>
            ))}
          </div>
        )}
        {model.gguf_sources && model.gguf_sources.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500">GGUF sources</p>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
              {model.gguf_sources.map((s) => (
                <li key={s.repo}>{s.provider}: {s.repo}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <InstallButton query={model.name} />
        </div>
      </div>
    </div>
  );
}

// ---- one-click install with live progress --------------------------------

function InstallButton({ query, compact }: { query: string; compact?: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    listen<{ query: string; line: string }>("llmfit-progress", (e) => {
      if (e.payload.query !== query) return;
      const line = e.payload.line;
      setLines((l) => [...l.slice(-40), line]);
      const m = line.match(/(\d{1,3})%/);
      if (m) setPct(parseInt(m[1], 10));
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
    info(`Installing model: ${query}`);
    setDownloading(true);
    setDone(false);
    setError(null);
    setLines([]);
    setPct(null);
    try {
      await invoke("download_model_llmfit", { query });
    } catch (e) {
      logErr(`Model install of ${query} failed: ${String(e)}`);
      setDownloading(false);
      setError(String(e));
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={start}
        disabled={downloading}
        className={`rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 ${
          compact ? "" : "w-full"
        }`}
      >
        {downloading ? "Downloading…" : done ? "Downloaded" : "Install"}
      </button>
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
      {downloading && (
        <div className="mt-2">
          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          {lines.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-gray-500">
              {lines.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---- utils ----------------------------------------------------------------

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
