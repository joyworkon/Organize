// 运行环境判定（集中一份，避免到处内联字符串比较）：
// mock 后端模式：.env.local 设 NEXT_PUBLIC_MOCK_BACKEND=true，
// 见 AGENTS.md「mock 后端模式」。
export function isMockBackend(): boolean {
  return process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";
}

/**
 * 环境变量启动校验（P2-02）。
 *
 * 在应用启动时（instrumentation.register）与 /api/health 中调用：
 * - 生产环境（NODE_ENV=production）出现致命配置 → register 直接 throw 拒绝启动，
 *   错误配置不允许带着侥幸上线；
 * - 开发环境只 console 提示，不阻塞本地调试。
 *
 * 红线：生产环境禁止 NEXT_PUBLIC_MOCK_BACKEND=true（会用假数据假成功欺骗真实用户）。
 */

export interface EnvIssue {
  key: string;
  message: string;
  /** fatal：生产环境拒绝启动；warn：功能受限但不拦启动 */
  level: "fatal" | "warn";
}

export function validateEnv(env: {
  NODE_ENV?: string;
  NEXT_PUBLIC_MOCK_BACKEND?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CRON_SECRET?: string;
}): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const isProd = env.NODE_ENV === "production";

  if (env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    if (isProd) {
      issues.push({
        key: "NEXT_PUBLIC_MOCK_BACKEND",
        message: "生产环境禁止 NEXT_PUBLIC_MOCK_BACKEND=true（mock 会用假数据假成功）",
        level: "fatal",
      });
    } else {
      issues.push({
        key: "NEXT_PUBLIC_MOCK_BACKEND",
        message: "mock 后端模式：仅限本地开发使用，不得部署到生产",
        level: "warn",
      });
    }
  }

  // mock 模式不需要真实 Supabase 键；真实模式缺键是致命的
  const needClientKeys = !isProd || env.NEXT_PUBLIC_MOCK_BACKEND !== "true";
  if (needClientKeys) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      issues.push({
        key: "NEXT_PUBLIC_SUPABASE_URL",
        message: "缺少 Supabase URL",
        level: isProd ? "fatal" : "warn",
      });
    }
    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      issues.push({
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        message: "缺少 Supabase anon key",
        level: isProd ? "fatal" : "warn",
      });
    }
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push({
      key: "SUPABASE_SERVICE_ROLE_KEY",
      message: "缺少 service role key：账号删除与提醒 Cron 将不可用",
      level: "warn",
    });
  }

  if (!env.CRON_SECRET) {
    issues.push({
      key: "CRON_SECRET",
      message: "缺少 CRON_SECRET：提醒 Cron 无法调用（调度侧会告警）",
      level: "warn",
    });
  }

  return issues;
}

export function hasFatal(issues: EnvIssue[]): boolean {
  return issues.some((issue) => issue.level === "fatal");
}

