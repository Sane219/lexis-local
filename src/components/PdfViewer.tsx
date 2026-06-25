import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";

const workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const SCALE = 1.5;

interface PdfViewerProps {
  file: Uint8Array;
  pageNum?: number;
}

export function PdfViewer({ file, pageNum = 1 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdf = await pdfjsLib.getDocument({ data: file }).promise;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageNum]);

  if (!file.length) return null;
  return (
    <div
      ref={wrapRef}
      className="relative border border-gray-300 rounded shadow-sm"
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
}
