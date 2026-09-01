/**
 * 托盘/全局快捷键导航事件载荷校验：Rust 侧 emit("navigate", path) 的载荷
 * 只允许应用内相对路径（以单个 "/" 开头），拒绝外链、协议相对路径与控制
 * 字符——事件通道对任意前端代码可达，校验保证主窗口不会被导到非应用地址。
 */
export function sanitizeNavigatePath(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  if (!payload.startsWith("/") || payload.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f]/.test(payload)) return null;
  return payload;
}
