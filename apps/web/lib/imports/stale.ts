/**
 * 导入中断恢复的判定（阶段 1）。
 *
 * 导入没有后台 worker：uploading/parsing 状态只可能由一个在途 POST /api/imports
 * 请求推进（状态机：建行 uploading → 原件入桶 → parsing → 解析 → saved/failed，
 * 全部发生在请求内）。因此行 updated_at 超过阈值仍未离开进行中状态，唯一的
 * 解释是拥有它的请求已死亡（客户端中断 / 网络断 / 服务重启）——此时安全规则：
 *   - 标记 failed（错误信息明示可重试），绝不丢弃已上传的原件（storage_path 保留）；
 *   - 重试原地重跑：原件 upsert 幂等、正文 URN 内容指纹去重幂等，不产生重复资料。
 * 阈值取 10 分钟：单批预算有界（≤6 文件 / ≤20MB / 解析输出 ≤10 万字符），
 * 慢网络上传与解析的正常耗时远小于该值；阈值内不误伤，超阈值必然已死。
 *
 * 回收是惰性的：GET /api/imports（恢复列表）与 POST /api/imports（同键重试）
 * 在读到 stale 行时执行回收，无需定时器。
 */

/** 进行中状态（uploading/parsing）被判定为中断的阈值 */
export const IMPORT_STALE_THRESHOLD_MS = 10 * 60 * 1000;

/** 回收时写入行的错误信息（用户可操作：可重试、不重复） */
export const INTERRUPTED_ERROR_MESSAGE = "导入中断：请求未完成，请重试（不会产生重复资料）";

/** 行是否已超过中断阈值（仅对 uploading/parsing 状态的行调用；终态行传入也会返回 true，调用方负责限定状态） */
export function isImportRowStale(
  updatedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!updatedAt) return false;
  const time = Date.parse(updatedAt);
  if (Number.isNaN(time)) return false;
  return now - time >= IMPORT_STALE_THRESHOLD_MS;
}
