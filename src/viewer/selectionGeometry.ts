import type { Box } from "../annotations/geometry";

/**
 * Seçimdeki metnin ekran kutuları (satır birleştirmesi yapılmadan).
 *
 * Yatay sınırlar seçimin kendisinden gelir. Dikey sınırlar ise metin katmanındaki
 * span'in kutusundan alınır: pdf.js span'i PDF fontunun ascent'ine göre yerleştirir ve
 * yüksekliği font boyutu kadardır, yani harflerle hizalıdır. Range.getClientRects()'in
 * dikey değerleri ise metin katmanının yedek fontunun satır yüksekliğidir
 * (~1.4× font boyutu) ve highlight'ı satır aralığına taşırır.
 */
export function selectionBoxes(range: Range): Box[] {
  const boxes: Box[] = [];
  for (const node of textNodesIn(range)) {
    const span = node.parentElement;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    if (part.collapsed) continue;

    const spanBox = span?.closest(".textLayer") ? span.getBoundingClientRect() : undefined;
    // Dikey/dönmüş metinde span kutusu satır yönünü yansıtmaz; seçim kutusunu olduğu gibi kullan.
    const horizontal = spanBox && spanBox.height > 0 && spanBox.height < spanBox.width * 2;
    for (const r of part.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      boxes.push(
        horizontal
          ? { left: r.left, right: r.right, top: spanBox.top, bottom: spanBox.bottom }
          : { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      );
    }
  }
  return boxes;
}

function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (range.intersectsNode(n) && n.textContent) nodes.push(n as Text);
  }
  return nodes;
}
