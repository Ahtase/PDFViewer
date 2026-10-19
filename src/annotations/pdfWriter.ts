import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";
import type { Annotation, HighlightAnnotation, InkAnnotation, NoteAnnotation, RefKey, TextAnnotation } from "./model";
import { annotationBounds, NOTE_ICON_SIZE, TEXT_LINE_HEIGHT, TEXT_PADDING } from "./model";
import { smoothPath } from "./geometry";
import { innerWidth, layoutLines, TEXT_BASELINE } from "./textLayout";
import { loadPdfLib } from "./pdfReader";
import { N, parseRefKey, refKey, toPdfDate } from "./pdfCommon";

export interface WriteResult {
  bytes: Uint8Array;
  /** Annotation id → yazılan nesnenin referansı. Bir sonraki kayıtta `managedRefs` olarak kullanılır. */
  refs: Record<string, RefKey>;
}

const FLAG_PRINT = 4;
const FLAG_NO_ZOOM = 8;
const FLAG_NO_ROTATE = 16;

/** Metin notları için gömülecek Unicode font (Türkçe karakterler standart PDF fontlarında yok). */
let textFontLoader: (() => Promise<Uint8Array>) | undefined;
export function setTextFontLoader(loader: () => Promise<Uint8Array>) {
  textFontLoader = loader;
}

/** Bizim gömdüğümüz font sözlüklerine konan işaret; eski kopyalar kayıtta bununla bulunup silinir. */
const FONT_MARKER = PDFName.of("PDFViewer_Font");

/**
 * `baseBytes` içindeki yönetilen annotation'ları `annotations` ile eşitler:
 * - `managedRefs` içinde olup artık modelde olmayanlar silinir,
 * - `ref`'i olanlar yerinde güncellenir (yazar, yanıtlar gibi bilmediğimiz alanlar korunur),
 * - `ref`'i olmayanlar yeni nesne olarak eklenir.
 * pdf-lib nesne numaralarını korur; bu yüzden dönen referanslar yeni baytlarda da geçerlidir.
 */
export async function writeAnnotations(
  baseBytes: Uint8Array,
  annotations: Annotation[],
  managedRefs: RefKey[],
): Promise<WriteResult> {
  const doc = await loadPdfLib(baseBytes);
  const pages = doc.getPages();
  const managed = new Set(managedRefs);
  // Boş metin kutuları dosyaya yazılmaz (yazmaya yeni başlanmış ya da içi silinmiş).
  const toWrite = annotations.filter((a) => a.kind !== "text" || a.contents.trim());
  // Sadece dosyada gerçekten bizim yönettiğimiz ref'ler geçerlidir. Geri al/yinele eski bir
  // ref'i geri getirebilir; o numara bu arada başka bir nesneye verilmiş olabilir.
  const liveRef = (a: Annotation) => (a.ref && managed.has(a.ref) ? a.ref : undefined);
  const keep = new Set(toWrite.map(liveRef).filter(Boolean));

  for (const key of managedRefs) {
    if (!keep.has(key)) removeAnnotation(doc, pages, parseRefKey(key));
  }

  let font: PDFFont | undefined;
  if (toWrite.some((a) => a.kind === "text")) {
    if (!textFontLoader) throw new Error("Metin notları için font yükleyici ayarlanmamış");
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await textFontLoader(), { subset: true });
  }

  const refs: Record<string, RefKey> = {};
  for (const ann of toWrite) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    const key = liveRef(ann);
    let ref = key ? parseRefKey(key) : undefined;
    let dict = ref ? doc.context.lookup(ref) : undefined;
    if (!(dict instanceof PDFDict) || !ref) {
      dict = doc.context.obj({ Type: "Annot" });
      ref = doc.context.register(dict);
      annotsOf(doc, page).push(ref);
    } else {
      // Başka sayfaya taşınmış olabilir.
      moveToPage(doc, pages, page, dict as PDFDict, ref);
    }
    fillAnnotation(doc, page, dict as PDFDict, ann, font);
    ensurePopup(doc, page, dict as PDFDict, ref, ann);
    refs[ann.id] = refKey(ref);
  }

  if (font) {
    // Alt kümeyi şimdi göm ki font sözlüğünü işaretleyebilelim (save() tekrar gömmez).
    await font.embed();
    const fontDict = doc.context.lookup(font.ref);
    if (fontDict instanceof PDFDict) fontDict.set(FONT_MARKER, PDFBool.True);
  }

  const bytes = await doc.save({ updateFieldAppearances: false });
  return { bytes, refs };
}

function annotsOf(doc: PDFDocument, page: PDFPage): PDFArray {
  const existing = page.node.lookup(N.Annots);
  if (existing instanceof PDFArray) return existing;
  const arr = doc.context.obj([]);
  page.node.set(N.Annots, arr);
  return arr;
}

