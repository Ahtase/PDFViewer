import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Annotation } from "./model";
import { readAnnotations } from "./pdfReader";
import { setTextFontLoader, writeAnnotations } from "./pdfWriter";
import { readFileSync } from "node:fs";

setTextFontLoader(async () => readFileSync("src/assets/fonts/NotoSans-Regular.ttf"));

async function samplePdf(pageCount = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Sayfa ${i + 1}: Lorem ipsum dolor sit amet`, { x: 72, y: 700, size: 14, font });
  }
  return doc.save();
}

async function pdfjsAnnotations(bytes: Uint8Array, pageNumber: number) {
  const task = getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const anns = await page.getAnnotations();
  await task.destroy();
  return anns;
}

const highlight: Annotation = {
  kind: "highlight",
  id: "h-1",
  pageIndex: 0,
  color: [1, 0.92, 0.23],
  opacity: 1,
  contents: "Önemli: ğüşiöç",
  modified: "2026-10-16T12:00:00.000Z",
  quads: [[72, 716, 300, 716, 72, 698, 300, 698]],
  text: "Lorem ipsum",
};

const ink: Annotation = {
  kind: "ink",
  id: "i-1",
  pageIndex: 1,
  color: [0.86, 0.15, 0.15],
  opacity: 1,
  contents: "",
  modified: "2026-10-16T12:00:00.000Z",
  strokes: [[100, 100, 120, 130, 150, 120, 180, 160]],
  width: 2,
};

const note: Annotation = {
  kind: "note",
  id: "n-1",
  pageIndex: 0,
  color: [1, 0.85, 0.2],
  opacity: 1,
  contents: "Yan not",
  modified: "2026-10-16T12:00:00.000Z",
  x: 400,
  y: 500,
};

describe("annotation round-trip", () => {
  it("yazılan annotation'lar pdf-lib ile aynen geri okunur", async () => {
    const base = await samplePdf();
    const { bytes, refs } = await writeAnnotations(base, [highlight, ink, note], []);
    const read = await readAnnotations(bytes);

    expect(read.annotations).toHaveLength(3);
    const byId = Object.fromEntries(read.annotations.map((a) => [a.id, a]));
    expect(byId["h-1"]).toMatchObject({
      kind: "highlight",
      pageIndex: 0,
      contents: "Önemli: ğüşiöç",
      quads: highlight.quads,
      text: "Lorem ipsum",
      ref: refs["h-1"],
    });
    expect(byId["i-1"]).toMatchObject({ kind: "ink", pageIndex: 1, strokes: ink.strokes, width: 2 });
    expect(byId["n-1"]).toMatchObject({ kind: "note", x: 400, y: 500, contents: "Yan not" });
    // highlight + not + iki popup + ink
    expect(read.pdfjsHiddenIds).toHaveLength(5);
  });

  it("pdf.js standart alanları ve appearance stream'i görür", async () => {
    const base = await samplePdf();
    const { bytes } = await writeAnnotations(base, [highlight, ink, note], []);

    const page1 = await pdfjsAnnotations(bytes, 1);
    const hl = page1.find((a) => a.subtype === "Highlight");
    expect(hl).toBeDefined();
    expect(hl.contentsObj.str).toBe("Önemli: ğüşiöç");
    expect(Array.from(hl.quadPoints as Float32Array)).toEqual(highlight.kind === "highlight" ? highlight.quads[0] : []);
    expect(Array.from(hl.color as Uint8ClampedArray)).toEqual([255, 235, 59]);
    expect(page1.find((a) => a.subtype === "Text")).toBeDefined();
    expect(page1.find((a) => a.subtype === "Popup")).toBeDefined();

    const page2 = await pdfjsAnnotations(bytes, 2);
    const inkAnn = page2.find((a) => a.subtype === "Ink");
    expect(inkAnn.inkLists).toHaveLength(1);
    // pdf.js /AP varsa kendi varsayılan görünümünü üretmez; hasAppearance bunu gösterir.
    expect(hl.hasAppearance).toBe(true);
    expect(inkAnn.hasAppearance).toBe(true);
  });

  it("ikinci kayıt: düzenleme yerinde, silme gerçekten siler, nesne sayısı şişmez", async () => {
    const base = await samplePdf();
    const first = await writeAnnotations(base, [highlight, ink, note], []);
    const firstRead = await readAnnotations(first.bytes);
    const managed = firstRead.annotations.map((a) => a.ref!);

    const edited = firstRead.annotations
      .filter((a) => a.id !== "i-1")
      .map((a) => (a.id === "h-1" ? { ...a, contents: "Güncellendi", color: [0.45, 0.78, 1] as [number, number, number] } : a));
    const second = await writeAnnotations(first.bytes, edited, managed);
    const secondRead = await readAnnotations(second.bytes);

    expect(secondRead.annotations.map((a) => a.id).sort()).toEqual(["h-1", "n-1"]);
    const h = secondRead.annotations.find((a) => a.id === "h-1")!;
    expect(h.contents).toBe("Güncellendi");
    expect(h.color).toEqual([0.45, 0.78, 1]);
    expect(h.ref).toBe(first.refs["h-1"]);

    const page2 = await pdfjsAnnotations(second.bytes, 2);
    expect(page2.filter((a) => a.subtype === "Ink")).toHaveLength(0);

    // Aynı içeriği tekrar tekrar kaydetmek eski appearance stream'leri biriktirmemeli.
    const third = await writeAnnotations(second.bytes, secondRead.annotations, secondRead.annotations.map((a) => a.ref!));
    const objCount = async (b: Uint8Array) => (await PDFDocument.load(b)).context.enumerateIndirectObjects().length;
    expect(await objCount(third.bytes)).toBe(await objCount(second.bytes));
  });

  it("başka uygulamanın annotation'ını (NM'siz) okur ve yönetir", async () => {
    const doc = await PDFDocument.load(await samplePdf(1));
    const page = doc.getPage(0);
    const dict = doc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [70, 690, 310, 720],
      QuadPoints: [72, 698, 300, 698, 72, 716, 300, 716],
      C: [0, 1, 0],
    });
    page.node.set(doc.context.obj("Annots") as never, doc.context.obj([doc.context.register(dict)]));
    const read = await readAnnotations(await doc.save());
    expect(read.annotations).toHaveLength(1);
    const [a] = read.annotations;
    expect(a.kind).toBe("highlight");
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    // Farklı köşe sırası normalize edilir.
    expect(a.kind === "highlight" && a.quads[0]).toEqual([72, 716, 300, 716, 72, 698, 300, 698]);
  });

  const text: Annotation = {
    kind: "text",
    id: "t-1",
    pageIndex: 0,
    color: [0.13, 0.4, 0.9],
    opacity: 1,
    contents: "Şu ığdır çok güzel\nİkinci satır ĞÜŞÇÖ",
    modified: "2026-10-16T12:00:00.000Z",
    x: 100,
    y: 400,
    width: 160,
    height: 40,
    fontSize: 14,
  };

  it("metin notu (FreeText) Türkçe karakterlerle yazılır ve okunur", async () => {
    const base = await samplePdf(1);
    const { bytes } = await writeAnnotations(base, [text], []);
    const read = await readAnnotations(bytes);
    expect(read.annotations[0]).toMatchObject({
      kind: "text",
      contents: text.contents,
      x: 100,
      y: 400,
      width: 160,
      height: 40,
      fontSize: 14,
      color: [0.13, 0.4, 0.9],
    });

    const [ft] = (await pdfjsAnnotations(bytes, 1)).filter((a) => a.subtype === "FreeText");
    expect(ft.contentsObj.str).toBe(text.contents);
    // /DA diğer okuyucuların ayrıştırabileceği düz ASCII olmalı.
    expect(ft.defaultAppearanceData).toMatchObject({ fontSize: 14 });
    expect(Array.from(ft.defaultAppearanceData.fontColor as Uint8ClampedArray)).toEqual([33, 102, 230]);
    expect(ft.hasAppearance).toBe(true);
    // Gömülü font gerçekten içeride mi?
    const fontNames = (await PDFDocument.load(bytes)).context
      .enumerateIndirectObjects()
      .map(([, o]) => (o instanceof PDFDict ? o.lookup(PDFName.of("BaseFont")) : undefined))
      .filter((n): n is PDFName => n instanceof PDFName)
      .map((n) => n.decodeText());
    expect(fontNames.some((n) => n.includes("NotoSans"))).toBe(true);
  });

  it("metin notu tekrar kaydedilince eski font kopyaları birikmez; boş metin yazılmaz", async () => {
    const base = await samplePdf(1);
    const first = await writeAnnotations(base, [text], []);
    const r1 = await readAnnotations(first.bytes);
    const second = await writeAnnotations(first.bytes, r1.annotations.map((a) => ({ ...a, contents: a.contents + "!" })), [first.refs["t-1"]]);
    const r2 = await readAnnotations(second.bytes);
    const third = await writeAnnotations(second.bytes, r2.annotations, [second.refs["t-1"]]);
    const objCount = async (b: Uint8Array) => (await PDFDocument.load(b)).context.enumerateIndirectObjects().length;
    expect(await objCount(third.bytes)).toBe(await objCount(second.bytes));
    expect(third.bytes.length).toBeLessThan(second.bytes.length * 1.05);

    const emptied = await writeAnnotations(third.bytes, [{ ...text, contents: "  ", ref: third.refs["t-1"] }], [third.refs["t-1"]]);
    expect((await readAnnotations(emptied.bytes)).annotations).toHaveLength(0);
    expect(await objCount(emptied.bytes)).toBe(await objCount(base));
  });

  it("dosyada artık yönetilmeyen (geri alınmış) ref başka nesneyi ezmez", async () => {
    const base = await samplePdf(1);
    const first = await writeAnnotations(base, [highlight], []);
    // Annotation silinip kaydedildi; sonra geri alındı ve eski ref'iyle geri geldi.
    const deleted = await writeAnnotations(first.bytes, [], [first.refs["h-1"]]);
    const stale = { ...highlight, ref: first.refs["h-1"] };
    const restored = await writeAnnotations(deleted.bytes, [stale, note], []);
    const read = await readAnnotations(restored.bytes);
    expect(read.annotations.map((a) => a.id).sort()).toEqual(["h-1", "n-1"]);
  });

  it("başka sayfaya taşınan annotation eski sayfadan çıkar, yenisinde görünür", async () => {
    const base = await samplePdf(2);
    const first = await writeAnnotations(base, [text], []);
    const ref = first.refs["t-1"];
    const moved = await writeAnnotations(first.bytes, [{ ...text, ref, pageIndex: 1, y: 600 }], [ref]);
    const read = await readAnnotations(moved.bytes);
    expect(read.annotations).toHaveLength(1);
    expect(read.annotations[0]).toMatchObject({ id: "t-1", pageIndex: 1, y: 600, ref });
    expect((await pdfjsAnnotations(moved.bytes, 1)).filter((a) => a.subtype === "FreeText")).toHaveLength(0);
    expect((await pdfjsAnnotations(moved.bytes, 2)).filter((a) => a.subtype === "FreeText")).toHaveLength(1);
  });
});
