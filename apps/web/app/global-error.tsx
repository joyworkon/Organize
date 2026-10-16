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
    try {
      const theme = localStorage.getItem("organize-theme");
      document.documentElement.dataset.errorTheme = theme === "light" || theme === "dark" ? theme : "system";
    } catch { /* Root recovery still works when storage is unavailable. */ }
  }, []);

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
      <body className="global-error-shell">
        <style>{`
          .global-error-shell { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #fff; color: #202020; font: 14px/1.6 system-ui, sans-serif; color-scheme: light; --error-focus: #202020; }
          .global-error-shell > div { text-align: center; max-width: 420px; padding: 24px; }
          .global-error-shell h2 { font-size: 20px; line-height: 28px; font-weight: 600; }
          .global-error-shell p { color: #666; }
          .global-error-shell button { min-height: 44px; padding: 8px 20px; border-radius: 8px; border: 0; background: #202020; color: #fff; font: inherit; cursor: pointer; }
          .global-error-shell button:focus-visible { outline: 2px solid var(--error-focus); outline-offset: 3px; }
          html[data-error-theme="dark"] .global-error-shell { background: #191919; color: #eee; color-scheme: dark; --error-focus: #eee; }
          html[data-error-theme="dark"] .global-error-shell p { color: #a3a3a3; }
          html[data-error-theme="dark"] .global-error-shell button { background: #eee; color: #191919; }
          @media (prefers-color-scheme: dark) {
            html:not([data-error-theme="light"]) .global-error-shell { background: #191919; color: #eee; color-scheme: dark; --error-focus: #eee; }
            html:not([data-error-theme="light"]) .global-error-shell p { color: #a3a3a3; }
            html:not([data-error-theme="light"]) .global-error-shell button { background: #eee; color: #191919; }
          }
        `}</style>
        <div>
          <h2>应用发生了严重错误</h2>
          <p>
            {error.digest ? `追踪码 ${error.digest} · ` : ""}请刷新页面重试。
          </p>
          <button onClick={reset}>
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
