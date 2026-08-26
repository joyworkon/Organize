import type { CapacitorConfig } from "@capacitor/cli";

// 移动端壳：与桌面端同一策略——加载远程 Web 应用，
// 前端代码与 Supabase 数据全平台共用，保证视觉与数据一致。
const config: CapacitorConfig = {
  appId: "com.organize.app",
  appName: "Organize",
  // 仅为 cap sync 提供占位产物；运行时由 server.url 接管加载远程应用
  webDir: "www",
  server: {
    url: "https://organize-web.vercel.app",
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      splashFullScreen: true,
      splashImmersive: true,
    },
    Share: {
      displayTickerText: "分享到 Organize",
    },
  },
};

export default config;
