import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import * as Tooltip from "@radix-ui/react-tooltip";
import { invoke } from "@tauri-apps/api/core";

const workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Definition {
  term: string;
  explanation: string;
}

interface Section {
  label: string;
  page: number;
}

interface PdfViewerProps {
  file: Uint8Array;
  pageNum?: number;
  definitions?: Definition[];
  sections?: Section[];
  onJump?: (page: number) => void;
}

interface Hover {
  term: string;
  explanation: string;
  // Trigger rect, relative to the wrapper, so the anchor tracks the span.
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PdfViewer({
  file,
  pageNum = 1,
  definitions = [],
  sections = [],
  onJump,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [summaries, setSummaries] = useState<{ text: string; y: number; page: number }[]>([]);
  const [scale, setScale] = useState(1.5);
  const [fitWidth, setFitWidth] = useState(false);
  const [scaleLabel, setScaleLabel] = useState("150%");
  const [rendering, setRendering] = useState(false);

  // Terms sorted longest-first so the most specific match wins.
  const terms = useMemo(
    () =>
      [...definitions]
        .filter((d) => d.term.trim())
        .sort((a, b) => b.term.length - a.term.length)
        .map((d) => ({ ...d, lc: d.term.toLowerCase() })),
    [definitions],
  );

  // Section labels, longest-first so "Section 4(b)" wins over "Section 4".
  const secList = useMemo(
    () =>
      [...sections]
        .filter((s) => s.label.trim())
        .sort((a, b) => b.label.length - a.label.length)
        .map((s) => ({ ...s, lc: s.label.toLowerCase() })),
    [sections],
  );

  // Build the hover payload for a term span: its bounding rect (relative to
  // the wrapper) plus the matched definition. Shared by mouse and keyboard.
  const setHoverForSpan = (span: HTMLElement) => {
    const text = (span.textContent ?? "").toLowerCase();
    const match = terms.find((t) => text.includes(t.lc));
    if (!match) {
      setHover(null);
      return;
    }
    const wrap = wrapRef.current!.getBoundingClientRect();
    const r = span.getBoundingClientRect();
    setHover({
      term: match.term,
      explanation: match.explanation,
      left: r.left - wrap.left,
      top: r.top - wrap.top,
      width: r.width,
      height: r.height,
    });
  };

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    (async () => {
      // pdf.js transfers (detaches) the ArrayBuffer it's handed to its worker,
      // which would zero out our `file` prop and blank the viewer on the next
      // re-render (e.g. when a hover opens a card). Hand it a copy instead.
      const pdf = await pdfjsLib.getDocument({ data: file.slice() }).promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const unscaledW = page.getViewport({ scale: 1 }).width;
      let useScale = scale;
      if (fitWidth) {
        // Fit the page within the available column (notes panel + gutters).
        const avail = (wrapRef.current?.parentElement?.clientWidth ?? 800) - 296;
        useScale = Math.max(0.25, avail / unscaledW);
      }
      const viewport = page.getViewport({ scale: useScale });

      // Render the page bitmap at natural size (no CSS downscale) so the text
      // overlay's pixel coordinates line up 1:1 with the canvas.
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      if (cancelled) return;

      if (wrapRef.current) {
        wrapRef.current.style.width = `${viewport.width}px`;
        wrapRef.current.style.height = `${viewport.height}px`;
      }

      // Transparent, natively-selectable text layer. pdf.js's TextLayer does the
      // per-item top/left/font-size/transform math (positions as % of the raw
      // page box); we only feed it the scale so absolute font sizes match the
      // canvas. --total-scale-factor = viewport.scale because TextLayer's own
      // transform is unit-scale and page dims are raw PDF points.
      const textLayerDiv = textLayerRef.current!;
      textLayerDiv.replaceChildren();
      textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
      textLayerDiv.style.setProperty("--scale-round-x", "1px");
      textLayerDiv.style.setProperty("--scale-round-y", "1px");
      const textContent = await page.getTextContent();
      if (cancelled) return;
      await new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      }).render();
      if (cancelled) return;

      // Mark defined terms and cross-references in the transparent text layer.
      // Terms get a dotted underline cue AND are made focusable (role=button,
      // tabIndex) so keyboard/SR users can open the definition — not hover-only.
      // Cross-references are operable links (Enter/Space jumps to the page).
      for (const span of textLayerDiv.querySelectorAll<HTMLElement>(":scope > span")) {
        const t = (span.textContent ?? "").toLowerCase();
        const termHit = terms.find((tm) => t.includes(tm.lc));
        if (termHit) {
          span.classList.add("lexis-term");
          span.tabIndex = 0;
          span.setAttribute("role", "button");
          span.setAttribute("aria-label", `${termHit.term} — definition available`);
        }
        const refHit = secList.find((s) => t.includes(s.lc));
        if (refHit) {
          span.classList.add("lexis-ref");
          span.tabIndex = 0;
          span.setAttribute("role", "link");
          span.dataset.jumpPage = String(refHit.page);
        }
      }

      if (!cancelled) {
        setScaleLabel(`${Math.round(useScale * 100)}%`);
        setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageNum, secList, terms, scale, fitWidth]);

  const onClick = (e: React.MouseEvent) => {
    const ref = (e.target as HTMLElement).closest<HTMLElement>(".lexis-ref");
    const page = ref?.dataset.jumpPage;
    if (page) onJump?.(Number(page));
  };

  // Event delegation: a single mouseover on the text layer finds the span under
  // the cursor and matches its text against a defined term. Cheaper than a
  // listener per span and survives TextLayer re-renders.
  const onMouseOver = (e: React.MouseEvent) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>(".textLayer > span");
    if (span?.classList.contains("lexis-term")) setHoverForSpan(span);
  };

