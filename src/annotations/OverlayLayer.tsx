import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PageViewport } from "pdfjs-dist";
import { runtimes } from "../app/registry";
import { useStore } from "../app/store";
import { distanceToStroke, pointInQuad, simplify, svgPathData } from "./geometry";
import type { Annotation, TextAnnotation } from "./model";
import { annotationBounds, newId, nowIso, NOTE_ICON_SIZE, rgbToCss, TEXT_LINE_HEIGHT, TEXT_PADDING } from "./model";
import { AnnotationPopover } from "./AnnotationPopover";
import { measureText, TEXT_FONT_FAMILY } from "./measure";
import { boxSize, innerWidth, layoutLines } from "./textLayout";

interface Props {
  tabId: string;
  pageIndex: number;
  viewport: PageViewport;
  annotations: Annotation[];
  readOnly: boolean;
}

/** Ekran noktasını (clientX/Y) sayfanın PDF kullanıcı uzayına çevirir. */
export function clientToPdf(el: Element, viewport: PageViewport, clientX: number, clientY: number): [number, number] {
  const r = el.getBoundingClientRect();
  const x = ((clientX - r.left) * viewport.width) / r.width;
  const y = ((clientY - r.top) * viewport.height) / r.height;
  const [px, py] = viewport.convertToPdfPoint(x, y);
  return [px, py];
}

/** PDF noktasındaki en üstteki annotation. `tolerance` PDF birimindedir. */
export function hitTest(annotations: Annotation[], x: number, y: number, tolerance: number): Annotation | undefined {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.kind === "text") {
      const [minX, minY, maxX, maxY] = annotationBounds(a);
      if (x >= minX - tolerance && x <= maxX + tolerance && y >= minY - tolerance && y <= maxY + tolerance) return a;
    } else if (a.kind === "note") {
      if (x >= a.x - tolerance && x <= a.x + NOTE_ICON_SIZE + tolerance && y <= a.y + tolerance && y >= a.y - NOTE_ICON_SIZE - tolerance) return a;
    } else if (a.kind === "ink") {
      if (a.strokes.some((s) => distanceToStroke(x, y, s) <= a.width / 2 + tolerance)) return a;
    } else if (a.quads.some((q) => pointInQuad(x, y, q))) {
      return a;
    }
  }
  return undefined;
}

