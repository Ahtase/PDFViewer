import {
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";
import type { RefKey, Rgb } from "./model";

export const N = {
  Annots: PDFName.of("Annots"),
  Subtype: PDFName.of("Subtype"),
  Highlight: PDFName.of("Highlight"),
  Ink: PDFName.of("Ink"),
  Text: PDFName.of("Text"),
  FreeText: PDFName.of("FreeText"),
  DA: PDFName.of("DA"),
  DS: PDFName.of("DS"),
  Popup: PDFName.of("Popup"),
  Parent: PDFName.of("Parent"),
  IRT: PDFName.of("IRT"),
  NM: PDFName.of("NM"),
  Contents: PDFName.of("Contents"),
  T: PDFName.of("T"),
  M: PDFName.of("M"),
  C: PDFName.of("C"),
  CA: PDFName.of("CA"),
  Rect: PDFName.of("Rect"),
  QuadPoints: PDFName.of("QuadPoints"),
  InkList: PDFName.of("InkList"),
  BS: PDFName.of("BS"),
  W: PDFName.of("W"),
  Border: PDFName.of("Border"),
  AP: PDFName.of("AP"),
  F: PDFName.of("F"),
  P: PDFName.of("P"),
  Open: PDFName.of("Open"),
  /** Uygulamaya özel anahtar: vurgulanan metin. Diğer okuyucular bilinmeyen anahtarları yok sayar. */
  SelectedText: PDFName.of("PDFViewer_SelectedText"),
} as const;

export function refKey(ref: PDFRef): RefKey {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

export function parseRefKey(key: RefKey): PDFRef {
  const [num, gen] = key.split(" ").map(Number);
  return PDFRef.of(num, gen);
}

/** pdf.js'in annotation id'si (Ref.toString): "12R" veya gen ≠ 0 ise "12R3". */
export function pdfjsIdFromRef(ref: PDFRef): string {
  return ref.generationNumber === 0
    ? `${ref.objectNumber}R`
    : `${ref.objectNumber}R${ref.generationNumber}`;
}

export function decodeText(obj: PDFObject | undefined): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

export function numbers(arr: PDFObject | undefined): number[] {
  if (!(arr instanceof PDFArray)) return [];
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    if (v instanceof PDFNumber) out.push(v.asNumber());
  }
  return out;
}

export function colorFromPdf(c: number[]): Rgb | undefined {
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 4) {
    const [cy, m, y, k] = c;
    return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return undefined;
}

/** "D:20261016193000+03'00'" → ISO. Çözülemezse undefined. */
export function parsePdfDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", tz, tzh = "00", tzm = "00"] = m;
  const offset = !tz || tz === "Z" || tz === "z" ? "Z" : `${tz}${tzh}:${tzm}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toPdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
