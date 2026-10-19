import { describe, expect, it } from "vitest";
import { distanceToStroke, mergeLineRects, scaleBoxHeight, pointInQuad, quadFromCorners, simplify, smoothPath } from "./geometry";

describe("mergeLineRects", () => {
  it("aynı satırdaki parçalı dikdörtgenleri birleştirir, satırları ayrı tutar", () => {
    const lines = mergeLineRects([
      { left: 10, top: 100, right: 60, bottom: 112 },
      { left: 58, top: 101, right: 120, bottom: 112 },
      { left: 10, top: 116, right: 90, bottom: 128 },
    ]);
    expect(lines).toEqual([
      { left: 10, top: 100, right: 120, bottom: 112 },
      { left: 10, top: 116, right: 90, bottom: 128 },
    ]);
  });

  it("kapsayıcı elemanların devasa dikdörtgenlerini ve boşları atar", () => {
    const lines = mergeLineRects([
      { left: 0, top: 0, right: 600, bottom: 800 },
      { left: 10, top: 100, right: 60, bottom: 112 },
      { left: 70, top: 100, right: 70, bottom: 112 },
      { left: 10, top: 116, right: 60, bottom: 128 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.bottom - l.top === 12)).toBe(true);
  });
});

describe("quad", () => {
  it("köşeler hangi sırada gelirse gelsin Acrobat sırasında quad üretir", () => {
    // 90° döndürülmüş sayfada köşeler karışık gelir.
    const q = quadFromCorners([[300, 100], [300, 50], [280, 100], [280, 50]]);
    expect(q).toEqual([280, 100, 300, 100, 280, 50, 300, 50]);
    expect(pointInQuad(290, 75, q)).toBe(true);
    expect(pointInQuad(310, 75, q)).toBe(false);
  });
});

describe("çizgi", () => {
  it("simplify düz çizgideki ara noktaları atar, köşeleri korur", () => {
    const flat = [0, 0, 1, 0.01, 2, 0, 3, 0, 3, 1, 3, 2];
    expect(simplify(flat, 0.1)).toEqual([0, 0, 3, 0, 3, 2]);
  });

  it("smoothPath ilk noktada başlar, son noktada biter", () => {
    const segs = smoothPath([0, 0, 10, 10, 20, 0, 30, 10]);
    expect(segs[0]).toEqual({ op: "M", x: 0, y: 0 });
    const last = segs[segs.length - 1];
    expect(last.op === "C" && [last.x, last.y]).toEqual([30, 10]);
  });

  it("tek noktalı çizgi (nokta) çizilebilir ve silgiyle bulunur", () => {
    expect(smoothPath([5, 5])).toHaveLength(2);
    expect(distanceToStroke(6, 5, [5, 5])).toBe(1);
  });
});

describe("scaleBoxHeight", () => {
  it("kutuyu merkezinden ölçekler, yatay sınırlara dokunmaz", () => {
    const b = { left: 10, right: 90, top: 100, bottom: 120 };
    expect(scaleBoxHeight(b, 0.5)).toEqual({ left: 10, right: 90, top: 105, bottom: 115 });
    expect(scaleBoxHeight(b, 1.5)).toEqual({ left: 10, right: 90, top: 95, bottom: 125 });
  });
});
