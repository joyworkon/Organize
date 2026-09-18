import type { MetadataRoute } from "next";

/**
 * 全站禁止抓取。
 *
 * 这是个私有笔记应用：除 `/s/<token>` 分享页外，所有页面都要求登录
 * （middleware 会重定向到 /login）。唯一对外可达的内容就是分享链接，
 * 而分享链接**恰恰不该被搜索引擎收录**——否则「只发给一个人」的链接一旦被
 * 贴到任何公开的地方，内容就可能进搜索索引，这正是「防扩散」要挡的事。
 *
 * 配套两处（缺一不可）：
 *   1. `isAuthExemptPath` 必须放行 /robots.txt——否则 middleware 会把它 307 到
 *      /login，爬虫拿不到这份声明，等于没有 robots.txt（默认放开抓取）。
 *   2. 分享页的 generateMetadata 另声明 `robots: { index: false }`——robots.txt
 *      只是约定，不守约的爬虫仍在抓；页面级 noindex 是第二道。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
