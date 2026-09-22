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
  // pdfjs-dist 在 Node API route 用 legacy build + 禁用 worker 解析（任务 0 选型）；
  // 列入 serverExternalPackages 规避 Next.js 打包期 worker/asset 解析问题
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
