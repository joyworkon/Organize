"use client";

import { useEffect } from "react";

/**
 * 全局错误边界（P2-01）：根布局级错误（含 root layout 自身）的最后防线。
 * 注意 global-error 渲染时会替换整个 <html>，必须自带 html/body 标签。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "global-error-boundary",
        digest: error.digest,
        message: error.message,
        ts: new Date().toISOString(),
      })
    );
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h2 style={{ fontSize: 18 }}>应用发生了严重错误</h2>
          <p style={{ color: "#666", fontSize: 14 }}>
            {error.digest ? `追踪码 ${error.digest} · ` : ""}请刷新页面重试。
          </p>
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #ccc",
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
