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

const SCALE = 1.5;

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
  const markedRef = useRef<HTMLElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [summaries, setSummaries] = useState<{ text: string; y: number }[]>([]);

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

  // Affordance: the span under the cursor only looks interactive while it
  // matches a term. Clearing the previous mark keeps one term cued at a time.
  const mark = (span: HTMLElement | null) => {
    if (markedRef.current === span) return;
    markedRef.current?.classList.remove("lexis-term");
    span?.classList.add("lexis-term");
    markedRef.current = span;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // pdf.js transfers (detaches) the ArrayBuffer it's handed to its worker,
      // which would zero out our `file` prop and blank the viewer on the next
      // re-render (e.g. when a hover opens a card). Hand it a copy instead.
      const pdf = await pdfjsLib.getDocument({ data: file.slice() }).promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: SCALE });

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

      // Phase 3.6: mark spans that mention a section as cross-reference links.
      // The span text is transparent (it overlays the canvas glyphs), so the
      // link cue is an underline + tint, not colored text. data-jump-page lets
      // the delegated click handler jump without per-span listeners.
      if (secList.length) {
        for (const span of textLayerDiv.querySelectorAll<HTMLElement>(":scope > span")) {
          const t = (span.textContent ?? "").toLowerCase();
          const hit = secList.find((s) => t.includes(s.lc));
          if (hit) {
            span.classList.add("lexis-ref");
            span.dataset.jumpPage = String(hit.page);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageNum, secList]);

  const onClick = (e: React.MouseEvent) => {
    const ref = (e.target as HTMLElement).closest<HTMLElement>(".lexis-ref");
    const page = ref?.dataset.jumpPage;
    if (page) onJump?.(Number(page));
  };

  // Event delegation: a single mouseover on the text layer finds the span under
  // the cursor and matches its text against a defined term. Cheaper than a
  // listener per span and survives TextLayer re-renders.
  const onMouseOver = (e: React.MouseEvent) => {
    if (!terms.length) return;
    const span = (e.target as HTMLElement).closest<HTMLElement>(".textLayer > span");
    if (!span) return;
    const text = (span.textContent ?? "").toLowerCase();
    if (!text.trim()) return;
    const match = terms.find((t) => text.includes(t.lc));
    if (!match) {
      mark(null);
      setHover(null);
      return;
    }
    mark(span);
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

  const clear = () => {
    mark(null);
    setHover(null);
  };

  const handleSimplify = useCallback(async () => {
    if (!selection || simplifying) return;
    setSimplifying(true);
    try {
      const result = await invoke<string>("simplify_text", { text: selection.text });
      setSummaries((prev) => [...prev, { text: result, y: selection.y }]);
      setSelection(null);
    } catch {
      setSelection(null);
    } finally {
      setSimplifying(false);
    }
  }, [selection, simplifying]);

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
      <div className="flex gap-4">
        <div
          ref={wrapRef}
          className="relative border border-gray-300 rounded shadow-sm shrink-0"
          onMouseOver={onMouseOver}
          onMouseLeave={clear}
          onClick={onClick}
          onMouseUp={onMouseUp}
        >
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} className="textLayer" />
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
                  className="lexis-card z-50 max-w-xs rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 shadow-lg"
                >
                  <span className="block font-semibold text-white">{hover.term}</span>
                  <span className="mt-0.5 block leading-snug text-gray-300">
                    {hover.explanation}
                  </span>
                  <Tooltip.Arrow className="fill-gray-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}
          {selection && !simplifying && (
            <button
              className="absolute z-50 rounded bg-amber-500 px-3 py-1 text-sm font-medium text-white shadow-lg hover:bg-amber-400"
              style={{ left: selection.x, top: selection.y - 32 }}
              onMouseDown={(e) => { e.preventDefault(); handleSimplify(); }}
            >
              Simplify
            </button>
          )}
          {simplifying && (
            <div
              className="absolute z-50 rounded bg-amber-500/80 px-3 py-1 text-sm text-white"
              style={{ left: selection!.x, top: selection!.y - 32 }}
            >
              Simplifying...
            </div>
          )}
        </div>
        <div className="w-[280px] shrink-0">
          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Margin Notes
          </div>
          <div className="relative">
            {summaries.map((s, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-snug text-gray-800 shadow-sm"
                style={{ top: s.y }}
              >
                <div className="mb-1 text-xs font-semibold text-amber-600">Simplified</div>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
