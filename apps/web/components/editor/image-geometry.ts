/** Image layout math is independent of editor state and DOM. */
export const MIN_IMAGE_WIDTH = 96;
export const IMAGE_PRESETS = [null, 50, 75, 100] as const;
export type ImagePreset = typeof IMAGE_PRESETS[number];
export type Point = { x: number; y: number };
export type ImageSize = { width: number; height: number };
export type ImageTransform = Point & { scale: number };

export function clampWidth(width: number, maximum: number) {
  const max = Math.max(1, Math.floor(maximum));
  return Math.round(Math.min(max, Math.max(Math.min(MIN_IMAGE_WIDTH, max), width)));
}
export function presetWidth(preset: ImagePreset, maximum: number) {
  return preset === null ? null : clampWidth(maximum * preset / 100, maximum);
}
export function currentPreset(width: number | null, maximum: number): ImagePreset | undefined {
  if (width === null) return null;
  return IMAGE_PRESETS.find((preset) => preset !== null && Math.abs(presetWidth(preset, maximum)! - width) <= 1);
}
export function keyboardWidth(width: number, key: string, shift: boolean, maximum: number) {
  if (key === "Home") return clampWidth(0, maximum);
  if (key === "End") return clampWidth(maximum, maximum);
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return clampWidth(width + (key === "ArrowRight" ? 1 : -1) * (shift ? 64 : 16), maximum);
}
export function draggedWidth(width: number, delta: number, side: "left" | "right", maximum: number) {
  return clampWidth(width + delta * (side === "left" ? -1 : 1), maximum);
}
export function fitScale(image: ImageSize, viewport: ImageSize) {
  return Math.min(1, viewport.width / Math.max(1, image.width), viewport.height / Math.max(1, image.height));
}
export function constrainTransform(value: ImageTransform, image: ImageSize, viewport: ImageSize): ImageTransform {
  const limitX = Math.max(0, (image.width * value.scale - viewport.width) / 2);
  const limitY = Math.max(0, (image.height * value.scale - viewport.height) / 2);
  return { scale: value.scale, x: Math.min(limitX, Math.max(-limitX, value.x)), y: Math.min(limitY, Math.max(-limitY, value.y)) };
}
/** Keep the image point under the cursor/pinch midpoint while changing scale. */
export function zoomTransform(value: ImageTransform, scale: number, origin: Point, image: ImageSize, viewport: ImageSize) {
  const fit = fitScale(image, viewport);
  const next = Math.max(Math.min(fit, 0.1), Math.min(8, scale));
  const ratio = next / value.scale;
  return constrainTransform({ scale: next, x: origin.x - (origin.x - value.x) * ratio, y: origin.y - (origin.y - value.y) * ratio }, image, viewport);
}
export function pinchTransform(value: ImageTransform, start: [Point, Point], end: [Point, Point], image: ImageSize, viewport: ImageSize) {
  const mid = (points: [Point, Point]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points: [Point, Point]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const a = mid(start), b = mid(end);
  const zoomed = zoomTransform(value, value.scale * distance(end) / Math.max(1, distance(start)), a, image, viewport);
  return constrainTransform({ ...zoomed, x: zoomed.x + b.x - a.x, y: zoomed.y + b.y - a.y }, image, viewport);
}
