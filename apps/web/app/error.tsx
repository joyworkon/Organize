"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * App Router 段级错误边界（P2-01）：渲染/数据错误不再白屏，
 * 用户可重试；错误被抛给上层（生产环境可接监控上报）。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 单行 JSON 结构化输出，与 lib/api/logger 口径一致
    console.error(
      JSON.stringify({
        level: "error",
        scope: "app-error-boundary",
        digest: error.digest,
        message: error.message,
        ts: new Date().toISOString(),
      })
    );
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">页面出了点问题</h2>
        <p className="text-sm text-muted-foreground">
          发生了意外错误{error.digest ? `（追踪码 ${error.digest}）` : ""}，可以尝试重试。
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>重试</Button>
          <Button variant="outline" onClick={() => window.location.assign("/")}>
            回到首页
          </Button>
        </div>
      </div>
    </div>
  );
}
