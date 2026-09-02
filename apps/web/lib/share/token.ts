// 分享/邀请共用的 token 生成（22 字符 url-safe，约 128 bit 熵）。
// 原 /api/share 内联实现，071 邀请令牌复用同一算法，抽到这里共用。
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
