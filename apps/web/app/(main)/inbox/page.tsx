"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BatchImportPanel } from "@/components/inbox/batch-import-panel";
import { cn } from "@/lib/utils";
import { Link2, Loader2, Check, AlertCircle, Inbox } from "lucide-react";
import type { ScrapeResult } from "@organize/shared";
import { EmptyState } from "@/components/ui/empty-state";

type Mode = "single" | "batch";

export default function InboxPage() {
  const [mode, setMode] = useState<Mode>("single");

  // 单条模式状态
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSaved(false);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "抓取失败");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "抓取失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const { error: dbError } = await supabase.from("reading_items").insert({
        user_id: user.id,
        url: result.url,
        title: result.title,
        content: result.content,
        excerpt: result.excerpt,
        cover_image: result.cover_image,
        reading_status: "unread",
        reading_progress: 0,
      });
      if (dbError) throw dbError;
      setSaved(true);
      setUrl("");
      setTimeout(() => {
        setResult(null);
        setSaved(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleScrape();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6 px-2 sm:px-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">收集箱</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          粘贴链接，自动抓取内容并保存到你的阅读库
        </p>
      </div>

      {/* 单条 / 批量 切换 */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["single", "batch"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              mode === m
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "single" ? "单条导入" : "批量导入"}
          </button>
        ))}
      </div>

      {mode === "single" ? (
        <>
          {/* URL 输入区 */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="粘贴链接，如 https://example.com/article"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="pl-9"
                  />
                </div>
                <Button onClick={handleScrape} disabled={loading || !url.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "抓取"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {result && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">抓取预览</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.cover_image && (
                  <div className="relative w-full h-48 rounded-md overflow-hidden">
                    <Image
                      src={result.cover_image}
                      alt={result.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                )}

                <div>
                  <h3 className="font-semibold text-lg leading-tight">{result.title}</h3>
                  {result.site_name && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {result.site_name}
                      {result.author && ` · ${result.author}`}
                    </p>
                  )}
                </div>

                {result.excerpt && (
                  <p className="text-sm text-muted-foreground line-clamp-3">{result.excerpt}</p>
                )}

                <div className="flex gap-2 pt-2">
                  {saved ? (
                    <Button disabled className="gap-2 bg-green-600">
                      <Check className="h-4 w-4" />
                      已保存
                    </Button>
                  ) : (
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      保存到阅读库
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setResult(null);
                      setUrl("");
                    }}
                  >
                    取消
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {!result && !loading && !error && (
            <EmptyState
              icon={Inbox}
              title="收集箱是空的"
              description="粘贴链接或使用 Cmd+K 快速添加文章"
            />
          )}
        </>
      ) : (
        <>
          <BatchImportPanel
            onComplete={(success, failed) => {
              setBatchResult(`成功 ${success} 条${failed > 0 ? `，失败 ${failed} 条` : ""}`);
            }}
          />
          {batchResult && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm text-primary">
              <Check className="h-4 w-4 shrink-0" />
              {batchResult}
              <a href="/library" className="ml-auto underline text-xs">
                去阅读库查看
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
