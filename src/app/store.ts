import { create } from "zustand";
import type { Annotation, RefKey, Rgb } from "../annotations/model";
import { HIGHLIGHT_COLORS, INK_COLORS, nowIso, sameColor, TEXT_DEFAULT_SIZE } from "../annotations/model";

const PALETTE_KEY = "pdfviewer.highlightPalette";
const MAX_PALETTE = 12;

function loadPalette(): Rgb[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? "null");
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((c) => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number" && v >= 0 && v <= 1))
    ) {
      return raw as Rgb[];
    }
  } catch {
    // Bozuk ya da erişilemeyen depolama: varsayılan palet.
  }
  return HIGHLIGHT_COLORS;
}

const PREFS_KEY = "pdfviewer.highlightPrefs";
export const THICKNESS_RANGE = { min: 0.4, max: 1.6, default: 1 };
export const OPACITY_RANGE = { min: 0.1, max: 1, default: 1 };

function loadPrefs(): { opacity: number; thickness: number } {
  const clamp = (v: unknown, r: { min: number; max: number; default: number }) =>
    typeof v === "number" && v >= r.min && v <= r.max ? v : r.default;
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { opacity: clamp(raw?.opacity, OPACITY_RANGE), thickness: clamp(raw?.thickness, THICKNESS_RANGE) };
  } catch {
    return { opacity: OPACITY_RANGE.default, thickness: THICKNESS_RANGE.default };
  }
}

function savePrefs(prefs: { opacity: number; thickness: number }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Depolama kapalıysa sadece bu oturumda geçerli.
  }
}

const LAYOUT_KEY = "pdfviewer.pageLayout";

function loadPageLayout(): PageLayout {
  try {
    const v = Number(localStorage.getItem(LAYOUT_KEY));
    if (v === 1 || v === 2) return v;
  } catch {
    // Varsayılan: tek sayfa.
  }
  return 0;
}

const SIDEBAR_KEY = "pdfviewer.sidebarWidth";
export const SIDEBAR_WIDTH = { min: 160, max: 600, default: 240 };

function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_KEY));
    if (v >= SIDEBAR_WIDTH.min && v <= SIDEBAR_WIDTH.max) return v;
  } catch {
    // Varsayılan genişlik.
  }
  return SIDEBAR_WIDTH.default;
}

function savePalette(palette: Rgb[]) {
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
  } catch {
    // Depolama kapalıysa palet sadece bu oturumda geçerli olur.
  }
}

export type Tool = "select" | "pan" | "highlight" | "pen" | "note" | "eraser";
export type SidebarPanel = "outline" | "thumbnails" | "notes";
export type SaveState = "saved" | "dirty" | "saving" | "error";
/** pdf.js SpreadMode ile aynı değerler: tek sayfa, iki sayfa (1–2, 3–4), kitap (kapak tek, 2–3…). */
export type PageLayout = 0 | 1 | 2;

export interface Tab {
  id: string;
  path: string;
  name: string;
  numPages: number;
  currentPage: number;
  /** pdf.js ölçeği (1 = %100). */
  scale: number;
  annotations: Annotation[];
  /** Her annotation değişikliğinde artar; kayıt bittiğinde arada değişiklik olup olmadığını anlamak için. */
  version: number;
  savedVersion: number;
  saveState: SaveState;
  saveError?: string;
  /** Doluysa annotation düzenleme kapalıdır (ör. şifreli PDF). */
  readOnlyReason?: string;
  signed: boolean;
  /** Geri al / yinele için annotation listesinin önceki ve sonraki hâlleri. */
  past: Annotation[][];
  future: Annotation[][];
}

interface State {
  tabs: Tab[];
  activeTabId?: string;
  tool: Tool;
  highlightColor: Rgb;
  /** Kullanıcının düzenleyebildiği highlight paleti; kalıcıdır. */
  highlightPalette: Rgb[];
  /** Yeni highlight'ların opaklığı (0.1–1). */
  highlightOpacity: number;
  /** Highlight yüksekliği, font boyutunun katı. */
  highlightThickness: number;
  inkColor: Rgb;
  inkWidth: number;
  textColor: Rgb;
  textSize: number;
  selectedAnnotationId?: string;
  sidebar?: SidebarPanel;
  /** Kenar çubuğu genişliği (px); kalıcıdır. */
  sidebarWidth: number;
  pageLayout: PageLayout;
  searchOpen: boolean;
  toast?: { message: string; kind: "info" | "error" };

  addTab(tab: Omit<Tab, "past" | "future">): void;
  closeTab(id: string): void;
  activateTab(id: string): void;
  updateTab(id: string, patch: Partial<Tab>): void;

