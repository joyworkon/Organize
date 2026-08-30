/**
 * Next.js 服务启动钩子（P2-02）：应用启动时校验环境变量。
 * 生产环境出现致命配置直接抛错拒绝启动（红线：生产禁 mock）；
 * 开发环境仅打印，不阻塞调试。
 */
export async function register() {
  // 动态读取：该文件在构建产物中以模块形式存在，env 只在运行时可见
  const { validateEnv, hasFatal } = await import("./lib/env");
  const issues = validateEnv(process.env);
  for (const issue of issues) {
    const line = `[env] ${issue.level.toUpperCase()} ${issue.key}: ${issue.message}`;
    if (issue.level === "fatal") console.error(line);
    else console.warn(line);
  }
  if (hasFatal(issues)) {
    throw new Error(
      "环境变量配置存在致命错误（见上方 [env] fatal 日志），拒绝启动。"
    );
  }
}
