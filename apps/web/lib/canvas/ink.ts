import { INK_MAX_POINTS, INK_MAX_SIZE } from "./model";

export interface InkPoint { x: number; y: number }

/** Bounded distance sampling during capture, including the latest endpoint. */
export function appendInkPoint(points: readonly InkPoint[], point: InkPoint, distance = 1): InkPoint[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [...points];
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < distance) return [...points];
  const next = [...points, point];
  if (next.length <= INK_MAX_POINTS) return next;
  return next.filter((_, i) => i % 2 === 0 || i === next.length - 1);
}

/** Iterative RDP preserves corners/endpoints without recursive stack growth. */
export function simplifyInk(points: readonly InkPoint[], tolerance = 0.75): InkPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    const a = points[start], b = points[end];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    let max = tolerance * tolerance, index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (distance > max) { max = distance; index = i; }
    }
    if (index >= 0) { keep.add(index); pending.push([start, index], [index, end]); }
  }
  const result = [...keep].sort((a, b) => a - b).map((i) => points[i]);
  if (result.length <= INK_MAX_POINTS) return result;
  return Array.from({ length: INK_MAX_POINTS }, (_, i) => result[Math.round(i * (result.length - 1) / (INK_MAX_POINTS - 1))]);
}

/** No chrome/padding: the committed stroke is exactly where the pointer preview was. */
export function normalizeInk(points: readonly InkPoint[], minimumExtent = 3) {
  if (points.length < 2 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  if (Math.max(right - x, bottom - y) < minimumExtent) return null;
  const width = Math.max(1, right - x), height = Math.max(1, bottom - y);
  if (width > INK_MAX_SIZE || height > INK_MAX_SIZE || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  return { x, y, width, height, points: simplifyInk(points).flatMap((p) => [p.x - x, p.y - y]) };
}

/** Quadratic midpoint smoothing; explicit last segment preserves the lifted endpoint. */
export function inkPath(points: readonly number[]): string {
  if (points.length < 4) return "";
  let path = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    path += ` Q ${points[i]} ${points[i + 1]} ${(points[i] + points[i + 2]) / 2} ${(points[i + 1] + points[i + 3]) / 2}`;
  }
  return `${path} L ${points[points.length - 2]} ${points[points.length - 1]}`;
}
