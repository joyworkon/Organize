"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2, Loader2, Check, AlertCircle } from "lucide-react";
import type { ScrapeResult } from "@organize/shared";

export default function InboxPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

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

      if (!res.ok) {
        throw new Error(data.error || "抓取失败");
      }

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
    if (e.key === "Enter") {
      handleScrape();
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">收集箱</h1>
        <p className="text-muted-foreground mt-1">
          粘贴链接，自动抓取内容并保存到你的阅读库
        </p>
      </div>

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
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "抓取"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* 抓取预览 */}
      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">抓取预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.cover_image && (
              <img
                src={result.cover_image}
                alt={result.title}
                className="w-full h-48 object-cover rounded-md"
              />
            )}

            <div>
              <h3 className="font-semibold text-lg leading-tight">
                {result.title}
              </h3>
              {result.site_name && (
                <p className="text-sm text-muted-foreground mt-1">
                  {result.site_name}
                  {result.author && ` · ${result.author}`}
                </p>
              )}
            </div>

            {result.excerpt && (
              <p className="text-sm text-muted-foreground line-clamp-3">
                {result.excerpt}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              {saved ? (
                <Button disabled className="gap-2 bg-green-600">
                  <Check className="h-4 w-4" />
                  已保存
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
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

      {/* 空状态提示 */}
      {!result && !loading && !error && (
        <div className="text-center py-12 text-muted-foreground">
          <Link2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>粘贴任意文章链接，自动提取标题、正文和封面</p>
          <p className="text-sm mt-2">支持大多数新闻、博客、技术文章网站</p>
        </div>
      )}
    </div>
  );
}
