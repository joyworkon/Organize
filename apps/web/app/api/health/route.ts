import { NextResponse } from "next/server";

/**
 * 健康检查（P2-01）：无鉴权轻量端点，供部署平台探活、
 * Playwright webServer 就绪探测与运行手册使用。
 * 故意不查数据库：探活只回答「应用进程活着」，数据库可用性由功能链路体现。
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    mock: process.env.NEXT_PUBLIC_MOCK_BACKEND === "true",
  });
}
