/** Metin notlarının hem ekranda hem PDF'te kullandığı font (styles.css'teki @font-face). */
export const TEXT_FONT_FAMILY = '"PDFViewer Sans"';

let ctx: CanvasRenderingContext2D | null = null;

/** Tarayıcıda metin genişliği; fontSize px = PDF birimi olduğundan sonuç PDF biriminde. */
export function measureText(text: string, fontSize: number): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * fontSize * 0.55;
  ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
  return ctx.measureText(text).width;
}

/** Ölçümler fallback fontla yapılmasın diye uygulama açılırken fontu yükler. */
export function preloadTextFont(): Promise<unknown> {
  return document.fonts.load(`16px ${TEXT_FONT_FAMILY}`, "AğŞ");
}
