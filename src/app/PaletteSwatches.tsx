import { useState } from "react";
import { rgbToCss, rgbToHex, sameColor, type Rgb } from "../annotations/model";
import { ColorPicker } from "./ColorPicker";
import { useStore } from "./store";

interface Props {
  /** Seçili olarak işaretlenecek renk. */
  value?: Rgb;
  onPick(c: Rgb): void;
  /** Renk seçici paneli, çift tıkla renk değiştirme ve sağ tıkla silme. */
  editable?: boolean;
}

type PickerState = { mode: "custom" } | { mode: "edit"; index: number } | null;

/** Kullanıcının highlight paleti. */
export function PaletteSwatches({ value, onPick, editable = false }: Props) {
  const palette = useStore((s) => s.highlightPalette);
  const opacity = useStore((s) => s.highlightOpacity);
  const setOpacity = (v: number) => useStore.getState().setHighlightStyle({ opacity: v });
  const [picker, setPicker] = useState<PickerState>(null);
  const close = () => setPicker(null);
  const isCustom = !!value && !palette.some((c) => sameColor(c, value));

  return (
    <div className="group swatches palette-wrap">
      {palette.map((c, i) => (
        <button
          key={i}
          className={`swatch ${value && sameColor(c, value) ? "active" : ""}`}
          style={{ background: rgbToCss(c) }}
          title={editable ? "Seç · çift tık: rengi değiştir · sağ tık: sil" : "Vurgula"}
          aria-label={`Renk ${rgbToHex(c)}`}
          data-color-picker-toggle={editable ? "" : undefined}
          onClick={() => onPick(c)}
          onDoubleClick={editable ? () => setPicker({ mode: "edit", index: i }) : undefined}
          onContextMenu={
            editable
              ? (e) => {
                  e.preventDefault();
                  close();
                  useStore.getState().removePaletteColor(i);
                }
              : undefined
          }
        />
      ))}
      {editable && isCustom && value && (
        // Paletde olmayan, panelden seçilmiş geçerli renk.
        <button
          className="swatch active"
          style={{ background: rgbToCss(value) }}
          title="Seçili özel renk"
          aria-label={`Özel renk ${rgbToHex(value)}`}
          data-color-picker-toggle=""
          onClick={() => setPicker({ mode: "custom" })}
        />
      )}
      {editable && (
        <button
          className={`swatch-add ${picker?.mode === "custom" ? "active" : ""}`}
          title="Renk seç / ekle"
          aria-label="Renk seç veya ekle"
          aria-expanded={picker?.mode === "custom"}
          data-color-picker-toggle=""
          onClick={() => setPicker(picker?.mode === "custom" ? null : { mode: "custom" })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {picker?.mode === "custom" && (
        <ColorPicker
          value={value ?? palette[0]}
          onChange={(c) => onPick(c)}
          onAddToPalette={(c) => {
            useStore.getState().addPaletteColor(c);
            close();
          }}
          opacity={opacity}
          onOpacityChange={setOpacity}
          onClose={close}
        />
      )}
      {picker?.mode === "edit" && palette[picker.index] && (
        <ColorPicker
          value={palette[picker.index]}
          onChange={(c) => useStore.getState().setPaletteColor(picker.index, c)}
          opacity={opacity}
          onOpacityChange={setOpacity}
          onClose={close}
        />
      )}
    </div>
  );
}
