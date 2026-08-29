"use client";

// 「设置 › AI 服务」：用户级 OpenAI 兼容接口配置。
// P0-03：读写一律走 /api/ai/settings（服务端受控）——完整 API 密钥不再下发浏览器，
// 页面只显示掩码；输入新密钥即更换，留空保持不变。
// base_url 在保存时由服务端做 SSRF 校验（localhost / 内网 / 元数据地址等一律拒绝）。

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Bot, Loader2 } from "lucide-react";

interface AISettingsView {
  configured: boolean;
  base_url: string;
  text_model: string;
  transcription_model: string;
  api_key_masked: string;
  has_key: boolean;
}

const EMPTY_VIEW: AISettingsView = {
  configured: false,
  base_url: "",
  text_model: "",
  transcription_model: "",
  api_key_masked: "",
  has_key: false,
};

export function AISettingsSection() {
  const [view, setView] = useState<AISettingsView>(EMPTY_VIEW);
  const [form, setForm] = useState({ base_url: "", api_key: "", text_model: "", transcription_model: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("加载失败");
        const data = (await res.json()) as AISettingsView;
        if (cancelled) return;
        setView({ ...EMPTY_VIEW, ...data });
        setForm({
          base_url: data.base_url || "",
          api_key: "",
          text_model: data.text_model || "",
          transcription_model: data.transcription_model || "",
        });
      } catch {
        if (!cancelled) toast({ title: "AI 设置加载失败", variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    if (!form.base_url.trim()) {
      toast({ title: "请填写完整", description: "API 地址为必填项", variant: "destructive" });
      return;
    }
    if (!view.has_key && !form.api_key.trim()) {
      toast({ title: "请填写完整", description: "API 密钥为必填项", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // api_key 留空 = 保持现有密钥不变（服务端只更新提供的值）
        body: JSON.stringify({
          base_url: form.base_url.trim(),
          api_key: form.api_key.trim() || undefined,
          text_model: form.text_model.trim(),
          transcription_model: form.transcription_model.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "保存失败");
      toast({ title: "已保存", description: "AI 功能已启用：笔记问 AI / AI 速记 / 标签智能推荐" });
      // 重新拉取展示态（掩码刷新）
      const refreshed = await fetch("/api/ai/settings", { cache: "no-store" });
      if (refreshed.ok) {
        const next = (await refreshed.json()) as AISettingsView;
        setView({ ...EMPTY_VIEW, ...next });
        setForm((prev) => ({ ...prev, api_key: "", base_url: next.base_url || prev.base_url }));
      }
    } catch (err) {
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/settings", { method: "DELETE" });
      if (!res.ok) throw new Error("清除失败");
      setView(EMPTY_VIEW);
      setForm({ base_url: "", api_key: "", text_model: "", transcription_model: "" });
      toast({ title: "已清除", description: "已删除 AI 配置" });
    } catch (err) {
      toast({
        title: "清除失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 border-b">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">AI 服务</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        配置 OpenAI 兼容接口后，一处配置全模块生效：笔记「问 AI」「AI 速记」、笔记与阅读库的「标签智能推荐」。
      </p>
      <details className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground">数据与安全说明（点开查看）</summary>
        <div className="mt-2 space-y-1.5">
          <p><strong className="text-foreground">问 AI</strong>：发送所选笔记文本（最多 2 万字符）和你的指令。</p>
          <p><strong className="text-foreground">AI 速记</strong>：发送录音音频（≤25MB，仅本次转写用完即弃）和转写出的文字。</p>
          <p><strong className="text-foreground">标签智能推荐</strong>：发送笔记或文章的标题与正文、你已有的标签名。</p>
          <p className="pt-1 border-t">以上内容经本站服务端转发到你配置的服务商，本站不留存 AI 处理结果；各功能均有限流（问 AI / 标签推荐 20 次/分钟，AI 速记 5 次/分钟）。标签推荐在 AI 不可用时自动降级为本地关键词模式。</p>
          <p><strong className="text-foreground">密钥安全</strong>：API 密钥仅保存在你的账户数据中，保存后页面只显示掩码，本站不会再把它下发到浏览器。</p>
          <p><strong className="text-foreground">地址安全</strong>：API 地址只允许公网 HTTP(S) 服务，localhost、内网与云元数据地址会被拒绝（防服务端请求伪造）。</p>
        </div>
      </details>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-base-url">API 地址</Label>
            <Input
              id="ai-base-url"
              placeholder="https://api.openai.com/v1"
              value={form.base_url}
              onChange={update("base_url")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-api-key">API 密钥</Label>
            <Input
              id="ai-api-key"
              type="password"
              placeholder={view.has_key ? `已配置（${view.api_key_masked}），输入新密钥可更换` : "sk-..."}
              value={form.api_key}
              onChange={update("api_key")}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ai-text-model">文本模型</Label>
              <Input
                id="ai-text-model"
                placeholder="gpt-4o-mini"
                value={form.text_model}
                onChange={update("text_model")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-transcription-model">转写模型（可选）</Label>
              <Input
                id="ai-transcription-model"
                placeholder="whisper-1"
                value={form.transcription_model}
                onChange={update("transcription_model")}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={save} disabled={saving} className="flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              保存配置
            </Button>
            {view.configured && (
              <Button variant="outline" onClick={clear} disabled={saving}>
                清除配置
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
