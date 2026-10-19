import { useEffect, useState, type ReactNode } from "react";
import { INK_COLORS, rgbToCss, TEXT_FONT_SIZES, type Rgb } from "../annotations/model";
import { PaletteSwatches } from "./PaletteSwatches";
import { goToPage, openWithDialog, saveTab, zoom } from "./actions";
import { THICKNESS_RANGE, useStore, type PageLayout, type Tab, type Tool } from "./store";

/** Silgi ikonu (Lucide "eraser", ISC lisansı). */
const EraserIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

/** El ikonu (Lucide "hand", ISC lisansı). */
const HandIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

const TOOLS: { id: Tool; label: string; icon: ReactNode; key: string }[] = [
  { id: "select", label: "Seç", icon: "↖", key: "V" },
  { id: "pan", label: "El", icon: HandIcon, key: "G · Boşluk basılı" },
  { id: "highlight", label: "Vurgula", icon: "▍", key: "H" },
  { id: "pen", label: "Kalem", icon: "✎", key: "P" },
  { id: "note", label: "Not", icon: "T", key: "N" },
  { id: "eraser", label: "Silgi", icon: EraserIcon, key: "E" },
];

export function Toolbar({ tab }: { tab?: Tab }) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const highlightColor = useStore((s) => s.highlightColor);
  const inkColor = useStore((s) => s.inkColor);
  const inkWidth = useStore((s) => s.inkWidth);
  const textColor = useStore((s) => s.textColor);
  const textSize = useStore((s) => s.textSize);
  const sidebar = useStore((s) => s.sidebar);
  const searchOpen = useStore((s) => s.searchOpen);
  const disabled = !tab || !!tab.readOnlyReason;

  return (
    <header className="toolbar">
      <div className="group">
        <button onClick={() => useStore.getState().setSidebar(sidebar ? undefined : "thumbnails")} title="Kenar çubuğu" disabled={!tab}>
          ☰
        </button>
        <button onClick={openWithDialog} title="Aç (⌘/Ctrl+O)">
          Aç
        </button>
      </div>

      <div className="group tools" role="radiogroup" aria-label="Araçlar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={tool === t.id}
            className={tool === t.id ? "active" : ""}
            onClick={() => setTool(t.id)}
            disabled={disabled && t.id !== "select" && t.id !== "pan"}
            title={`${t.label} (${t.key})`}
          >
            <span className="icon">{t.icon}</span>
            <span className="label">{t.label}</span>
          </button>
        ))}
      </div>

      {(tool === "highlight" || tool === "select") && (
        <div className="group">
          <PaletteSwatches value={highlightColor} onPick={useStore.getState().setHighlightColor} editable />
          <ThicknessPicker />
        </div>
      )}
      {tool === "pen" && (
        <div className="group">
          <Swatches colors={INK_COLORS} value={inkColor} onChange={useStore.getState().setInkColor} />
          <label className="width-picker" title="Kalem kalınlığı">
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.5}
              value={inkWidth}
              onChange={(e) => useStore.getState().setInkWidth(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {tool === "note" && (
        <div className="group">
          <Swatches colors={INK_COLORS} value={textColor} onChange={(color) => useStore.getState().setTextStyle({ color })} />
          <select
            className="size-select"
            value={textSize}
            onChange={(e) => useStore.getState().setTextStyle({ size: Number(e.target.value) })}
            title="Yazı boyutu"
          >
            {TEXT_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="spacer" />

      {tab && (
        <>
          <PageInput tab={tab} />
          <LayoutPicker />
          <div className="group">
            <button onClick={() => zoom(tab.id, "out")} title="Uzaklaştır (⌘/Ctrl −)">−</button>
            <button className="zoom-value" onClick={() => zoom(tab.id, "page-width")} title="Sayfa genişliğine sığdır">
              {Math.round(tab.scale * 100)}%
            </button>
            <button onClick={() => zoom(tab.id, "in")} title="Yakınlaştır (⌘/Ctrl +)">+</button>
          </div>
          <button
            className={searchOpen ? "active" : ""}
            onClick={() => useStore.getState().setSearchOpen(!searchOpen)}
            title="Ara (⌘/Ctrl+F)"
          >
            Ara
          </button>
          <SaveStatus tab={tab} />
        </>
      )}
    </header>
  );
}

const page = (x: number, y = 4) => <rect x={x} y={y} width="7" height="10" rx="1" />;
const LAYOUTS: { id: PageLayout; label: string; icon: ReactNode }[] = [
  { id: 0, label: "Tek sayfa", icon: page(6.5) },
  { id: 1, label: "İki sayfa yan yana", icon: <>{page(2)}{page(11)}</> },
  {
    id: 2,
    label: "Kitap görünümü (kapak tek, sonra yan yana)",
    icon: (
      <>
        {page(2)}
        {page(11)}
        <path d="M9 2.5v13" strokeDasharray="1.5 1.5" />
      </>
    ),
  },
];

function LayoutPicker() {
  const layout = useStore((s) => s.pageLayout);
  return (
    <div className="group segmented" role="radiogroup" aria-label="Sayfa düzeni">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={layout === l.id}
          className={layout === l.id ? "active" : ""}
          title={l.label}
          aria-label={l.label}
          onClick={() => useStore.getState().setPageLayout(l.id)}
        >
          <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            {l.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}

function ThicknessPicker() {
  const thickness = useStore((s) => s.highlightThickness);
  const color = useStore((s) => s.highlightColor);
  const opacity = useStore((s) => s.highlightOpacity);
  return (
    <label className="thickness-picker" title={`Highlight kalınlığı: %${Math.round(thickness * 100)} (yazı yüksekliğine göre)`}>
      <span className="thickness-preview" aria-hidden="true">
        <span style={{ height: `${thickness * 10}px`, background: rgbToCss(color), opacity }} />
      </span>
      <input
        type="range"
        min={THICKNESS_RANGE.min}
        max={THICKNESS_RANGE.max}
        step={0.1}
        value={thickness}
        onChange={(e) => useStore.getState().setHighlightStyle({ thickness: Number(e.target.value) })}
        aria-label="Highlight kalınlığı"
      />
    </label>
  );
}

function Swatches({ colors, value, onChange }: { colors: Rgb[]; value: Rgb; onChange: (c: Rgb) => void }) {
  return (
    <div className="group swatches">
      {colors.map((c) => (
        <button
          key={c.join()}
          className={`swatch ${c.join() === value.join() ? "active" : ""}`}
          style={{ background: rgbToCss(c) }}
          onClick={() => onChange(c)}
          aria-label="Renk"
        />
      ))}
    </div>
  );
}

function PageInput({ tab }: { tab: Tab }) {
  const [value, setValue] = useState(String(tab.currentPage));
  useEffect(() => setValue(String(tab.currentPage)), [tab.currentPage]);
  return (
    <div className="group page-input" title="Sayfa numarası yazıp Enter'a bas">
      <span className="page-label">Sayfa</span>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") goToPage(tab.id, Number(value));
          if (e.key === "Escape") setValue(String(tab.currentPage));
        }}
        onBlur={() => setValue(String(tab.currentPage))}
        aria-label="Sayfa"
      />
      <span className="page-total">/ {tab.numPages}</span>
    </div>
  );
}

function SaveStatus({ tab }: { tab: Tab }) {
  if (tab.readOnlyReason) {
    return (
      <span className="save-status readonly" title={tab.readOnlyReason}>
        Salt okunur
      </span>
    );
  }
  const label = {
    saved: "Kaydedildi",
    dirty: "Kaydedilmedi",
    saving: "Kaydediliyor…",
    error: "Kayıt hatası",
  }[tab.saveState];
  return (
    <div className="group">
      <span className={`save-status ${tab.saveState}`} title={tab.saveError}>
        {label}
      </span>
      <button
        className={tab.saveState === "dirty" || tab.saveState === "error" ? "primary-soft" : ""}
        onClick={() => saveTab(tab.id)}
        disabled={tab.version === tab.savedVersion || tab.saveState === "saving"}
        title="Kaydet (⌘/Ctrl+S)"
      >
        Kaydet
      </button>
    </div>
  );
}
