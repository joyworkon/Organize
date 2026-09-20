/** 无外部网页的导入物料使用稳定 URN；不是可点击的外部 URL，也不送去抓取。 */
export const MATERIAL_URI_PREFIX = "urn:organize:material:";
export function isMaterialUrl(url: string): boolean { return url.startsWith(MATERIAL_URI_PREFIX); }
export function readingSourceLabel(url: string): string {
  if (isMaterialUrl(url)) return "导入物料";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
