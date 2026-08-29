"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { collectReadingItem, type CollectResult } from "@/lib/reading/collect";
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

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "duplicate" | "error">("idle");
  const [title, setTitle] = useState("");
  const [linkOnly, setLinkOnly] = useState(false);

  useEffect(() => {
    // 从 URL 参数获取分享的链接（text 参数可能是「看看这篇 https://…」形态，服务内会规范化提取）
    const sharedUrl = searchParams.get("url") || searchParams.get("text") || "";
    if (sharedUrl) {
      void handleSave(sharedUrl);
    }

    // 监听 Capacitor App 的 share 事件（仅在移动端环境）
    if (typeof window !== "undefined" && (window as any).Capacitor) {
      try {
        const capApp = (window as any).Capacitor.Plugins?.App;
        if (capApp) {
          capApp.addListener("appUrlOpen", (event: any) => {
            const sharedUrl = event.url;
            if (sharedUrl) {
              void handleSave(sharedUrl);
            }
          });
        }
      } catch {
        // 非 Capacitor 环境，忽略
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave 非 memoized，加入会触发重渲染循环；此 effect 按设计只在 url 变化时跑
  }, [searchParams]);

  const handleSave = async (sharedUrl: string) => {
    setStatus("saving");
    // 收集语义统一走 collectReadingItem：规范化、抓取（失败仅存链接）、去重、事件
    const result: CollectResult = await collectReadingItem(sharedUrl);
    if (result.status === "error") {
      setStatus("error");
      return;
    }
    setTitle(result.title || sharedUrl);
    setLinkOnly(result.status === "saved-link-only");
    setStatus(result.status === "duplicate" ? "duplicate" : "saved");
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
              <Check className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium">已保存到稍后读</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{title}</p>
              {linkOnly && (
                <p className="text-xs text-amber-600">正文抓取失败，仅存链接</p>
              )}
              <Button size="sm" onClick={() => router.push("/library")}>
                查看稍后读
              </Button>
            </div>
          )}

          {status === "duplicate" && (
            <div className="flex flex-col items-center gap-2">
              <Check className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium">该链接已在稍后读中</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{title}</p>
              <Button size="sm" onClick={() => router.push("/library")}>
                查看稍后读
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">保存失败</p>
              <Button size="sm" variant="outline" onClick={() => router.push("/library")}>
                手动添加
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