  /** `record: false` ise geçmişe yazılmaz (ör. henüz boş olan yeni metin kutusu). */
  addAnnotation(tabId: string, ann: Annotation, opts?: { record?: boolean }): void;
  updateAnnotation(tabId: string, annId: string, patch: Partial<Annotation>): void;
  removeAnnotation(tabId: string, annId: string): void;
  /** Kayıttan sonra: yeni ref'leri işle, arada değişiklik yoksa temiz olarak işaretle. */
  markSaved(tabId: string, version: number, refs: Record<string, RefKey>): void;
  undo(tabId: string): void;
  redo(tabId: string): void;

  setTool(tool: Tool): void;
  setHighlightColor(c: Rgb): void;
  setPaletteColor(index: number, c: Rgb): void;
  addPaletteColor(c: Rgb): void;
  removePaletteColor(index: number): void;
  setHighlightStyle(style: { opacity?: number; thickness?: number }): void;
  setInkColor(c: Rgb): void;
  setInkWidth(w: number): void;
  setTextStyle(style: { color?: Rgb; size?: number }): void;
  selectAnnotation(id?: string): void;
  setSidebar(panel?: SidebarPanel): void;
  setSidebarWidth(width: number): void;
  setPageLayout(layout: PageLayout): void;
  setSearchOpen(open: boolean): void;
  showToast(message: string, kind?: "info" | "error"): void;
  clearToast(): void;
}

function mutateTab(tabs: Tab[], id: string, fn: (t: Tab) => Tab): Tab[] {
  return tabs.map((t) => (t.id === id ? fn(t) : t));
}

const HISTORY_LIMIT = 200;
/** Aynı annotation'a 1 sn içinde art arda yapılan düzenlemeler (yazı yazmak gibi) tek adım sayılır. */
const COALESCE_MS = 1000;
let lastEdit: { tabId: string; annId: string; at: number } | undefined;

/** Boş metin kutuları geçmişe girmez; geri alınca boş kutu belirmesin. */
function snapshot(annotations: Annotation[]): Annotation[] {
  return annotations.filter((a) => a.kind !== "text" || a.contents.trim());
}

function isEmptyText(a: Annotation | undefined): boolean {
  return a?.kind === "text" && !a.contents.trim();
}

function touched(t: Tab, annotations: Annotation[], record = true): Tab {
  const past = record ? [...t.past, snapshot(t.annotations)].slice(-HISTORY_LIMIT) : t.past;
  return {
    ...t,
    annotations,
    past,
    future: record ? [] : t.future,
    version: t.version + 1,
    saveState: t.saveState === "saving" ? "saving" : "dirty",
  };
}

/** Seçim değişirken, bırakılan metin kutusu boşsa onu kaldırır. */
function withoutAbandonedText(s: State, nextSelected?: string): Partial<State> {
  const prev = s.selectedAnnotationId;
  if (!prev || prev === nextSelected) return {};
  const tab = s.tabs.find((t) => t.annotations.some((a) => a.id === prev));
  if (!tab || !isEmptyText(tab.annotations.find((a) => a.id === prev))) return {};
  return {
    tabs: mutateTab(s.tabs, tab.id, (t) =>
      touched(t, t.annotations.filter((a) => a.id !== prev), false),
    ),
  };
}

