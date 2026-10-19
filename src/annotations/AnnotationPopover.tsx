import { useEffect, useRef } from "react";
import type { PageViewport } from "pdfjs-dist";
import { useStore } from "../app/store";
import type { Annotation } from "./model";
import { annotationBounds, INK_COLORS, rgbToCss, sameColor, TEXT_FONT_SIZES } from "./model";
import { PaletteSwatches } from "../app/PaletteSwatches";

interface Props {
  tabId: string;
  ann: Annotation;
  viewport: PageViewport;
}

const KIND_LABEL: Record<Annotation["kind"], string> = {
  highlight: "Vurgu",
  ink: "Çizim",
  note: "Not",
  text: "Metin notu",
};

/** Seçili annotation için renk, not metni ve silme. Sayfa div'i içinde konumlanır. */
export function AnnotationPopover({ tabId, ann, viewport }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const update = useStore((s) => s.updateAnnotation);
  const remove = useStore((s) => s.removeAnnotation);
  const select = useStore((s) => s.selectAnnotation);

  useEffect(() => {
    // Yeni oluşturulan boş notta doğrudan yazmaya başlanabilsin.
    if (ann.kind === "note" && !ann.contents) textRef.current?.focus();
    // Sadece açılışta; popover annotation değişince key ile yeniden oluşur.
  }, []);

  const [minX, minY, maxX, maxY] = annotationBounds(ann);
  const corners = [
    viewport.convertToViewportPoint(minX, minY),
    viewport.convertToViewportPoint(maxX, maxY),
  ];
  const left = Math.max(0, Math.min(corners[0][0], corners[1][0]));
  const top = Math.max(corners[0][1], corners[1][1]) + 8;
  const isText = ann.kind === "text";

  return (
    <div
      className="ann-popover"
      style={{ left: Math.min(left, viewport.width - 260), top }}
      onPointerDown={(e) => e.stopPropagation()}
      // Metin kutusu düzenlenirken odak textarea'da kalsın.
      onMouseDown={(e) => isText && e.preventDefault()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") select(undefined);
      }}
    >
      <div className="ann-popover-header">
        <span className="ann-popover-kind">{KIND_LABEL[ann.kind]}</span>
        {ann.kind === "highlight" ? (
          <PaletteSwatches value={ann.color} onPick={(c) => update(tabId, ann.id, { color: c })} />
        ) : (
          <div className="swatches">
            {INK_COLORS.map((c) => (
              <button
                key={c.join()}
                className={`swatch ${sameColor(c, ann.color) ? "active" : ""}`}
                style={{ background: rgbToCss(c) }}
                title="Renk"
                onClick={() => {
                  update(tabId, ann.id, { color: c });
                  if (isText) useStore.getState().setTextStyle({ color: c });
                }}
              />
            ))}
          </div>
        )}
      </div>
      {ann.kind === "highlight" && (
        <label className="cp-opacity">
          <span>Opaklık</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(ann.opacity * 100)}
            onChange={(e) => update(tabId, ann.id, { opacity: Number(e.target.value) / 100 })}
          />
          <span className="cp-opacity-value">%{Math.round(ann.opacity * 100)}</span>
        </label>
      )}
      {ann.kind === "text" && (
        <div className="font-sizes">
          {TEXT_FONT_SIZES.map((size) => (
            <button
              key={size}
              className={ann.fontSize === size ? "active" : ""}
              onClick={() => {
                update(tabId, ann.id, { fontSize: size });
                useStore.getState().setTextStyle({ size });
              }}
            >
              {size}
            </button>
          ))}
        </div>
      )}
      {ann.kind === "highlight" && ann.text && <blockquote className="ann-quote">{ann.text}</blockquote>}
      {!isText && (
        <textarea
          ref={textRef}
          placeholder="Not ekle…"
          value={ann.contents}
          rows={3}
          onChange={(e) => update(tabId, ann.id, { contents: e.target.value })}
        />
      )}
      <div className="ann-popover-footer">
        <button className="danger" onClick={() => remove(tabId, ann.id)}>
          Sil
        </button>
        <button onClick={() => select(undefined)}>{isText ? "Bitti" : "Kapat"}</button>
      </div>
    </div>
  );
}
