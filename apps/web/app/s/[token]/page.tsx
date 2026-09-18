import { tiptapJsonToHtml } from "@/lib/export/tiptap-to-html";
import { getPublicShare } from "@/lib/share/public-share";
import { parseSessionId, shareSessionCookieName } from "@/lib/share/session";
import { sanitizeContent } from "@/lib/sanitize/sanitize-html";
import PublicShareEditor from "@/components/share/public-share-editor";
import PublicShareGate from "@/components/share/public-share-gate";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * 读链接 + 本设备的会话凭证（082）。
 *
 * 会话 id 取自 httpOnly cookie（客户端 JS 读不到），随服务端渲染一起交给
 * 编辑器组件——编辑器必须拿它去和 collab-server 握手，否则握手会被
 * resolve_share_access 按「无会话证据」拒掉。
 */
async function loadShare(token: string) {
  const cookieStore = await cookies();
  const sessionId = parseSessionId(cookieStore.get(shareSessionCookieName(token))?.value);
  const share = await getPublicShare(token, { sessionId });
  return { share, sessionId };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const { share } = await loadShare(token);
  // 未认领时不回标题：标题也是内容的一部分，不该在名额确认前泄漏给预览爬虫
  if (share.state !== "active") return { title: "分享内容" };

  return {
    title: share.resource.title || "分享内容",
    description: "通过 Cairn 分享的内容",
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const { share, sessionId } = await loadShare(token);
  if (share.state === "missing") {
    notFound();
  }

  // 082 名额闸门：链接有效但本设备没有有效会话 → 只给「确认进入」，不给内容
  if (share.state === "claim_required") {
    return (
      <Shell>
        <PublicShareGate token={token} accessMode={share.access_mode} />
      </Shell>
    );
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
    // 072 可编辑公开链接：匿名实时协同编辑（mock / 未配 WS 时组件内降级只读）
    if (share.access_mode === "public_edit") {
      return (
        <Shell>
          <div className="mx-auto max-w-3xl">
            {share.resource.title && (
              <h1 className="mb-6 text-3xl font-bold">{share.resource.title}</h1>
            )}
            <PublicShareEditor
              token={token}
              noteId={share.resource.id}
              seedContent={share.resource.content}
              sessionId={sessionId}
            />
          </div>
        </Shell>
      );
    }
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
          <span className="font-semibold">Cairn</span>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            了解 Cairn →
          </Link>
        </div>
      </header>
      <main className="py-10 px-4">{children}</main>
    </div>
  );
}
