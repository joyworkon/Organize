// 运行环境判定（集中一份，避免到处内联字符串比较）：
// mock 后端模式：.env.local 设 NEXT_PUBLIC_MOCK_BACKEND=true，
// 见 AGENTS.md「mock 后端模式」。
export function isMockBackend(): boolean {
  return process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";
}