  // Keyboard parity: focusing a term opens its definition; Enter/Space on a
  // cross-reference jumps to the target page.
  const onFocusIn = (e: React.FocusEvent) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>(".textLayer > span");
    if (span?.classList.contains("lexis-term")) setHoverForSpan(span);
  };

  const onFocusOut = (e: React.FocusEvent) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>(".textLayer > span");
    if (span?.classList.contains("lexis-term")) setHover(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ref = (e.target as HTMLElement).closest<HTMLElement>(".lexis-ref");
    if (ref && (e.key === "Enter" || e.key === " ")) {
      const page = ref.dataset.jumpPage;
      if (page) {
        e.preventDefault();
        onJump?.(Number(page));
      }
    }
  };

  const zoomIn = () => {
    setFitWidth(false);
    setScale((s) => Math.min(4, Math.round((s + 0.25) * 100) / 100));
  };
  const zoomOut = () => {
    setFitWidth(false);
    setScale((s) => Math.max(0.5, Math.round((s - 0.25) * 100) / 100));
  };

  const handleSimplify = useCallback(async () => {
    if (!selection || simplifying) return;
    setSimplifying(true);
    try {
      const result = await invoke<string>("simplify_text", { text: selection.text });
      setSummaries((prev) => [...prev, { text: result, y: selection.y, page: pageNum }]);
      setSelection(null);
    } catch {
      setSelection(null);
    } finally {
      setSimplifying(false);
    }
  }, [selection, simplifying, pageNum]);

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const range = sel?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    if (!rect || !wrapRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    setSelection({
      text,
      x: rect.left - wrap.left,
      y: rect.top - wrap.top - 4,
    });
  };

  if (!file.length) return null;
  return (
    <Tooltip.Provider delayDuration={120}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <button
            onClick={zoomOut}
            aria-label="Zoom out"
            className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-100"
          >
            −
          </button>
          <button
            onClick={zoomIn}
            aria-label="Zoom in"
            className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-100"
          >
            +
          </button>
          <button
            onClick={() => setFitWidth(true)}
            aria-pressed={fitWidth}
            className={`rounded border px-2 py-1 hover:bg-gray-100 ${fitWidth ? "border-blue-300 text-blue-700" : "border-gray-200"}`}
          >
            Fit
          </button>
          <span className="tabular-nums w-12 text-center">{scaleLabel}</span>
        </div>
        <div className="flex gap-4">
        <div
          ref={wrapRef}
          className="relative border border-gray-200 rounded shrink-0"
          onMouseOver={onMouseOver}
          onMouseLeave={() => setHover(null)}
          onFocus={onFocusIn}
          onBlur={onFocusOut}
          onKeyDown={onKeyDown}
          onClick={onClick}
          onMouseUp={onMouseUp}
        >
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} className="textLayer" />
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 bg-white/70" role="status">
              Rendering page…
            </div>
          )}
          {hover && (
            <Tooltip.Root open>
              <Tooltip.Trigger asChild>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: hover.left,
                    top: hover.top,
                    width: hover.width,
                    height: hover.height,
                    pointerEvents: "none",
                  }}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="top"
                  align="center"
                  sideOffset={6}
                  collisionPadding={8}
                  className="lexis-card z-50 max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-none"
                >
                  <span className="block font-semibold text-gray-900">{hover.term}</span>
                  <span className="mt-0.5 block leading-snug text-gray-600">
                    {hover.explanation}
                  </span>
                  <Tooltip.Arrow className="fill-gray-200" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}
          {selection && !simplifying && (
            <button
              className="absolute z-50 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white shadow-none hover:bg-blue-700"
              style={{ left: selection.x, top: Math.max(0, selection.y - 32) }}
              onMouseDown={(e) => { e.preventDefault(); handleSimplify(); }}
            >
              Simplify
            </button>
          )}
          {simplifying && (
            <div
              className="absolute z-50 rounded bg-gray-500/80 px-3 py-1 text-sm text-white"
              style={{ left: selection!.x, top: Math.max(0, selection!.y - 32) }}
              role="status"
            >
              Simplifying...
            </div>
          )}
        </div>
        <div className="w-[280px] shrink-0">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Simplifications
          </div>
          <div className="space-y-2">
            {summaries.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-snug text-gray-800"
              >
                <div className="mb-1 text-xs font-semibold text-gray-500">
                  Simplified · Page {s.page}
                </div>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
