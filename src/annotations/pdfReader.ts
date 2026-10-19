import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "pdf-lib";
import type { Annotation, Rgb } from "./model";
import { HIGHLIGHT_COLORS, newId, nowIso, TEXT_DEFAULT_SIZE } from "./model";
import {
  colorFromPdf,
  decodeText,
  N,
  numbers,
  parsePdfDate,
  pdfjsIdFromRef,
  refKey,
} from "./pdfCommon";

export interface ReadResult {
  annotations: Annotation[];
  /** pdf.js'in canvas'a çizmemesi gereken annotation id'leri (overlay bunları çiziyor). */
  pdfjsHiddenIds: string[];
  /** pdf-lib şifreli PDF'leri doğru yazamaz; bu durumda annotation düzenleme kapatılır. */
  encrypted: boolean;
  /** Dijital imza içeriyor; pdf-lib tüm dosyayı yeniden yazdığı için imza bozulur. */
  signed: boolean;
}

export async function loadPdfLib(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
}

export async function readAnnotations(bytes: Uint8Array): Promise<ReadResult> {
  const doc = await loadPdfLib(bytes);
  const annotations: Annotation[] = [];
  const pdfjsHiddenIds: string[] = [];

  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookup(N.Annots);
    if (!(annots instanceof PDFArray)) return;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      // Satır içi (referanssız) annotation'ları pdf.js'te gizleyemeyiz; olduğu gibi bırakılır.
      if (!(ref instanceof PDFRef)) continue;
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const ann = parseAnnotation(dict, pageIndex);
      if (!ann) continue;
      ann.ref = refKey(ref);
      annotations.push(ann);
      pdfjsHiddenIds.push(pdfjsIdFromRef(ref));
      const popup = dict.get(N.Popup);
      if (popup instanceof PDFRef) pdfjsHiddenIds.push(pdfjsIdFromRef(popup));
    }
  });

  return {
    annotations,
    pdfjsHiddenIds,
    encrypted: doc.isEncrypted,
    signed: isSigned(doc),
  };
}

function parseAnnotation(dict: PDFDict, pageIndex: number): Annotation | undefined {
  const subtype = dict.get(N.Subtype);
  // Yanıt (IRT) annotation'ları bir başka annotation'a bağlıdır; şimdilik yönetmiyoruz.
  if (dict.has(N.IRT)) return undefined;

  const base = {
    id: decodeText(dict.lookup(N.NM)) || newId(),
    pageIndex,
    contents: decodeText(dict.lookup(N.Contents)) ?? "",
    author: decodeText(dict.lookup(N.T)),
    modified: parsePdfDate(decodeText(dict.lookup(N.M))) ?? nowIso(),
    opacity: numberOr(dict.lookup(N.CA), 1),
  };
  const color = colorFromPdf(numbers(dict.lookup(N.C)));

  if (subtype === N.Highlight) {
    const raw = numbers(dict.lookup(N.QuadPoints));
    if (raw.length === 0 || raw.length % 8 !== 0) return undefined;
    const quads: number[][] = [];
    for (let i = 0; i < raw.length; i += 8) quads.push(normalizeQuad(raw.slice(i, i + 8)));
    return {
      ...base,
      kind: "highlight",
      color: color ?? HIGHLIGHT_COLORS[0],
      quads,
      text: decodeText(dict.lookup(N.SelectedText)),
    };
  }

  if (subtype === N.Ink) {
    const list = dict.lookup(N.InkList);
    if (!(list instanceof PDFArray)) return undefined;
    const strokes: number[][] = [];
    for (let i = 0; i < list.size(); i++) {
      const s = numbers(list.lookup(i));
      if (s.length >= 2) strokes.push(s.length % 2 ? s.slice(0, -1) : s);
    }
    if (strokes.length === 0) return undefined;
    return { ...base, kind: "ink", color: color ?? [0, 0, 0], strokes, width: borderWidth(dict) };
  }

  if (subtype === N.Text) {
    const rect = numbers(dict.lookup(N.Rect));
    if (rect.length !== 4) return undefined;
    return {
      ...base,
      kind: "note",
      color: color ?? ([1, 0.85, 0.2] as Rgb),
      x: Math.min(rect[0], rect[2]),
      y: Math.max(rect[1], rect[3]),
    };
  }

  if (subtype === N.FreeText) {
    const rect = numbers(dict.lookup(N.Rect));
    if (rect.length !== 4) return undefined;
    const da = decodeText(dict.lookup(N.DA)) ?? "";
    const size = /([\d.]+)\s+Tf/.exec(da);
    const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
    const g = /([\d.]+)\s+g(?:\s|$)/.exec(da);
    const textColor: Rgb = rg
      ? [Number(rg[1]), Number(rg[2]), Number(rg[3])]
      : g
        ? [Number(g[1]), Number(g[1]), Number(g[1])]
        : [0, 0, 0];
    const fontSize = size ? Number(size[1]) || TEXT_DEFAULT_SIZE : TEXT_DEFAULT_SIZE;
    return {
      ...base,
      kind: "text",
      color: textColor,
      x: Math.min(rect[0], rect[2]),
      y: Math.max(rect[1], rect[3]),
      width: Math.abs(rect[2] - rect[0]),
      height: Math.abs(rect[3] - rect[1]),
      fontSize,
    };
  }

  return undefined;
}

/** Herhangi bir sıradaki quad'ı eksen hizalı sol-üst, sağ-üst, sol-alt, sağ-alt sırasına getirir. */
function normalizeQuad(q: number[]): number[] {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return [minX, maxY, maxX, maxY, minX, minY, maxX, minY];
}

function borderWidth(dict: PDFDict): number {
  const bs = dict.lookup(N.BS);
  if (bs instanceof PDFDict) {
    const w = bs.lookup(N.W);
    if (w instanceof PDFNumber) return w.asNumber();
  }
  const border = numbers(dict.lookup(N.Border));
  if (border.length >= 3) return border[2] || 1;
  return 1;
}

function numberOr(v: unknown, fallback: number): number {
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

function isSigned(doc: PDFDocument): boolean {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return false;
  const flags = acroForm.lookup(PDFName.of("SigFlags"));
  return flags instanceof PDFNumber && (flags.asNumber() & 1) === 1;
}
