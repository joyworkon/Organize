/** 无外部网页的导入物料使用稳定 URN；不是可点击的外部 URL，也不送去抓取。 */
export const MATERIAL_URI_PREFIX = "urn:organize:material:";
/** 文件导入（阶段 D）的原件指纹 URN；同样不是外部 URL。 */
export const IMPORT_URI_PREFIX = "urn:organize:import:";
/** 合并整理稿（阶段 4）的稳定 URN：整理稿是独立文章，不回写来源。 */
export const DIGEST_URI_PREFIX = "urn:organize:digest:";

export function isMaterialUrl(url: string): boolean { return url.startsWith(MATERIAL_URI_PREFIX); }
export function isImportUrl(url: string): boolean { return url.startsWith(IMPORT_URI_PREFIX); }
export function isDigestUrl(url: string): boolean { return url.startsWith(DIGEST_URI_PREFIX); }

/** 内部 URN（物料 / 导入原件 / 整理稿）：外部链接行为（新窗口打开、原文按钮）对它们全部关闭。 */
export function isInternalUrn(url: string): boolean { return isMaterialUrl(url) || isImportUrl(url) || isDigestUrl(url); }

export function readingSourceLabel(url: string): string {
  if (isMaterialUrl(url)) return "导入物料";
  if (isImportUrl(url)) return "导入文件";
  if (isDigestUrl(url)) return "整理稿";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