/** Annotation'ı (ve popup'ını) diğer sayfaların /Annots listesinden çıkarıp `page`'e ekler. */
function moveToPage(doc: PDFDocument, pages: PDFPage[], page: PDFPage, dict: PDFDict, ref: PDFRef) {
  const target = annotsOf(doc, page);
  if (target.asArray().includes(ref)) return;
  const popup = dict.get(N.Popup);
  const refs = [ref, popup instanceof PDFRef ? popup : undefined].filter(Boolean) as PDFRef[];
  for (const other of pages) {
    if (other === page) continue;
    const annots = other.node.lookup(N.Annots);
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const r = annots.get(i);
      if (r instanceof PDFRef && refs.includes(r)) annots.remove(i);
    }
  }
  for (const r of refs) target.push(r);
}

function removeAnnotation(doc: PDFDocument, pages: PDFPage[], ref: PDFRef) {
  const dict = doc.context.lookup(ref);
  const popup = dict instanceof PDFDict ? dict.get(N.Popup) : undefined;
  const targets = [ref, popup instanceof PDFRef ? popup : undefined].filter(Boolean) as PDFRef[];
  for (const page of pages) {
    const annots = page.node.lookup(N.Annots);
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const r = annots.get(i);
      if (r instanceof PDFRef && targets.includes(r)) annots.remove(i);
    }
  }
  if (dict instanceof PDFDict) deleteAppearance(doc, dict);
  for (const r of targets) doc.context.delete(r);
}

/** Annotation'ın appearance stream'ini ve bizim gömdüğümüz fontları siler. */
function deleteAppearance(doc: PDFDocument, dict: PDFDict) {
  const ap = dict.lookup(N.AP);
  if (!(ap instanceof PDFDict)) return;
  const nRef = ap.get(PDFName.of("N"));
  if (!(nRef instanceof PDFRef)) return;
  const stream = doc.context.lookup(nRef);
  if (stream instanceof PDFStream) {
    const fonts = stream.dict.lookup(PDFName.of("Resources"));
    const fontMap = fonts instanceof PDFDict ? fonts.lookup(PDFName.of("Font")) : undefined;
    if (fontMap instanceof PDFDict) {
      for (const [, fontRef] of fontMap.entries()) {
        const fontDict = fontRef instanceof PDFRef ? doc.context.lookup(fontRef) : undefined;
        if (fontDict instanceof PDFDict && fontDict.has(FONT_MARKER)) deleteTree(doc, fontRef as PDFRef);
      }
    }
  }
  doc.context.delete(nRef);
}

/** Bir nesneyi ve ondan erişilen tüm dolaylı nesneleri siler (yalnızca kendi font ağacımız için). */
function deleteTree(doc: PDFDocument, ref: PDFRef) {
  const obj = doc.context.lookup(ref);
  if (obj === undefined) return;
  doc.context.delete(ref);
  const visit = (o: PDFObject | undefined) => {
    if (o instanceof PDFRef) deleteTree(doc, o);
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) visit(v);
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) visit(o.get(i));
    else if (o instanceof PDFStream) visit(o.dict);
  };
  visit(obj);
}

function fillAnnotation(doc: PDFDocument, page: PDFPage, dict: PDFDict, ann: Annotation, font?: PDFFont) {
  const ctx = doc.context;
  const subtype = {
    highlight: N.Highlight,
    ink: N.Ink,
    note: N.Text,
    text: N.FreeText,
  }[ann.kind];
  const [minX, minY, maxX, maxY] = annotationBounds(ann);

  dict.set(N.Subtype, subtype);
  dict.set(N.Rect, ctx.obj([minX, minY, maxX, maxY].map(round)));
  dict.set(N.NM, PDFHexString.fromText(ann.id));
  // Tarih ve /DA bayt dizisidir (ASCII); UTF-16 yazılırsa okuyucular ayrıştıramaz.
  dict.set(N.M, PDFString.of(toPdfDate(ann.modified)));
  dict.set(N.C, ctx.obj(ann.color.map(round)));
  dict.set(N.CA, ctx.obj(round(ann.opacity)));
  dict.set(N.P, page.ref);
  if (ann.contents) dict.set(N.Contents, PDFHexString.fromText(ann.contents));
  else dict.delete(N.Contents);
  if (ann.author) dict.set(N.T, PDFHexString.fromText(ann.author));

  // Eski appearance stream'i sil; yerine yenisi yazılacak.
  deleteAppearance(doc, dict);

  let content: string;
  const fonts: Record<string, PDFRef> = {};
  switch (ann.kind) {
    case "highlight":
      dict.set(N.F, ctx.obj(FLAG_PRINT));
      dict.set(N.QuadPoints, ctx.obj(ann.quads.flat().map(round)));
      if (ann.text) dict.set(N.SelectedText, PDFHexString.fromText(ann.text));
      content = highlightAppearance(ann);
      break;
    case "ink":
      dict.set(N.F, ctx.obj(FLAG_PRINT));
      dict.set(N.InkList, ctx.obj(ann.strokes.map((s) => s.map(round))));
      dict.set(N.BS, ctx.obj({ Type: "Border", W: round(ann.width), S: "S" }));
      content = inkAppearance(ann);
      break;
    case "note":
      dict.set(N.F, ctx.obj(FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE));
      dict.set(PDFName.of("Name"), PDFName.of("Comment"));
      content = noteAppearance(ann);
      break;
    case "text": {
      dict.set(N.F, ctx.obj(FLAG_PRINT));
      const color = rgb(ann.color);
      dict.set(N.DA, PDFString.of(`/Helv ${round(ann.fontSize)} Tf ${color} rg`));
      dict.set(N.DS, PDFString.of(`font: Helvetica,sans-serif ${round(ann.fontSize)}pt; color: ${hex(ann.color)}`));
      dict.set(N.BS, ctx.obj({ Type: "Border", W: 0 }));
      dict.delete(N.C);
      content = textAppearance(ann, font!);
      fonts.F0 = font!.ref;
      break;
    }
  }

  const resources = ctx.obj({
    Font: fonts,
    ExtGState: {
      GS0: {
        Type: "ExtGState",
        CA: round(ann.opacity),
        ca: round(ann.opacity),
        BM: ann.kind === "highlight" ? "Multiply" : "Normal",
      },
    },
  });
  const stream = ctx.flateStream(content, {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: [minX, minY, maxX, maxY].map(round),
    Resources: resources,
  });
  dict.set(N.AP, ctx.obj({ N: ctx.register(stream) }));
}

