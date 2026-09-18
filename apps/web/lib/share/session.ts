/**
 * 公开链接的会话凭证（082 名额闸门）。
 *
 * 服务端一行 share_sessions 是事实源；cookie 只是**这台设备的提货单**。cookie 丢了
 * = 得重新抢剩余名额（没名额就被拒，且 share_access_log 留痕）——刻意不做「长期
 * cookie 免重验」，那会把锁的有效期从「握手前」放宽到 cookie 生命周期。
 *
 * cookie 名按 token 派生（而非全局同名）：同一浏览器可能同时持有多个分享链接的
 * 会话，用同一个 cookie 名会互相覆盖。分享 token 是 url-safe base64
 * （`[A-Za-z0-9_-]{22}`），字符集与 cookie 名允许集兼容，可直接拼接。
 */
export const SHARE_SESSION_COOKIE_PREFIX = "cairn_ps_";

export function shareSessionCookieName(token: string): string {
  return `${SHARE_SESSION_COOKIE_PREFIX}${token}`;
}

/** cookie 里的值必须是 uuid 形状才当有效凭证往下传（防脏值灌进 RPC） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionId(value: string | undefined | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}
