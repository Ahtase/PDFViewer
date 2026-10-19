/** Düz bir [x0, y0, x1, y1, ...] dizisini nokta dizisine çevirir. */
export function toPoints(flat: number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
}

/** Ramer–Douglas–Peucker ile çizgiyi basitleştirir. `epsilon` koordinatlarla aynı birimdedir. */
export function simplify(flat: number[], epsilon: number): number[] {
  const pts = toPoints(flat);
  if (pts.length <= 2) return flat.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistance(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  pts.forEach((p, i) => keep[i] && out.push(p[0], p[1]));
  return out;
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export type PathSeg =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

/**
 * Noktalardan yumuşak bir yol üretir (ara noktalardan geçen kuadratik eğriler,
 * kübik olarak ifade edilir). SVG ve PDF appearance stream aynı yolu kullanır.
 */
export function smoothPath(flat: number[]): PathSeg[] {
  const pts = toPoints(flat);
  if (pts.length === 0) return [];
  const segs: PathSeg[] = [{ op: "M", x: pts[0][0], y: pts[0][1] }];
  if (pts.length === 1) {
    segs.push({ op: "L", x: pts[0][0], y: pts[0][1] });
    return segs;
  }
  if (pts.length === 2) {
    segs.push({ op: "L", x: pts[1][0], y: pts[1][1] });
    return segs;
  }
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const ctrl = pts[i];
    const end: [number, number] =
      i === pts.length - 2 ? pts[i + 1] : [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    segs.push({
      op: "C",
      x1: prev[0] + (2 / 3) * (ctrl[0] - prev[0]),
      y1: prev[1] + (2 / 3) * (ctrl[1] - prev[1]),
      x2: end[0] + (2 / 3) * (ctrl[0] - end[0]),
      y2: end[1] + (2 / 3) * (ctrl[1] - end[1]),
      x: end[0],
      y: end[1],
    });
    prev = end;
  }
  return segs;
}

export function svgPathData(flat: number[]): string {
  return smoothPath(flat)
    .map((s) => (s.op === "C" ? `C${s.x1} ${s.y1} ${s.x2} ${s.y2} ${s.x} ${s.y}` : `${s.op}${s.x} ${s.y}`))
    .join("");
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Seçim dikdörtgenlerini (ekran/viewport koordinatları) satırlara göre birleştirir.
 * Metin katmanı aynı satır için çok sayıda üst üste binen dikdörtgen üretir;
 * ayrıca bazı tarayıcılar kapsayıcı elemanlar için devasa dikdörtgenler döndürür, bunlar atılır.
 */
export function mergeLineRects(rects: Box[]): Box[] {
  const valid = rects.filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5);
  if (valid.length === 0) return [];
  const heights = valid.map((r) => r.bottom - r.top).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const sorted = valid
    .filter((r) => r.bottom - r.top <= median * 2.5)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: Box[] = [];
  for (const r of sorted) {
    const h = r.bottom - r.top;
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
      const gap = Math.max(l.left, r.left) - Math.min(l.right, r.right);
      return overlap > h * 0.5 && gap < h * 1.5;
    });
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

/** Dört köşesi PDF uzayında verilen dikdörtgenden eksen hizalı quad üretir. */
export function quadFromCorners(corners: [number, number][]): number[] {
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return [minX, maxY, maxX, maxY, minX, minY, maxX, minY];
}

/** Nokta, quad'ın içinde mi (PDF uzayında, eksen hizalı quad varsayımıyla). */
export function pointInQuad(x: number, y: number, q: number[]): boolean {
  const minX = Math.min(q[0], q[4]), maxX = Math.max(q[2], q[6]);
  const minY = Math.min(q[5], q[7]), maxY = Math.max(q[1], q[3]);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** Noktanın bir çizgiye uzaklığı (silgi için). */
export function distanceToStroke(x: number, y: number, flat: number[]): number {
  const pts = toPoints(flat);
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]);
  let min = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) min = Math.min(min, segmentDistance([x, y], pts[i], pts[i + 1]));
  return min;
}

/** Satır kutusunu dikey merkezinden `factor` kadar inceltir/kalınlaştırır (1 = font boyutu). */
export function scaleBoxHeight(box: Box, factor: number): Box {
  const center = (box.top + box.bottom) / 2;
  const half = ((box.bottom - box.top) * factor) / 2;
  return { ...box, top: center - half, bottom: center + half };
}
