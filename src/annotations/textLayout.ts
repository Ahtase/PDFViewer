import { TEXT_LINE_HEIGHT, TEXT_PADDING } from "./model";

/** Verilen font boyutunda metnin genişliği (PDF birimi). */
export type Measure = (text: string, fontSize: number) => number;

/**
 * Noto Sans'ın (hhea) taban çizgisi, satır kutusunun üstünden fontSize katı olarak.
 * CSS line-height 1.3 ile tarayıcının yerleştirdiği yerle aynıdır:
 * (1.3 − (ascent 1.069 + descent 0.293)) / 2 + 1.069 ≈ 1.038.
 */
export const TEXT_BASELINE = 1.038;

/** Metni satırlara böler: kullanıcının Enter'ları korunur, `maxWidth`'i aşan satırlar kelimeden kırılır. */
export function layoutLines(text: string, fontSize: number, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (measure(paragraph, fontSize) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      const candidate = line + word;
      if (line && measure(candidate.trimEnd(), fontSize) > maxWidth) {
        lines.push(line.trimEnd());
        line = word;
      } else {
        line = candidate;
      }
      // Tek kelime bile sığmıyorsa harf harf kır.
      while (measure(line.trimEnd(), fontSize) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), fontSize) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Satırları kapsayan kutunun boyutu (PDF birimi). */
export function boxSize(lines: string[], fontSize: number, measure: Measure): { width: number; height: number } {
  const textWidth = Math.max(fontSize * 0.5, ...lines.map((l) => measure(l, fontSize)));
  return {
    width: textWidth + 2 * TEXT_PADDING,
    height: Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT + 2 * TEXT_PADDING,
  };
}

/** Kaydedilmiş bir kutunun içindeki metin genişliği; ölçüm farklarına karşı küçük pay bırakılır. */
export function innerWidth(boxWidth: number): number {
  return boxWidth - 2 * TEXT_PADDING + 0.5;
}
