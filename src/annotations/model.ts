/** RGB, her bileşen 0..1 aralığında (PDF'teki /C dizisiyle aynı). */
export type Rgb = [number, number, number];

/** pdf-lib nesne referansı: "nesneNo genNo". Kaydedilmemiş annotation'larda yoktur. */
export type RefKey = string;

interface AnnotationBase {
  /** PDF'teki /NM değeri. Yoksa okuma sırasında üretilir. */
  id: string;
  pageIndex: number;
  color: Rgb;
  opacity: number;
  /** /Contents: kullanıcının notu. */
  contents: string;
  author?: string;
  /** ISO tarih. */
  modified: string;
  ref?: RefKey;
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: "highlight";
  /**
   * PDF kullanıcı uzayında quad'lar, her biri 8 sayı:
   * sol-üst, sağ-üst, sol-alt, sağ-alt (Acrobat sırası).
   */
  quads: number[][];
  /** Vurgulanan metin; yalnızca uygulama içinde gösterim için. */
  text?: string;
}

export interface InkAnnotation extends AnnotationBase {
  kind: "ink";
  /** Her çizgi düz bir [x0, y0, x1, y1, ...] dizisi, PDF kullanıcı uzayında. */
  strokes: number[][];
  width: number;
}

export interface NoteAnnotation extends AnnotationBase {
  kind: "note";
  /** Not ikonunun sol-üst köşesi, PDF kullanıcı uzayında. */
  x: number;
  y: number;
}

/** Sayfada doğrudan görünen metin (PDF FreeText). */
export interface TextAnnotation extends AnnotationBase {
  kind: "text";
  /** Kutunun sol-üst köşesi, PDF kullanıcı uzayında. */
  x: number;
  y: number;
  /** Kutu boyutu (PDF birimi); metin düzenlenirken ölçülerek güncellenir. */
  width: number;
  height: number;
  fontSize: number;
}

export type Annotation = HighlightAnnotation | InkAnnotation | NoteAnnotation | TextAnnotation;

export const NOTE_ICON_SIZE = 20;

export const TEXT_FONT_SIZES = [10, 12, 14, 18, 24];
export const TEXT_DEFAULT_SIZE = 14;
/** Metin kutusunun iç boşluğu ve satır yüksekliği (fontSize katı); overlay ve PDF aynı değerleri kullanır. */
export const TEXT_PADDING = 2;
export const TEXT_LINE_HEIGHT = 1.3;

export const HIGHLIGHT_COLORS: Rgb[] = [
  [1, 0.92, 0.23],
  [0.55, 0.9, 0.45],
  [0.45, 0.78, 1],
  [1, 0.6, 0.75],
  [1, 0.7, 0.3],
];

export const INK_COLORS: Rgb[] = [
  [0.1, 0.1, 0.1],
  [0.86, 0.15, 0.15],
  [0.13, 0.4, 0.9],
  [0.1, 0.6, 0.3],
];

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rgbToHex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): Rgb | undefined {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return undefined;
  return [1, 2, 3].map((i) => Math.round((parseInt(m[i], 16) / 255) * 1000) / 1000) as Rgb;
}

export function sameColor(a: Rgb, b: Rgb): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) < 0.003);
}

export function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Annotation'ın sayfa üzerindeki sınırları [minX, minY, maxX, maxY]. */
export function annotationBounds(a: Annotation): [number, number, number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  switch (a.kind) {
    case "highlight":
      for (const q of a.quads) {
        for (let i = 0; i < 8; i += 2) {
          xs.push(q[i]);
          ys.push(q[i + 1]);
        }
      }
      break;
    case "ink": {
      const pad = a.width / 2;
      for (const s of a.strokes) {
        for (let i = 0; i < s.length; i += 2) {
          xs.push(s[i] - pad, s[i] + pad);
          ys.push(s[i + 1] - pad, s[i + 1] + pad);
        }
      }
      break;
    }
    case "note":
      xs.push(a.x, a.x + NOTE_ICON_SIZE);
      ys.push(a.y - NOTE_ICON_SIZE, a.y);
      break;
    case "text":
      xs.push(a.x, a.x + a.width);
      ys.push(a.y - a.height, a.y);
      break;
  }
  if (xs.length === 0) return [0, 0, 0, 0];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
