import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { hexToRgb, rgbToCss, rgbToHex, sameColor, type Rgb } from "../annotations/model";

/** Hazır vurgu renkleri: fosforlu kalem tonları ve pasteller. */
const PRESETS: string[] = [
  "#fff176", "#ffeb3b", "#ffd54f", "#ffb74d", "#ff8a65", "#ff8a80",
  "#f48fb1", "#ce93d8", "#b39ddb", "#9fa8da", "#90caf9", "#81d4fa",
  "#80deea", "#80cbc4", "#a5d6a7", "#c5e1a5", "#e6ee9c", "#bcaaa4",
  "#e0e0e0", "#b0bec5", "#ffcdd2", "#f8bbd0", "#d1c4e9", "#b2ebf2",
];

type Hsv = [number, number, number];

function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb([h, s, v]: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 1000) / 1000) as Rgb;
}

interface Props {
  value: Rgb;
  /** Her değişiklikte (sürüklerken de) çağrılır. */
  onChange(c: Rgb): void;
  /** Verilirse "Palete ekle" düğmesi gösterilir. */
  onAddToPalette?(c: Rgb): void;
  /** Verilirse opaklık çubuğu gösterilir (0.1–1). */
  opacity?: number;
  onOpacityChange?(v: number): void;
  onClose(): void;
}

/** Uygulama içi renk seçici: hazır renkler, doygunluk/parlaklık alanı, ton çubuğu ve hex. */
export function ColorPicker({ value, onChange, onAddToPalette, opacity, onOpacityChange, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Ton gri renklerde kaybolmasın diye HSV ayrıca tutulur.
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(value));
  const [hex, setHex] = useState(rgbToHex(value));
  const current = hsvToRgb(hsv);

  useEffect(() => {
    if (!sameColor(value, hsvToRgb(hsv))) {
      setHsv(rgbToHsv(value));
      setHex(rgbToHex(value));
    }
    // Sadece dışarıdan gelen değişiklikleri yansıt.
  }, [value]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-color-picker-toggle]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const rgb = hsvToRgb(next);
    setHex(rgbToHex(rgb));
    onChange(rgb);
  };

  const pick = (rgb: Rgb) => {
    setHsv(rgbToHsv(rgb));
    setHex(rgbToHex(rgb));
    onChange(rgb);
  };

  /** Bir alanda sürüklemeyi 0..1 koordinatlarına çevirir. */
  const dragArea = (e: ReactPointerEvent<HTMLDivElement>, fn: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const update = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const [h, s, v] = hsv;
  return (
    <div className="color-picker" ref={rootRef} role="dialog" aria-label="Renk seç">
      <div className="cp-presets">
        {PRESETS.map((p) => {
          const rgb = hexToRgb(p)!;
          return (
            <button
              key={p}
              className={`cp-preset ${sameColor(rgb, current) ? "active" : ""}`}
              style={{ background: p }}
              title={p}
              onClick={() => pick(rgb)}
            />
          );
        })}
      </div>

      <div
        className="cp-sv"
        style={{ background: `hsl(${h} 100% 50%)` }}
        onPointerDown={(e) => dragArea(e, (x, y) => apply([h, x, 1 - y]))}
      >
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div className="cp-thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: rgbToCss(current) }} />
      </div>

      <div className="cp-hue" onPointerDown={(e) => dragArea(e, (x) => apply([x * 359.9, s, v]))}>
        <div className="cp-thumb" style={{ left: `${(h / 360) * 100}%`, top: "50%", background: `hsl(${h} 100% 50%)` }} />
      </div>

      {opacity !== undefined && onOpacityChange && (
        <label className="cp-opacity">
          <span>Opaklık</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            style={{ ["--cp-color" as string]: rgbToCss(current) }}
            onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          />
          <span className="cp-opacity-value">%{Math.round(opacity * 100)}</span>
        </label>
      )}

      <div className="cp-footer">
        <span className="cp-current">
          <span style={{ background: rgbToCss(current), opacity: opacity ?? 1 }} />
        </span>
        <input
          className="cp-hex"
          value={hex}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value);
            const rgb = hexToRgb(e.target.value);
            if (rgb) pick(rgb);
          }}
          aria-label="Hex renk kodu"
        />
        {onAddToPalette && (
          <button className="primary-soft" onClick={() => onAddToPalette(current)}>
            Palete ekle
          </button>
        )}
      </div>
    </div>
  );
}
