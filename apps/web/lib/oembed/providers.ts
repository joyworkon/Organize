/**
 * oEmbed 提供方白名单 + iframe 模板。
 * 纯函数，可在 Node 环境单测，不依赖网络。
 */

export interface EmbedResult {
  provider: string;
  html: string;
  title?: string;
  /** 沙箱权限：默认仅 allow-scripts，地图等需 allow-popups */
  sandbox?: string;
}

interface ProviderRule {
  id: string;
  /** 匹配 URL 的正则（大小写不敏感） */
  pattern: RegExp;
  /** 从 URL 抽取嵌入所需参数（如视频 id） */
  build: (url: URL, match: readonly string[]) => EmbedResult | null;
}

const SANDBOX_SCRIPTS = "allow-scripts allow-same-origin allow-popups allow-presentation";

/** 从各种 YouTube URL 形态抽取 11 位视频 id。 */
function youtubeId(url: URL): string | null {
  // youtu.be/<id>、watch?v=<id>、embed/<id>、shorts/<id>、live/<id>
  const m =
    url.pathname.match(/^(?:\/embed\/|\/shorts\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/) ||
    url.searchParams.get("v");
  if (url.hostname.includes("youtu.be")) {
    const id = url.pathname.slice(1, 12);
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  }
  if (m && typeof m === "string") return m;
  if (Array.isArray(m) && m[1]) return m[1];
  return null;
}

const PROVIDERS: ProviderRule[] = [
  {
    id: "youtube",
    pattern: /(?:^|\.)(youtube\.com|youtu\.be)$/i,
    build: (url) => {
      const id = youtubeId(url);
      if (!id) return null;
      const start = url.searchParams.get("t") || url.searchParams.get("start");
      const qs = start ? `?start=${encodeURIComponent(start)}&` : "?";
      return {
        provider: "YouTube",
        title: "YouTube 视频",
        sandbox: SANDBOX_SCRIPTS,
        html: `<iframe src="https://www.youtube-nocookie.com/embed/${id}${qs}rel=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`,
      };
    },
  },
  {
    id: "bilibili",
    pattern: /(?:^|\.)bilibili\.com$/i,
    build: (url) => {
      const m = url.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
      if (!m) return null;
      const bvid = m[1];
      const page = url.searchParams.get("p");
      const pageParam = page ? `&page=${encodeURIComponent(page)}` : "";
      return {
        provider: "Bilibili",
        title: "哔哩哔哩视频",
        sandbox: SANDBOX_SCRIPTS,
        html: `<iframe src="//player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&high_quality=1${pageParam}" frameborder="0" allow="fullscreen" allowfullscreen loading="lazy"></iframe>`,
      };
    },
  },
  {
    id: "vimeo",
    pattern: /(?:^|\.)vimeo\.com$/i,
    build: (url) => {
      const m = url.pathname.match(/\/(\d+)/);
      if (!m) return null;
      return {
        provider: "Vimeo",
        title: "Vimeo 视频",
        sandbox: SANDBOX_SCRIPTS,
        html: `<iframe src="https://player.vimeo.com/video/${m[1]}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`,
      };
    },
  },
  {
    id: "twitter",
    pattern: /(?:^|\.)(twitter|x)\.com$/i,
    build: (url) => {
      const m = url.pathname.match(/\/(\w+)\/status\/(\d+)/);
      if (!m) return null;
      return {
        provider: "Twitter / X",
        title: "推文",
        sandbox: "allow-scripts allow-same-origin allow-popups",
        html: `<blockquote class="twitter-tweet" data-conversation="none"><a href="${url.href}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`,
      };
    },
  },
  {
    id: "github-gist",
    pattern: /gist\.github\.com$/i,
    build: (url) => {
      const m = url.pathname.match(/\/([\w-]+)\/([\w]+)/);
      if (!m) return null;
      return {
        provider: "GitHub Gist",
        title: "GitHub Gist",
        sandbox: "allow-scripts allow-same-origin",
        html: `<script src="https://gist.github.com/${m[1]}/${m[2]}.js"></script>`,
      };
    },
  },
  {
    id: "google-maps",
    pattern: /(?:^|\.)(google\.[\w.]+|maps\.app\.goo\.gl)$/i,
    build: (url) => {
      // 仅处理明确的 maps 路径或 q 参数
      if (!url.pathname.includes("/maps") && !url.searchParams.get("q")) return null;
      const q = url.searchParams.get("q") || url.pathname.replace("/maps/", "").replace("place/", "");
      if (!q) return null;
      return {
        provider: "Google Maps",
        title: "Google 地图",
        sandbox: "allow-scripts allow-same-origin allow-popups",
        html: `<iframe src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed" frameborder="0" loading="lazy"></iframe>`,
      };
    },
  },
];

/** 判断 URL 是否匹配某个内置 provider，返回对应的嵌入结果。 */
export function matchProvider(rawUrl: string): EmbedResult | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  for (const provider of PROVIDERS) {
    if (provider.pattern.test(url.hostname)) {
      const result = provider.build(url, url.hostname.match(provider.pattern) ?? []);
      if (result) return result;
    }
  }
  return null;
}

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