export function PageOverlay({ tabId, pageIndex, viewport, annotations, readOnly }: Props) {
  const tool = useStore((s) => s.tool);
  const inkColor = useStore((s) => s.inkColor);
  const inkWidth = useStore((s) => s.inkWidth);
  const selectedId = useStore((s) => s.selectedAnnotationId);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const erasing = useRef(false);

  // viewport.scale CSS birimlerini de içerir; 1 ekran pikseli ≈ 1/scale PDF birimi.
  const pxToPdf = 1 / viewport.scale;
  const interactive = !readOnly && (tool === "pen" || tool === "eraser" || tool === "note");

  const toPdf = (e: ReactPointerEvent) => clientToPdf(svgRef.current!, viewport, e.clientX, e.clientY);

  const eraseAt = (e: ReactPointerEvent) => {
    const [x, y] = toPdf(e);
    const hit = hitTest(annotations, x, y, 6 * pxToPdf);
    if (hit) useStore.getState().removeAnnotation(tabId, hit.id);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    if (tool === "pen") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft(toPdf(e));
    } else if (tool === "eraser") {
      e.currentTarget.setPointerCapture(e.pointerId);
      erasing.current = true;
      eraseAt(e);
    } else if (tool === "note") {
      const [x, y] = toPdf(e);
      const store = useStore.getState();
      // Var olan bir metin kutusuna tıklandıysa yenisini açma, onu düzenle.
      const existing = hitTest(annotations.filter((a) => a.kind === "text"), x, y, 2 * pxToPdf);
      if (existing) {
        store.setTool("select");
        store.selectAnnotation(existing.id);
        return;
      }
      const fontSize = store.textSize;
      const size = boxSize([""], fontSize, measureText);
      const text: TextAnnotation = {
        kind: "text",
        id: newId(),
        pageIndex,
        color: store.textColor,
        opacity: 1,
        contents: "",
        modified: nowIso(),
        // İmleç ilk satırın ortasına gelsin.
        x: x - TEXT_PADDING,
        y: y + (fontSize * TEXT_LINE_HEIGHT) / 2 + TEXT_PADDING,
        width: size.width,
        height: size.height,
        fontSize,
      };
      store.addAnnotation(tabId, text, { record: false });
      store.setTool("select");
      store.selectAnnotation(text.id);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === "pen" && draft) {
      // Yüksek frekanslı kalem/trackpad olaylarını da yakala.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      const pts = events.flatMap((ev) => clientToPdf(svgRef.current!, viewport, ev.clientX, ev.clientY));
      setDraft((d) => (d ? [...d, ...pts] : d));
    } else if (tool === "eraser" && erasing.current) {
      eraseAt(e);
    }
  };

  const onPointerUp = () => {
    erasing.current = false;
    if (tool !== "pen" || !draft) return;
    const stroke = simplify(draft, 0.5 * pxToPdf);
    setDraft(null);
    useStore.getState().addAnnotation(tabId, {
      kind: "ink",
      id: newId(),
      pageIndex,
      color: inkColor,
      opacity: 1,
      contents: "",
      modified: nowIso(),
      strokes: [stroke],
      width: inkWidth,
    });
  };

  const selected = annotations.find((a) => a.id === selectedId);
  const matrix = `matrix(${viewport.transform.join(" ")})`;

  return (
    <>
      <svg
        ref={svgRef}
        className={`ann-overlay tool-${tool}`}
        style={{ pointerEvents: interactive ? "auto" : "none" }}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={matrix}>
          <g className="ann-highlights">
            {annotations.map((a) =>
              a.kind === "highlight" ? (
                // Tek path: kalın highlight'ta satırlar çakışırsa yarı saydamda koyulaşmasın.
                <path
                  key={a.id}
                  fill={rgbToCss(a.color)}
                  opacity={a.opacity}
                  d={a.quads.map((q) => `M${q[0]} ${q[1]}L${q[2]} ${q[3]}L${q[6]} ${q[7]}L${q[4]} ${q[5]}Z`).join("")}
                />
              ) : null,
            )}
          </g>
          {annotations.map((a) =>
            a.kind === "ink" ? (
              <g key={a.id} stroke={rgbToCss(a.color)} strokeWidth={a.width} opacity={a.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
                {a.strokes.map((s, i) => (
                  <path key={i} d={svgPathData(s)} />
                ))}
              </g>
            ) : null,
          )}
          {annotations.map((a) => (a.kind === "note" ? <NoteIcon key={a.id} ann={a} /> : null))}
          {draft && (
            <path
              d={svgPathData(draft)}
              stroke={rgbToCss(inkColor)}
              strokeWidth={inkWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {selected && selected.kind !== "text" && <SelectionOutline ann={selected} pad={3 * pxToPdf} strokeWidth={1.5 * pxToPdf} />}
        </g>
      </svg>
      {annotations.map((a) =>
        a.kind === "text" ? (
          <TextBox
            key={a.id}
            tabId={tabId}
            ann={a}
            viewport={viewport}
            editing={a.id === selectedId && !readOnly}
          />
        ) : null,
      )}
      {selected && !readOnly && (
        <AnnotationPopover key={selected.id} tabId={tabId} ann={selected} viewport={viewport} />
      )}
    </>
  );
}

function NoteIcon({ ann }: { ann: Extract<Annotation, { kind: "note" }> }) {
  const s = NOTE_ICON_SIZE;
  const dark = rgbToCss(ann.color.map((c) => c * 0.55) as [number, number, number]);
  const y0 = ann.y - s;
  return (
    <g>
      <rect x={ann.x + 0.5} y={y0 + 0.5} width={s - 1} height={s - 1} rx={2} fill={rgbToCss(ann.color)} stroke={dark} strokeWidth={1} />
      {[0.72, 0.5, 0.28].map((f) => (
        <line key={f} x1={ann.x + 4} x2={ann.x + s - 4} y1={y0 + s * f} y2={y0 + s * f} stroke={dark} strokeWidth={1.2} />
      ))}
    </g>
  );
}

function SelectionOutline({ ann, pad, strokeWidth }: { ann: Annotation; pad: number; strokeWidth: number }) {
  const [minX, minY, maxX, maxY] = annotationBounds(ann);
  return (
    <rect
      className="ann-selection"
      x={minX - pad}
      y={minY - pad}
      width={maxX - minX + 2 * pad}
      height={maxY - minY + 2 * pad}
      fill="none"
      strokeWidth={strokeWidth}
      strokeDasharray={`${strokeWidth * 3} ${strokeWidth * 2}`}
    />
  );
}

/** Sayfa üzerinde görünen metin notu; seçiliyken yerinde düzenlenir, sürüklenerek taşınır. */
function TextBox({ tabId, ann, viewport, editing }: { tabId: string; ann: TextAnnotation; viewport: PageViewport; editing: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const tool = useStore((s) => s.tool);
  /** Sürükleme sırasında kutunun ekrandaki sol-üst köşesi; bırakınca tek adımda kaydedilir. */
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [left, top] = viewport.convertToViewportPoint(ann.x, ann.y);
  const scale = viewport.scale;
  const style: React.CSSProperties = {
    ...(drag ? { position: "fixed", left: drag.left, top: drag.top, zIndex: 1000 } : { left, top }),
    width: ann.width * scale,
    height: ann.height * scale,
    padding: TEXT_PADDING * scale,
    fontSize: ann.fontSize * scale,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY,
    color: rgbToCss(ann.color),
  };

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // Font boyutu popover'dan değişince kutu boyutunu yeniden hesapla.
  useEffect(() => {
    if (!editing) return;
    const lines = layoutLines(ann.contents, ann.fontSize, maxTextWidth(ann, viewport), measureText);
    const size = boxSize(lines, ann.fontSize, measureText);
    if (Math.abs(size.width - ann.width) > 0.5 || Math.abs(size.height - ann.height) > 0.5) {
      useStore.getState().updateAnnotation(tabId, ann.id, size);
    }
    // Sadece font boyutu değiştiğinde.
  }, [ann.fontSize]);

  /**
   * Kutuyu sürükler; bırakılan noktadaki sayfaya taşır (sayfalar arası da).
   * 3 pikselden az hareket bir tıklamadır: `clickToEdit` ise düzenlemeye geçer.
   */
  const startDrag = (e: ReactPointerEvent<HTMLElement>, clickToEdit: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const host = target.parentElement!;
    const hostRect = host.getBoundingClientRect();
    const k = hostRect.width / viewport.width;
    // İmlecin kutunun sol-üst köşesine göre konumu (ekran pikseli).
    const grabX = e.clientX - (hostRect.left + left * k);
    const grabY = e.clientY - (hostRect.top + top * k);
    const startClient = [e.clientX, e.clientY];
    let moved = false;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startClient[0], ev.clientY - startClient[1]) < 3) return;
      moved = true;
      setDrag({ left: ev.clientX - grabX, top: ev.clientY - grabY });
    };
    const end = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setDrag(null);
      if (!moved) {
        if (clickToEdit) useStore.getState().selectAnnotation(ann.id);
        return;
      }
      const dropped = dropTarget(tabId, host, ev.clientX, ev.clientY) ?? { pageIndex: ann.pageIndex, host, viewport };
      const [x, y] = clientToPdf(dropped.host, dropped.viewport, ev.clientX - grabX, ev.clientY - grabY);
      const pos = clampToPage(x, y, ann.width, ann.height, dropped.viewport);
      if (dropped.pageIndex !== ann.pageIndex || pos.x !== ann.x || pos.y !== ann.y) {
        useStore.getState().updateAnnotation(tabId, ann.id, { pageIndex: dropped.pageIndex, ...pos });
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  if (editing) {
    return (
      <>
        <div
          className="ann-text-handle"
          style={drag ? { position: "fixed", left: drag.left - 16, top: drag.top - 16, zIndex: 1001 } : { left: left - 16, top: top - 16 }}
          title="Taşımak için sürükle"
          onPointerDown={(e) => startDrag(e, false)}
          onClick={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            {[1.5, 5, 8.5].flatMap((x) => [2.5, 7.5].map((y) => <circle key={`${x}-${y}`} cx={y} cy={x} r="1.1" fill="currentColor" />))}
          </svg>
        </div>
        <textarea
          ref={ref}
          className="ann-text ann-text-editor"
          style={{ ...style, width: (style.width as number) + 2 }}
          value={ann.contents}
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onChange={(e) => {
            const contents = e.target.value;
            const lines = layoutLines(contents, ann.fontSize, maxTextWidth(ann, viewport), measureText);
            useStore.getState().updateAnnotation(tabId, ann.id, { contents, ...boxSize(lines, ann.fontSize, measureText) });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              e.stopPropagation();
              useStore.getState().selectAnnotation(undefined);
            }
          }}
        />
      </>
    );
  }

  const lines = layoutLines(ann.contents, ann.fontSize, innerWidth(ann.width), measureText);
  const draggable = tool === "select" || tool === "highlight";
  return (
    <div
      className={`ann-text ${draggable ? "draggable" : ""} ${drag ? "dragging" : ""}`}
      style={style}
      onPointerDown={draggable ? (e) => startDrag(e, true) : undefined}
      onClick={(e) => draggable && e.stopPropagation()}
      onMouseUp={(e) => draggable && e.stopPropagation()}
    >
      {lines.map((line, i) => (
        <div key={i}>{line || "\u00a0"}</div>
      ))}
    </div>
  );
}

/** Ekran noktasının altındaki sayfa: indeks, overlay host'u ve viewport'u. */
function dropTarget(tabId: string, sourceHost: HTMLElement, clientX: number, clientY: number) {
  const viewer = runtimes.get(tabId)?.viewer;
  const pages = sourceHost.closest(".pdfViewer")?.querySelectorAll<HTMLElement>(".page[data-page-number]") ?? [];
  const pageEl = [...pages].find((el) => {
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  });
  if (!viewer || !pageEl) return undefined;
  const pageIndex = Number(pageEl.dataset.pageNumber) - 1;
  const pageView = viewer.getPageView(pageIndex);
  const host = pageEl.querySelector<HTMLElement>(":scope > .ann-host");
  if (!pageView || !host) return undefined;
  return { pageIndex, host, viewport: pageView.viewport };
}

/** Kutunun sol-üst köşesini, kutu sayfanın dışına taşmayacak şekilde sınırlar. */
function clampToPage(x: number, y: number, width: number, height: number, viewport: PageViewport): { x: number; y: number } {
  const [x1, y1, x2, y2] = viewport.viewBox;
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return {
    x: Math.min(Math.max(x, minX), Math.max(minX, maxX - width)),
    y: Math.min(Math.max(y, minY + height), maxY),
  };
}

/** Metin kutusunun sayfanın sağ kenarına taşmadan alabileceği en geniş metin alanı. */
function maxTextWidth(ann: TextAnnotation, viewport: PageViewport): number {
  const pageRight = Math.max(viewport.viewBox[0], viewport.viewBox[2]);
  return Math.max(ann.fontSize * 2, pageRight - ann.x - 2 * TEXT_PADDING - 8);
}
