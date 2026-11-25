/**
 * 全站安全响应头。
 *
 * CSP 以「仅上报」下发：编辑器依赖内联脚本与样式、沙箱 iframe（srcDoc）和任意来源的
 * 文章图片，未经实测直接强制会拦坏功能。违规经 /api/csp-report 落日志，
 * 收齐真实来源后再逐条收紧并切到强制模式——在那之前这里只能出现 Report-Only 变体。
 */
function buildContentSecurityPolicyReportOnly() {
  const connect = ["'self'"];
  const frame = ["'self'"];
  const resource = ["https:"];
  // 浏览器端直连的后端只有 Supabase（REST / Auth / Storage / Realtime）与协作 WebSocket
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const { protocol, host } = new URL(supabaseUrl);
      const origin = `${protocol}//${host}`;
      connect.push(origin, `${protocol === "http:" ? "ws" : "wss"}://${host}`);
      // 任务附件预览是直连 Storage 的 iframe
      frame.push(origin);
      // 本地 / CI 的 Storage 走 http，线上是 https
      if (protocol === "http:") resource.push(origin);
    } catch {
      // 值不是合法 URL 时构建环境会另行报错，这里只是不把它写进策略
    }
  }
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (collabUrl) {
    try {
      connect.push(new URL(collabUrl).origin);
    } catch {
      // 同上
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    // 内联脚本/样式是已知的放松项：收齐报告后改用 nonce 再收紧
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${resource.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${frame.join(" ")}`,
    "worker-src 'self' blob:",
    `media-src 'self' blob: ${resource.join(" ")}`,
    "report-uri /api/csp-report",
  ].join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@organize/shared",
    "@organize/plugin-sdk",
    "@organize/plugin-ai-summary",
    "@organize/plugin-material-organizer",
    "@organize/plugin-tag-suggest",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: buildContentSecurityPolicyReportOnly(),
          },
        ],
      },
    ];
  },
  // pdfjs-dist 在 Node API route 用 legacy build + 禁用 worker 解析（任务 0 选型）；
  // 列入 serverExternalPackages 规避 Next.js 打包期 worker/asset 解析问题
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