/** Not içeren annotation'lar için /Popup ekler; Acrobat ve bazı mobil okuyucular bunu bekler. */
function ensurePopup(doc: PDFDocument, page: PDFPage, dict: PDFDict, ref: PDFRef, ann: Annotation) {
  if (!ann.contents || ann.kind === "ink" || ann.kind === "text" || dict.has(N.Popup)) return;
  const [, , maxX, maxY] = annotationBounds(ann);
  const popup = doc.context.obj({
    Type: "Annot",
    Subtype: "Popup",
    Rect: [maxX, maxY - 120, maxX + 200, maxY].map(round),
    Open: false,
  });
  popup.set(N.Parent, ref);
  const popupRef = doc.context.register(popup);
  dict.set(N.Popup, popupRef);
  annotsOf(doc, page).push(popupRef);
}

function highlightAppearance(ann: HighlightAnnotation): string {
  const ops = ["/GS0 gs", `${rgb(ann.color)} rg`];
  for (const q of ann.quads) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = q.map(round);
    ops.push(`${x1} ${y1} m ${x2} ${y2} l ${x4} ${y4} l ${x3} ${y3} l h`);
  }
  ops.push("f");
  return ops.join("\n");
}

function inkAppearance(ann: InkAnnotation): string {
  const ops = ["/GS0 gs", `${rgb(ann.color)} RG`, `${round(ann.width)} w`, "1 J", "1 j"];
  for (const stroke of ann.strokes) {
    for (const s of smoothPath(stroke)) {
      if (s.op === "M") ops.push(`${round(s.x)} ${round(s.y)} m`);
      else if (s.op === "L") ops.push(`${round(s.x)} ${round(s.y)} l`);
      else ops.push(`${[s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(round).join(" ")} c`);
    }
    ops.push("S");
  }
  return ops.join("\n");
}

function noteAppearance(ann: NoteAnnotation): string {
  const s = NOTE_ICON_SIZE;
  const x = round(ann.x);
  const y = round(ann.y - s);
  const dark = ann.color.map((c) => c * 0.55) as [number, number, number];
  return [
    "/GS0 gs",
    `${rgb(ann.color)} rg`,
    `${rgb(dark)} RG`,
    "1 w",
    `${x + 0.5} ${y + 0.5} ${s - 1} ${s - 1} re B`,
    "1.2 w",
    ...[0.72, 0.5, 0.28].map((f) => `${x + 4} ${round(y + s * f)} m ${x + s - 4} ${round(y + s * f)} l S`),
  ].join("\n");
}

function textAppearance(ann: TextAnnotation, font: PDFFont): string {
  const size = ann.fontSize;
  const measure = (t: string, s: number) => font.widthOfTextAtSize(t, s);
  const lines = layoutLines(ann.contents, size, innerWidth(ann.width), measure);
  const ops = ["/GS0 gs", "BT", `/F0 ${round(size)} Tf`, `${rgb(ann.color)} rg`];
  lines.forEach((line, i) => {
    if (!line) return;
    const x = round(ann.x + TEXT_PADDING);
    const y = round(ann.y - TEXT_PADDING - i * size * TEXT_LINE_HEIGHT - size * TEXT_BASELINE);
    ops.push(`1 0 0 1 ${x} ${y} Tm`, `${font.encodeText(line).toString()} Tj`);
  });
  ops.push("ET");
  return ops.join("\n");
}

function hex(c: [number, number, number]): string {
  return "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

function rgb(c: [number, number, number]): string {
  return c.map(round).join(" ");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
