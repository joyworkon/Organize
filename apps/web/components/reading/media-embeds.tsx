"use client";

import { useMemo } from "react";
import { Clapperboard, Film, Music } from "lucide-react";
import { matchProvider } from "@/lib/oembed/providers";
import {
  extractMediaUrlsFromContent,
  detectDirectMedia,
  MAX_MEDIA_LINKS,
} from "@/lib/extension/media";

/**
 * 阅读详情页的「本页媒体」区块：把条目正文与页面 URL 中的视频/音频链接
 * 升级为可在线预览的播放器（YouTube / Bilibili / Vimeo 走 oEmbed 白名单
 * iframe，直链媒体用原生 video/audio）。无法预览的媒体仍以正文中的
 * 普通链接呈现，这里不重复渲染。无媒体时整块不渲染。
 */

interface MediaPreview {
  url: string;
  kind: "embed" | "video" | "audio";
  html?: string;
  sandbox?: string;
  provider?: string;
}

// 安全约束与编辑器嵌入块一致：srcDoc 嵌入禁止 allow-same-origin，
// 渲染时强制剔除（即使上游配置里带了）。
const DEFAULT_SANDBOX = "allow-scripts allow-popups allow-presentation";

function cleanSandbox(raw: string | undefined): string {
  return (
    raw?.replace(/(^|\s)allow-same-origin(\s|$)/g, " ").trim() || DEFAULT_SANDBOX
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function MediaEmbeds({ contentHtml, pageUrl }: { contentHtml: string; pageUrl: string }) {
  const items = useMemo<MediaPreview[]>(() => {
    const candidates = [pageUrl, ...extractMediaUrlsFromContent(contentHtml)];
    const seen = new Set<string>();
    const out: MediaPreview[] = [];
    for (const url of candidates) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const embed = matchProvider(url);
      if (
        embed &&
        (embed.provider === "YouTube" ||
          embed.provider === "Bilibili" ||
          embed.provider === "Vimeo")
      ) {
        out.push({
          url,
          kind: "embed",
          html: embed.html,
          sandbox: embed.sandbox,
          provider: embed.provider,
        });
      } else {
        const direct = detectDirectMedia(url);
        if (direct) {
          out.push({ url, kind: direct, provider: direct === "video" ? "视频" : "音频" });
        }
      }
      if (out.length >= MAX_MEDIA_LINKS) break;
    }
    return out;
  }, [contentHtml, pageUrl]);

  if (items.length === 0) return null;

  return (
    <section className="mt-10 rounded-lg border bg-muted/30 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Clapperboard className="h-4 w-4" />
        本页媒体
      </h2>
      <div className="space-y-4">
        {items.map((item) => (
          <figure key={item.url} className="space-y-1.5">
            {item.kind === "embed" ? (
              <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
                <iframe
                  title={`${item.provider ?? "嵌入"}播放器`}
                  srcDoc={item.html}
                  sandbox={cleanSandbox(item.sandbox)}
                  referrerPolicy="no-referrer"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            ) : item.kind === "video" ? (
              <video
                controls
                preload="metadata"
                src={item.url}
                className="aspect-video w-full rounded-md border bg-black"
              />
            ) : (
              <audio controls preload="metadata" src={item.url} className="w-full" />
            )}
            <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {item.kind === "audio" ? (
                <Music className="h-3 w-3 shrink-0" />
              ) : (
                <Film className="h-3 w-3 shrink-0" />
              )}
              <span>{item.provider ?? (item.kind === "audio" ? "音频" : "视频")}</span>
              <span>·</span>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-foreground"
              >
                {hostOf(item.url)}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
