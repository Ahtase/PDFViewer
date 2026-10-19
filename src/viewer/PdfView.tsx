import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnnotationMode } from "pdfjs-dist";
import {
  EventBus,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { runtimes } from "../app/registry";
import { useStore, type Tab } from "../app/store";
import { mergeLineRects, quadFromCorners, scaleBoxHeight, type Box } from "../annotations/geometry";
import { selectionBoxes } from "./selectionGeometry";
import type { Annotation, Rgb } from "../annotations/model";
import { newId, nowIso } from "../annotations/model";
import { PaletteSwatches } from "../app/PaletteSwatches";
import { clientToPdf, hitTest, PageOverlay } from "../annotations/OverlayLayer";

/** Tekerlek tıkı başına yakınlaştırma oranı. */
const ZOOM_STEP = 1.1;

interface Props {
  tab: Tab;
  active: boolean;
}

interface PendingSelection {
  /** Seçim araç çubuğunun ekran konumu. */
  x: number;
  y: number;
}

export function PdfView({ tab, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const [mountedPages, setMountedPages] = useState<number[]>([]);
  const [, setViewTick] = useState(0);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  /** Metin seçimiyle biten mouseup'tan sonra gelen click annotation seçmesin. */
  const suppressClick = useRef(false);
  const selectedTool = useStore((s) => s.tool);
  /** Boşluk basılıyken geçici olarak el aracı. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const tool = spaceHeld ? "pan" : selectedTool;
  const readOnly = !!tab.readOnlyReason;

  useEffect(() => {
    const rt = runtimes.get(tab.id);
    if (!rt) return;
    const container = containerRef.current!;
    // StrictMode'da effect iki kez çalışır; sökülmüş viewer'ın geç gelen olaylarını yok say.
    let disposed = false;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container,
      viewer: viewerRef.current!,
      eventBus,
      linkService,
      findController,
      // ENABLE_STORAGE: annotationStorage'daki noView işaretleri canvas render'ında dikkate alınır.
      annotationMode: AnnotationMode.ENABLE_STORAGE,
      textLayerMode: 1,
    });
    linkService.setViewer(viewer);
    Object.assign(rt, { viewer, eventBus, linkService, findController });

    // pdf.js sayfayı sıfırlarken tanımadığı çocuk düğümleri siler; overlay host'larını geri ekle.
    const attach = (pageIndex: number) => {
      if (disposed) return;
      const pageView = viewer.getPageView(pageIndex);
      if (!pageView?.div) return;
      let host = hosts.current.get(pageIndex);
      if (!host) {
        host = document.createElement("div");
        host.className = "ann-host";
        hosts.current.set(pageIndex, host);
        setMountedPages((p) => [...p, pageIndex].sort((a, b) => a - b));
      }
      if (host.parentElement !== pageView.div) pageView.div.append(host);
    };
    const reattachAll = () => {
      for (const i of hosts.current.keys()) attach(i);
      setViewTick((t) => t + 1);
    };

    eventBus.on("pagesinit", () => {
      if (!disposed) viewer.currentScaleValue = "auto";
    });
    eventBus.on("pagerender", ({ pageNumber }: { pageNumber: number }) => attach(pageNumber - 1));
    eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
      attach(pageNumber - 1);
      setViewTick((t) => t + 1);
    });
    eventBus.on("scalechanging", ({ scale }: { scale: number }) => {
      useStore.getState().updateTab(tab.id, { scale });
      reattachAll();
    });
    eventBus.on("rotationchanging", reattachAll);
    eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) =>
      useStore.getState().updateTab(tab.id, { currentPage: pageNumber }),
    );

    // Yüklemeden önce ayarlanırsa pdf.js sayfaları doğrudan bu düzende yerleştirir.
    viewer.spreadMode = useStore.getState().pageLayout;
    viewer.setDocument(rt.pdfDoc);
    linkService.setDocument(rt.pdfDoc);

    // Kenar çubuğu/pencere boyutu değişince sığdırma modlarını yeni genişliğe göre uygula.
    let raf = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (disposed || container.clientWidth === 0 || !viewer.pdfDocument) return;
        const mode = viewer.currentScaleValue;
        if (mode === "auto" || mode === "page-width" || mode === "page-fit") viewer.currentScaleValue = mode;
        else viewer.update();
      });
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      viewer.setDocument(null as never);
      linkService.setDocument(null);
      for (const host of hosts.current.values()) host.remove();
      hosts.current.clear();
      setMountedPages([]);
      Object.assign(rt, { viewer: undefined, eventBus: undefined, linkService: undefined, findController: undefined });
    };
  }, [tab.id]);

  const pageLayout = useStore((s) => s.pageLayout);
  useEffect(() => {
    const viewer = runtimes.get(tab.id)?.viewer;
    if (viewer) viewer.spreadMode = pageLayout;
  }, [pageLayout, tab.id]);

  // Gizli sekmede container 0 boyutlu olur; görünür olunca pdf.js'e yeniden ölçtür.
  useEffect(() => {
    if (active) runtimes.get(tab.id)?.viewer?.update();
  }, [active, tab.id]);

  /** Seçimdeki satır dikdörtgenlerini sayfa sayfa PDF quad'larına çevirir. */
  const selectionQuads = useCallback((): { pageIndex: number; quads: number[][] }[] => {
    const sel = window.getSelection();
    const viewer = runtimes.get(tab.id)?.viewer;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !viewer) return [];
    const range = sel.getRangeAt(0);
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return [];

    const byPage = new Map<number, Box[]>();
    const pageRects = [...hosts.current].map(([i, host]) => [i, host.getBoundingClientRect()] as const);
    for (const r of selectionBoxes(range)) {
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const page = pageRects.find(([, pr]) => cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom);
      if (!page) continue;
      const list = byPage.get(page[0]) ?? [];
      list.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      byPage.set(page[0], list);
    }

    const result: { pageIndex: number; quads: number[][] }[] = [];
    for (const [pageIndex, rects] of [...byPage].sort((a, b) => a[0] - b[0])) {
      const host = hosts.current.get(pageIndex)!;
      const viewport = viewer.getPageView(pageIndex).viewport;
      const thickness = useStore.getState().highlightThickness;
      const quads = mergeLineRects(rects).map((line) => scaleBoxHeight(line, thickness)).map((b) =>
        quadFromCorners([
          clientToPdf(host, viewport, b.left, b.top),
          clientToPdf(host, viewport, b.right, b.top),
          clientToPdf(host, viewport, b.left, b.bottom),
          clientToPdf(host, viewport, b.right, b.bottom),
        ]),
      );
      if (quads.length) result.push({ pageIndex, quads });
    }
    return result;
  }, [tab.id]);

  const createHighlight = useCallback(
    (color: Rgb, openNote = false) => {
      const parts = selectionQuads();
      const text = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
      const store = useStore.getState();
      let last: Annotation | undefined;
      for (const { pageIndex, quads } of parts) {
        last = {
          kind: "highlight",
          id: newId(),
          pageIndex,
          color,
          opacity: store.highlightOpacity,
          contents: "",
          modified: nowIso(),
          quads,
          text,
        };
        store.addAnnotation(tab.id, last);
      }
      if (openNote && last) store.selectAnnotation(last.id);
    },
    [selectionQuads, tab.id],
  );

  /**
   * El aracı, boşluk basılıyken ya da orta tuşla sürükleyerek kaydırma.
   * Capture aşamasında çalışır ki overlay'deki kalem/metin kutusu olayları devreye girmesin.
   */
  const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const middle = e.button === 1;
    if (!middle && !(tool === "pan" && e.button === 0)) return;
    if ((e.target as Element).closest(".ann-popover, .ann-text-editor, input, textarea, select")) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    setPanning(true);
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    // Kaydırma bittikten sonra gelen click annotation seçmesin.
    suppressClick.current = true;

    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x);
      el.scrollTop = start.top - (ev.clientY - start.y);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      setPanning(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  // Boşluk basılı tutulunca geçici el aracı (yazı yazılırken değil).
  useEffect(() => {
    if (!active) return;
    const typing = (t: EventTarget | null) => (t as Element | null)?.closest?.("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault(); // Boşluk varsayılan olarak sayfayı kaydırır.
      if (!e.repeat) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    const reset = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, [active]);

  const onMouseUp = (e: React.MouseEvent) => {
    if (readOnly || (tool !== "select" && tool !== "highlight")) return;
    if ((e.target as Element).closest(".ann-popover")) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPendingSelection(null);
      return;
    }
    suppressClick.current = true;
    if (tool === "highlight") {
      createHighlight(useStore.getState().highlightColor);
    } else {
      const rects = sel.getRangeAt(0).getClientRects();
      const last = rects[rects.length - 1];
      if (last) setPendingSelection({ x: last.right, y: last.bottom });
    }
  };

  /** Seçim modunda tıklanan noktadaki annotation'ı seç (metin seçimini engellemeden). */
  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (tool !== "select" && tool !== "highlight") return;
    const target = e.target as Element;
    if (target.closest(".ann-popover, a, input, textarea, select, button")) return;
    if (window.getSelection()?.isCollapsed === false) return;
    const viewer = runtimes.get(tab.id)?.viewer;
    const pageEl = target.closest<HTMLElement>(".page");
    if (!viewer || !pageEl) return useStore.getState().selectAnnotation(undefined);
    const pageIndex = Number(pageEl.dataset.pageNumber) - 1;
    const host = hosts.current.get(pageIndex);
    if (!host) return;
    const viewport = viewer.getPageView(pageIndex).viewport;
    const [x, y] = clientToPdf(host, viewport, e.clientX, e.clientY);
    const hit = hitTest(
      tab.annotations.filter((a) => a.pageIndex === pageIndex),
      x,
      y,
      4 / viewport.scale,
    );
    useStore.getState().selectAnnotation(hit?.id);
  };

  const onWheel = (e: React.WheelEvent) => {
    // Ctrl/Cmd + tekerlek ve trackpad pinch (ctrlKey ile gelir) yakınlaştırır.
    if (!e.ctrlKey && !e.metaKey) return;
    const viewer = runtimes.get(tab.id)?.viewer;
    if (!viewer) return;
    // Satır modunda (bazı fareler) deltaY satır sayısıdır; piksele çevir.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    // Bir tekerlek tıkı (~100–120 px) ≈ %10. Trackpad'in küçük adımları orantılı ve yumuşak kalır.
    const factor = Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp((-delta * Math.log(ZOOM_STEP)) / 100)));
    viewer.updateScale({
      scaleFactor: factor,
      origin: [e.clientX, e.clientY],
      drawingDelay: 300,
    });
  };

  useEffect(() => {
    const el = containerRef.current!;
    // React'in onWheel'i pasif; preventDefault için native dinleyici gerekir.
    const prevent = (e: WheelEvent) => (e.ctrlKey || e.metaKey) && e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    // macOS WebKit trackpad pinch'i ctrl+wheel değil, gesture olayı olarak gönderir.
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const viewer = runtimes.get(tab.id)?.viewer;
      if (!viewer || !ge.scale) return;
      viewer.updateScale({ scaleFactor: ge.scale / gestureScale, origin: [ge.clientX, ge.clientY], drawingDelay: 300 });
      gestureScale = ge.scale;
    };
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    const hide = () => setPendingSelection(null);
    el.addEventListener("scroll", hide, { passive: true });
    return () => {
      el.removeEventListener("wheel", prevent);
      el.removeEventListener("scroll", hide);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [tab.id]);

  const viewer = runtimes.get(tab.id)?.viewer;

  return (
    <div className="pdf-view" style={{ display: active ? undefined : "none" }}>
      <div
        ref={containerRef}
        className={`pdf-container tool-${tool} ${panning ? "panning" : ""}`}
        onPointerDownCapture={onPointerDownCapture}
        onAuxClick={(e) => e.button === 1 && e.preventDefault()}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onWheel={onWheel}
      >
        <div ref={viewerRef} className="pdfViewer" />
      </div>
      {viewer &&
        mountedPages.map((pageIndex) => {
          const host = hosts.current.get(pageIndex);
          const pageView = viewer.getPageView(pageIndex);
          if (!host || !pageView) return null;
          return createPortal(
            <PageOverlay
              tabId={tab.id}
              pageIndex={pageIndex}
              viewport={pageView.viewport}
              annotations={tab.annotations.filter((a) => a.pageIndex === pageIndex)}
              readOnly={readOnly}
            />,
            host,
            `page-${pageIndex}`,
          );
        })}
      {pendingSelection && (
        <div
          className="selection-toolbar"
          style={{ left: pendingSelection.x, top: pendingSelection.y + 6 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <PaletteSwatches onPick={(c) => createHighlight(c)} />
          <button className="text-btn" onClick={() => createHighlight(useStore.getState().highlightColor, true)}>
            Not ekle
          </button>
        </div>
      )}
    </div>
  );
}
