import { createClient } from "@/lib/supabase/server";
import { tiptapJsonToHtml } from "@/lib/export/tiptap-to-html";
import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";

// 公开分享页：匿名可访问，不走 (main) 路由组
// RLS 已在 006 迁移放行（带有效 token 的 share 对应资源可读）
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const supabase = await createClient();
  const { data: share } = await supabase
    .from("shares")
    .select("resource_type, resource_id")
    .eq("token", token)
    .eq("is_public", true)
    .maybeSingle();

  if (!share) return { title: "分享不存在" };

  const table = share.resource_type === "note" ? "notes" : "reading_items";
  const { data: resource } = await supabase
    .from(table)
    .select("title")
    .eq("id", share.resource_id)
    .maybeSingle();

  return {
    title: resource?.title || "分享内容",
    description: "通过 Organize 分享的内容",
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  // 查 share 记录（anon 可读公开的）
  const { data: share } = await supabase
    .from("shares")
    .select("id, resource_type, resource_id, expires_at, created_at")
    .eq("token", token)
    .eq("is_public", true)
    .maybeSingle();

  if (!share) {
    notFound();
  }

  // 检查过期
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
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
    const { data: note } = await supabase
      .from("notes")
      .select("title, content")
      .eq("id", share.resource_id)
      .maybeSingle();

    if (!note) {
      return (
        <Shell>
          <div className="text-center py-20">
            <h1 className="text-2xl font-bold mb-2">笔记已被删除</h1>
          </div>
        </Shell>
      );
    }

    const html = tiptapJsonToHtml(note.content as Record<string, unknown> | null);
    return (
      <Shell>
        <article className="organize-editor max-w-3xl mx-auto">
          {note.title && <h1 className="text-3xl font-bold mb-6">{note.title}</h1>}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </Shell>
    );
  }

  // reading_item
  const { data: item } = await supabase
    .from("reading_items")
    .select("title, content, excerpt, cover_image, url")
    .eq("id", share.resource_id)
    .maybeSingle();

  if (!item) {
    return (
      <Shell>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-2">文章已被删除</h1>
        </div>
      </Shell>
    );
  }

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
            />
          </div>
        )}
        <h1 className="text-3xl font-bold mb-4">{item.title || "无标题"}</h1>
        {item.excerpt && <p className="text-lg text-muted-foreground mb-6">{item.excerpt}</p>}
        <div
          className="prose prose-zinc dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: item.content || "" }}
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
