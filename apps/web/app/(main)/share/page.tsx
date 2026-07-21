"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check, Share2 } from "lucide-react";

export default function ShareTargetPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <ShareContent />
    </Suspense>
  );
}

function ShareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [title, setTitle] = useState("");

  useEffect(() => {
    // 从 URL 参数获取分享的链接
    const sharedUrl = searchParams.get("url") || searchParams.get("text") || "";
    if (sharedUrl) {
      setUrl(sharedUrl);
      handleSave(sharedUrl);
    }

    // 监听 Capacitor App 的 share 事件（仅在移动端环境）
    if (typeof window !== "undefined" && (window as any).Capacitor) {
      try {
        const capApp = (window as any).Capacitor.Plugins?.App;
        if (capApp) {
          capApp.addListener("appUrlOpen", (event: any) => {
            const sharedUrl = event.url;
            if (sharedUrl) {
              setUrl(sharedUrl);
              handleSave(sharedUrl);
            }
          });
        }
      } catch {
        // 非 Capacitor 环境，忽略
      }
    }
  }, [searchParams]);

  const handleSave = async (sharedUrl: string) => {
    setStatus("saving");
    try {
      // 先抓取内容
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sharedUrl }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setTitle(data.title || sharedUrl);

      // 保存到阅读库
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("未登录");

      const { error } = await supabase.from("reading_items").insert({
        user_id: user.id,
        url: data.url,
        title: data.title,
        content: data.content,
        excerpt: data.excerpt,
        cover_image: data.cover_image,
        reading_status: "unread",
        reading_progress: 0,
      });

      if (error) throw error;
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Share2 className="h-8 w-8 mx-auto mb-2 text-primary" />
          <CardTitle className="text-lg">分享到 Organize</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "idle" && (
            <p className="text-sm text-muted-foreground">
              等待接收分享内容...
            </p>
          )}

          {status === "saving" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在保存...</p>
            </div>
          )}

          {status === "saved" && (
            <div className="flex flex-col items-center gap-2">
              <Check className="h-6 w-6 text-green-500" />
              <p className="text-sm font-medium">已保存到阅读库</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{title}</p>
              <Button size="sm" onClick={() => router.push("/library")}>
                查看阅读库
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">保存失败</p>
              <Button size="sm" variant="outline" onClick={() => router.push("/inbox")}>
                手动添加
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
