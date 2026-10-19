import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initialFiles } from "../io/fileService";
import { PdfView } from "../viewer/PdfView";
import { SearchBar } from "../viewer/SearchBar";
import { Sidebar } from "../viewer/Sidebar";
import { closeTab, openPaths, openWithDialog, saveTab, zoom } from "./actions";
import { activeTab, useStore, type Tool } from "./store";
import { Toolbar } from "./Toolbar";

const TOOL_KEYS: Record<string, Tool> = { v: "select", g: "pan", h: "highlight", p: "pen", n: "note", e: "eraser" };

export function App() {
  const tabs = useStore((s) => s.tabs);
  const tab = useStore(activeTab);
  const searchOpen = useStore((s) => s.searchOpen);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void initialFiles().then(openPaths);
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      void openPaths(e.payload.paths.filter((p) => p.toLowerCase().endsWith(".pdf")));
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // Pencere kapanırken kaydedilmemiş notlar için sor.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (e) => {
      const dirty = useStore.getState().tabs.filter((t) => t.version !== t.savedVersion);
      if (dirty.length === 0) return;
      e.preventDefault();
      for (const t of dirty) if (!(await closeTab(t.id))) return;
      await win.destroy();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  useEffect(() => {
    const title = tab ? `${tab.version !== tab.savedVersion ? "• " : ""}${tab.name} — PDFViewer` : "PDFViewer";
    void getCurrentWindow().setTitle(title);
  }, [tab?.name, tab?.version, tab?.savedVersion]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.getState().clearToast(), toast.kind === "error" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const current = activeTab(s);
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as Element).closest("input, textarea, [contenteditable]");

      if (mod) {
        const key = e.key.toLowerCase();
        if (key === "z" || (key === "y" && e.ctrlKey)) {
          // Arama/sayfa kutusunda yazarken metin düzenleyicinin kendi geri alması çalışsın.
          if (typing && !(e.target as Element).closest(".ann-text-editor, .ann-popover")) return;
          if (!current) return;
          e.preventDefault();
          if (key === "y" || e.shiftKey) s.redo(current.id);
          else s.undo(current.id);
          return;
        }
        if (key === "o") void openWithDialog();
        else if (key === "s" && current) void saveTab(current.id);
        else if (key === "f" && current) s.setSearchOpen(true);
        else if (key === "w" && current) void closeTab(current.id);
        else if ((key === "=" || key === "+") && current) zoom(current.id, "in");
        else if (key === "-" && current) zoom(current.id, "out");
        else if (key === "0" && current) zoom(current.id, "page-width");
        else if (e.key === "Tab" && s.tabs.length > 1) {
          const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
          const next = (i + (e.shiftKey ? -1 : 1) + s.tabs.length) % s.tabs.length;
          s.activateTab(s.tabs[next].id);
        } else return;
        e.preventDefault();
        return;
      }
      if (typing) return;

      if (e.key === "Escape") {
        if (s.selectedAnnotationId) s.selectAnnotation(undefined);
        else s.setTool("select");
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedAnnotationId && current) {
        s.removeAnnotation(current.id, s.selectedAnnotationId);
      } else if (
        TOOL_KEYS[e.key.toLowerCase()] &&
        !e.altKey &&
        current &&
        (!current.readOnlyReason || ["select", "pan"].includes(TOOL_KEYS[e.key.toLowerCase()]))
      ) {
        s.setTool(TOOL_KEYS[e.key.toLowerCase()]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar tab={tab} />
      {tabs.length > 0 && <TabBar />}
      <div className="main">
        {tab && <Sidebar tab={tab} />}
        <div className="views">
          {tab?.readOnlyReason && <div className="banner">{tab.readOnlyReason}</div>}
          {tabs.map((t) => (
            <PdfView key={t.id} tab={t} active={t.id === tab?.id} />
          ))}
          {tab && searchOpen && <SearchBar key={tab.id} tabId={tab.id} />}
          {tabs.length === 0 && <EmptyState />}
        </div>
      </div>
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeTabId);
  const activate = useStore((s) => s.activateTab);
  return (
    <nav className="tabbar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`tab ${t.id === activeId ? "active" : ""}`}
          onClick={() => activate(t.id)}
          onAuxClick={(e) => e.button === 1 && void closeTab(t.id)}
          title={t.path}
        >
          <span className="tab-name">
            {t.version !== t.savedVersion && <span className="dirty-dot">●</span>}
            {t.name}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              void closeTab(t.id);
            }}
            aria-label="Sekmeyi kapat"
          >
            ✕
          </button>
        </div>
      ))}
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h1>PDFViewer</h1>
      <p className="muted">Bir PDF aç ya da pencereye sürükleyip bırak.</p>
      <button className="primary" onClick={openWithDialog}>
        PDF aç
      </button>
      <p className="muted small">Notların ve vurguların PDF dosyasının içine kaydedilir; telefonda ve diğer okuyucularda da görünür.</p>
    </div>
  );
}
