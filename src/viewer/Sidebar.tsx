import { useEffect, useRef, useState } from "react";
import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { goToPage, revealAnnotation } from "../app/actions";
import { runtimes } from "../app/registry";
import { SIDEBAR_WIDTH, useStore, type SidebarPanel, type Tab } from "../app/store";
import { annotationBounds, rgbToCss, type Annotation } from "../annotations/model";

const PANELS: { id: SidebarPanel; label: string }[] = [
  { id: "thumbnails", label: "Sayfalar" },
  { id: "outline", label: "İçindekiler" },
  { id: "notes", label: "Notlar" },
];

export function Sidebar({ tab }: { tab: Tab }) {
  const panel = useStore((s) => s.sidebar);
  const setSidebar = useStore((s) => s.setSidebar);
  const width = useStore((s) => s.sidebarWidth);
  if (!panel) return null;
  return (
    <aside className="sidebar" style={{ width }}>
      <SidebarResizer width={width} />
      <div className="sidebar-tabs" role="tablist">
        {PANELS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={panel === p.id}
            className={panel === p.id ? "active" : ""}
            onClick={() => setSidebar(p.id)}
          >
            {p.label}
            {p.id === "notes" && tab.annotations.length > 0 && <span className="badge">{tab.annotations.length}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {panel === "thumbnails" && <Thumbnails key={tab.id} tab={tab} />}
        {panel === "outline" && <Outline key={tab.id} tab={tab} />}
        {panel === "notes" && <NotesPanel tab={tab} />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- İçindekiler

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineItem[];
}

function Outline({ tab }: { tab: Tab }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null);
  useEffect(() => {
    runtimes
      .get(tab.id)
      ?.pdfDoc.getOutline()
      .then((o) => setItems((o as OutlineItem[] | null) ?? []));
  }, [tab.id]);

  if (items === null) return <p className="muted pad">Yükleniyor…</p>;
  if (items.length === 0) return <p className="muted pad">Bu PDF'te içindekiler bilgisi yok.</p>;
  return (
    <ul className="outline">
      {items.map((item, i) => (
        <OutlineNode key={i} tabId={tab.id} item={item} />
      ))}
    </ul>
  );
}

function OutlineNode({ tabId, item }: { tabId: string; item: OutlineItem }) {
  const [open, setOpen] = useState(false);
  const go = () => {
    const link = runtimes.get(tabId)?.linkService;
    if (item.dest) void link?.goToDestination(item.dest);
    else if (item.url) window.open(item.url, "_blank");
  };
  return (
    <li>
      <div className="outline-row">
        {item.items.length > 0 ? (
          <button className="disclosure" onClick={() => setOpen(!open)} aria-label={open ? "Daralt" : "Genişlet"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="disclosure" />
        )}
        <button className="outline-title" onClick={go} title={item.title}>
          {item.title}
        </button>
      </div>
      {open && item.items.length > 0 && (
        <ul>
          {item.items.map((child, i) => (
            <OutlineNode key={i} tabId={tabId} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Kenar çubuğunun sağ kenarı: sürükleyerek genişlik, çift tıkla varsayılan genişlik. */
function SidebarResizer({ width }: { width: number }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`sidebar-resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      title="Sürükleyerek genişliği ayarla · çift tık: varsayılan"
      onDoubleClick={() => useStore.getState().setSidebarWidth(SIDEBAR_WIDTH.default)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        const startWidth = width;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const move = (ev: PointerEvent) => useStore.getState().setSidebarWidth(startWidth + ev.clientX - startX);
        const end = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", end);
          el.removeEventListener("pointercancel", end);
          setDragging(false);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
      }}
    />
  );
}

// ---------------------------------------------------------------- Küçük resimler

/** Değer `delay` ms boyunca değişmeden kalınca güncellenir. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return settled;
}

function Thumbnails({ tab }: { tab: Tab }) {
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  // Küçük resimler kenar çubuğuyla büyür; yeniden çizim sürükleme bitince yapılır.
  const displayWidth = Math.max(80, sidebarWidth - 60);
  const renderWidth = useSettled(displayWidth, 250);
  const [aspect, setAspect] = useState(1.294);
  const listRef = useRef<HTMLDivElement>(null);
  const pdfDoc = runtimes.get(tab.id)?.pdfDoc;

  useEffect(() => {
    pdfDoc?.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      setAspect(vp.height / vp.width);
    });
  }, [pdfDoc]);

  // Geçerli sayfanın küçük resmini görünür tut.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-thumb="${tab.currentPage}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [tab.currentPage]);

  if (!pdfDoc) return null;
  return (
    <div className="thumbnails" ref={listRef}>
      {Array.from({ length: tab.numPages }, (_, i) => (
        <Thumbnail
          key={i}
          pdfDoc={pdfDoc}
          pageNumber={i + 1}
          aspect={aspect}
          displayWidth={displayWidth}
          renderWidth={renderWidth}
          active={tab.currentPage === i + 1}
          onClick={() => goToPage(tab.id, i + 1)}
        />
      ))}
    </div>
  );
}

function Thumbnail(props: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  aspect: number;
  displayWidth: number;
  renderWidth: number;
  active: boolean;
  onClick: () => void;
}) {
  const { pdfDoc, pageNumber, aspect, displayWidth, renderWidth, active, onClick } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let cancelled = false;
    let task: { cancel(): void } | undefined;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (renderWidth / base.width) * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const t = page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE });
        task = t;
        t.promise.then(() => !cancelled && setRendered(true)).catch(() => {});
      },
      { rootMargin: "300px" },
    );
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      task?.cancel();
    };
  }, [pdfDoc, pageNumber, renderWidth]);

  return (
    <button className={`thumb ${active ? "active" : ""}`} data-thumb={pageNumber} onClick={onClick}>
      <canvas
        ref={canvasRef}
        style={{ width: displayWidth, height: rendered ? undefined : displayWidth * aspect }}
      />
      <span>{pageNumber}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Notlar paneli

const KIND_ICON: Record<Annotation["kind"], string> = { highlight: "▍", ink: "✎", note: "🗒", text: "T" };

function NotesPanel({ tab }: { tab: Tab }) {
  const selectedId = useStore((s) => s.selectedAnnotationId);
  const [filter, setFilter] = useState("");

  const q = filter.trim().toLocaleLowerCase("tr");
  const sorted = [...tab.annotations]
    .filter((a) => !q || `${a.contents} ${a.kind === "highlight" ? a.text ?? "" : ""}`.toLocaleLowerCase("tr").includes(q))
    .sort((a, b) => a.pageIndex - b.pageIndex || annotationBounds(b)[3] - annotationBounds(a)[3]);

  if (tab.annotations.length === 0) {
    return (
      <p className="muted pad">
        Henüz not yok. Metin seçip vurgulayabilir, kalemle çizebilir veya not ekleyebilirsin.
      </p>
    );
  }

  let lastPage = -1;
  return (
    <div className="notes-panel">
      <input
        className="notes-filter"
        placeholder="Notlarda ara…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {sorted.length === 0 && <p className="muted pad">Eşleşen not yok.</p>}
      <ul>
        {sorted.map((a) => {
          const header = a.pageIndex !== lastPage ? <li className="notes-page">Sayfa {a.pageIndex + 1}</li> : null;
          lastPage = a.pageIndex;
          return (
            <NoteRowGroup key={a.id} header={header}>
              <li>
                <button
                  className={`note-row ${selectedId === a.id ? "active" : ""}`}
                  onClick={() => revealAnnotation(tab.id, a)}
                >
                  <span className="note-icon" style={{ color: rgbToCss(a.color) }}>
                    {KIND_ICON[a.kind]}
                  </span>
                  <span className="note-text">
                    {a.kind === "highlight" && a.text && <span className="note-quote">{a.text}</span>}
                    {a.contents ? (
                      <span className="note-contents">{a.contents}</span>
                    ) : (
                      !(a.kind === "highlight" && a.text) && (
                        <span className="muted">{a.kind === "ink" ? "Çizim" : "Boş not"}</span>
                      )
                    )}
                  </span>
                </button>
              </li>
            </NoteRowGroup>
          );
        })}
      </ul>
    </div>
  );
}

function NoteRowGroup({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {header}
      {children}
    </>
  );
}
