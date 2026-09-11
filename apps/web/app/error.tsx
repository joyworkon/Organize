"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * App Router 段级错误边界（P2-01）：渲染/数据错误不再白屏，
 * 用户可重试；错误被抛给上层（生产环境可接监控上报）。
 * A02：动态 chunk 加载失败（部署新版本后旧资源下线）单独给出
 * 「应用已更新」文案——刷新即恢复，草稿有本地自动保存兜底。
 */

/** 跨版本 chunk 失败的浏览器错误消息形态（Chrome/Safari/Firefox） */
const STALE_CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

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

  const isStaleVersion = STALE_CHUNK_ERROR.test(error.message);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        {isStaleVersion ? (
          <>
            <h2 className="text-lg font-semibold">应用已更新</h2>
            <p className="text-sm text-muted-foreground">
              检测到新版本已发布，当前页面的部分旧资源已下线。刷新即可恢复；
              笔记草稿已自动保存到本地，不会丢失。
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => window.location.reload()}>刷新页面</Button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