export const useStore = create<State>((set) => ({
  tabs: [],
  tool: "select",
  highlightColor: loadPalette()[0],
  highlightPalette: loadPalette(),
  highlightOpacity: loadPrefs().opacity,
  highlightThickness: loadPrefs().thickness,
  inkColor: INK_COLORS[1],
  inkWidth: 2,
  textColor: [0.1, 0.1, 0.1],
  textSize: TEXT_DEFAULT_SIZE,
  sidebar: "thumbnails",
  sidebarWidth: loadSidebarWidth(),
  pageLayout: loadPageLayout(),
  searchOpen: false,

  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, { ...tab, past: [], future: [] }], activeTabId: tab.id })),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)]?.id : s.activeTabId;
      return { tabs, activeTabId, selectedAnnotationId: undefined };
    }),
  activateTab: (id) => set((s) => ({ ...withoutAbandonedText(s), activeTabId: id, selectedAnnotationId: undefined })),
  updateTab: (id, patch) => set((s) => ({ tabs: mutateTab(s.tabs, id, (t) => ({ ...t, ...patch })) })),

  addAnnotation: (tabId, ann, opts) => {
    lastEdit = undefined;
    set((s) => ({
      tabs: mutateTab(s.tabs, tabId, (t) => touched(t, [...t.annotations, ann], opts?.record ?? true)),
    }));
  },
  updateAnnotation: (tabId, annId, patch) => {
    const now = Date.now();
    const coalesce = lastEdit?.tabId === tabId && lastEdit.annId === annId && now - lastEdit.at < COALESCE_MS;
    lastEdit = { tabId, annId, at: now };
    set((s) => ({
      tabs: mutateTab(s.tabs, tabId, (t) =>
        touched(
          t,
          t.annotations.map((a) => (a.id === annId ? ({ ...a, ...patch, modified: nowIso() } as Annotation) : a)),
          !coalesce,
        ),
      ),
    }));
  },
  removeAnnotation: (tabId, annId) => {
    lastEdit = undefined;
    set((s) => ({
      tabs: mutateTab(s.tabs, tabId, (t) => {
        const ann = t.annotations.find((a) => a.id === annId);
        return touched(t, t.annotations.filter((a) => a.id !== annId), !isEmptyText(ann));
      }),
      selectedAnnotationId: s.selectedAnnotationId === annId ? undefined : s.selectedAnnotationId,
    }));
  },
  undo: (tabId) => {
    lastEdit = undefined;
    set((s) => ({
      selectedAnnotationId: undefined,
      tabs: mutateTab(s.tabs, tabId, (t) => {
        if (t.past.length === 0) return t;
        const annotations = t.past[t.past.length - 1];
        return {
          ...touched(t, annotations, false),
          past: t.past.slice(0, -1),
          future: [...t.future, snapshot(t.annotations)],
        };
      }),
    }));
  },
  redo: (tabId) => {
    lastEdit = undefined;
    set((s) => ({
      selectedAnnotationId: undefined,
      tabs: mutateTab(s.tabs, tabId, (t) => {
        if (t.future.length === 0) return t;
        const annotations = t.future[t.future.length - 1];
        return {
          ...touched(t, annotations, false),
          past: [...t.past, snapshot(t.annotations)],
          future: t.future.slice(0, -1),
        };
      }),
    }));
  },
  markSaved: (tabId, version, refs) =>
    set((s) => ({
      tabs: mutateTab(s.tabs, tabId, (t) => ({
        ...t,
        annotations: t.annotations.map((a) => (refs[a.id] ? { ...a, ref: refs[a.id] } : a)),
        savedVersion: version,
        saveState: t.version === version ? "saved" : "dirty",
        saveError: undefined,
      })),
    })),

  setTool: (tool) => set((s) => ({ ...withoutAbandonedText(s), tool, selectedAnnotationId: undefined })),
  setHighlightColor: (highlightColor) => set({ highlightColor }),
  setPaletteColor: (index, c) =>
    set((s) => {
      const highlightPalette = s.highlightPalette.map((p, i) => (i === index ? c : p));
      savePalette(highlightPalette);
      // Düzenlenen renk seçiliyse seçimi de güncelle.
      const wasSelected = sameColor(s.highlightPalette[index], s.highlightColor);
      return { highlightPalette, highlightColor: wasSelected ? c : s.highlightColor };
    }),
  addPaletteColor: (c) =>
    set((s) => {
      const highlightPalette = [...s.highlightPalette, c].slice(0, MAX_PALETTE);
      savePalette(highlightPalette);
      return { highlightPalette, highlightColor: c };
    }),
  setHighlightStyle: ({ opacity, thickness }) =>
    set((s) => {
      const next = {
        highlightOpacity: opacity ?? s.highlightOpacity,
        highlightThickness: thickness ?? s.highlightThickness,
      };
      savePrefs({ opacity: next.highlightOpacity, thickness: next.highlightThickness });
      return next;
    }),
  removePaletteColor: (index) =>
    set((s) => {
      if (s.highlightPalette.length <= 1) return {};
      const removed = s.highlightPalette[index];
      const highlightPalette = s.highlightPalette.filter((_, i) => i !== index);
      savePalette(highlightPalette);
      return {
        highlightPalette,
        highlightColor: sameColor(removed, s.highlightColor) ? highlightPalette[0] : s.highlightColor,
      };
    }),
  setInkColor: (inkColor) => set({ inkColor }),
  setInkWidth: (inkWidth) => set({ inkWidth }),
  setTextStyle: ({ color, size }) =>
    set((s) => ({ textColor: color ?? s.textColor, textSize: size ?? s.textSize })),
  selectAnnotation: (selectedAnnotationId) => {
    lastEdit = undefined;
    set((s) => ({ ...withoutAbandonedText(s, selectedAnnotationId), selectedAnnotationId }));
  },
  setSidebar: (sidebar) => set({ sidebar }),
  setPageLayout: (pageLayout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, String(pageLayout));
    } catch {
      // Depolama kapalıysa sadece bu oturumda geçerli.
    }
    set({ pageLayout });
  },
  setSidebarWidth: (width) => {
    const sidebarWidth = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
    } catch {
      // Depolama kapalıysa sadece bu oturumda geçerli.
    }
    set({ sidebarWidth });
  },
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  showToast: (message, kind = "info") => set({ toast: { message, kind } }),
  clearToast: () => set({ toast: undefined }),
}));

export function activeTab(s: Pick<State, "tabs" | "activeTabId">): Tab | undefined {
  return s.tabs.find((t) => t.id === s.activeTabId);
}
