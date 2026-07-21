/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@organize/shared",
    "@organize/plugin-sdk",
    "@organize/plugin-ai-summary",
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
};

export default nextConfig;
