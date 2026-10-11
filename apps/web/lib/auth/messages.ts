/** Supabase Auth 常见英文错误 → 中文提示（未知错误保留原文，便于排查） */
const AUTH_ERROR_MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "邮箱或密码不正确"],
  [/email not confirmed/i, "邮箱尚未确认，请先点击确认邮件中的链接"],
  [/user already registered|already been registered/i, "该邮箱已注册，请直接登录"],
  [/password should be at least/i, "密码至少 6 位"],
  [/unable to validate email address|invalid email/i, "邮箱格式不正确"],
  [/rate limit|too many requests|security purposes/i, "操作太频繁，请稍后再试"],
  [/failed to fetch|network/i, "网络连接失败，请检查网络后重试"],
];

export function localizeAuthError(message: string | null | undefined): string {
  const text = (message || "").trim();
  if (!text) return "操作失败，请重试";
  for (const [pattern, zh] of AUTH_ERROR_MAP) {
    if (pattern.test(text)) return zh;
  }
  return text;
}
