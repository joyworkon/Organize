import { tiptapJsonToHtml } from "@/lib/export/tiptap-to-html";
import { getPublicShare } from "@/lib/share/public-share";
import { sanitizeContent } from "@/lib/sanitize/sanitize-html";
import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await getPublicShare(token);
  if (share.state !== "active") return { title: "分享不存在" };

  return {
    title: share.resource.title || "分享内容",
    description: "通过 Organize 分享的内容",
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const share = await getPublicShare(token);
  if (share.state === "missing") {
    notFound();
  }

  if (share.state === "expired") {
    return (
      <Shell>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-2">分享已过期</h1>
          <p className="text-muted-foreground">请联系分享者获取新的链接</p>
        </div>
      </Shell>
    );
  }

  if (share.resource_type === "note") {
    const html = sanitizeContent(
      tiptapJsonToHtml(share.resource.content)
    );
    return (
      <Shell>
        <article className="organize-editor max-w-3xl mx-auto">
          {share.resource.title && (
            <h1 className="text-3xl font-bold mb-6">{share.resource.title}</h1>
          )}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </Shell>
    );
  }

  const item = share.resource;

  return (
    <Shell>
      <article className="max-w-3xl mx-auto">
        {item.cover_image && (
          <div className="relative w-full h-64 rounded-lg overflow-hidden mb-6">
            <Image
              src={item.cover_image}
              alt=""
              fill
              className="object-cover"
              unoptimized
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <h1 className="text-3xl font-bold mb-4">{item.title || "无标题"}</h1>
        {item.excerpt && <p className="text-lg text-muted-foreground mb-6">{item.excerpt}</p>}
        <div
          className="prose prose-zinc dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeContent(item.content || "") }}
        />
        <div className="mt-8 pt-4 border-t text-sm text-muted-foreground">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            查看原文 →
          </a>
        </div>
      </article>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-semibold">Organize</span>
          <a href="/" className="text-sm text-muted-foreground hover:underline">
            了解 Organize →
          </a>
        </div>
      </header>
      <main className="py-10 px-4">{children}</main>
    </div>
  );
}
