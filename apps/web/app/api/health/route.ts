import { NextResponse } from "next/server";
import { validateEnv } from "@/lib/env";

/**
 * 健康检查（P2-01/P2-02）：无鉴权轻量端点，供部署平台探活、
 * Playwright webServer 就绪探测与运行手册使用。
 * 故意不查数据库：探活只回答「应用进程活着」，数据库可用性由功能链路体现。
 * P2-02 起附环境配置状态（warn 汇总），便于部署后一眼发现功能受限项。
 */
export async function GET() {
  const envIssues = validateEnv(process.env).filter((i) => i.level === "warn");
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    mock: process.env.NEXT_PUBLIC_MOCK_BACKEND === "true",
    envWarnings: envIssues.map((i) => ({ key: i.key, message: i.message })),
  });
}
