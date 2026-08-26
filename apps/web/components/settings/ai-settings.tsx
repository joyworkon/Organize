"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Bot, Loader2 } from "lucide-react";

interface AISettingsForm {
  base_url: string;
  api_key: string;
  text_model: string;
  transcription_model: string;
}

const EMPTY_FORM: AISettingsForm = { base_url: "", api_key: "", text_model: "", transcription_model: "" };

/**
 * 「设置 › AI 服务」：用户级 OpenAI 兼容接口配置，存 user_ai_settings 表。
 * 一份配置全模块共用——笔记「问 AI / AI 速记」、笔记与阅读库的标签智能推荐。
 */
export function AISettingsSection() {
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<AISettingsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setLoading(false); return; }
      const { data } = await supabase
        .from("user_ai_settings")
        .select("base_url, api_key, text_model, transcription_model")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setForm({
          base_url: data.base_url || "",
          api_key: data.api_key || "",
          text_model: data.text_model || "",
          transcription_model: data.transcription_model || "",
        });
        setHasExisting(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const update = (key: keyof AISettingsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    if (!form.base_url.trim() || !form.api_key.trim()) {
      toast({ title: "请填写完整", description: "API 地址和 API 密钥为必填项", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const { error } = await supabase.from("user_ai_settings").upsert({
        user_id: user.id,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        text_model: form.text_model.trim() || null,
        transcription_model: form.transcription_model.trim() || null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setHasExisting(true);
      toast({ title: "已保存", description: "AI 功能已启用：笔记问 AI / AI 速记 / 标签智能推荐" });
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const { error } = await supabase.from("user_ai_settings").delete().eq("user_id", user.id);
      if (error) throw error;
      setForm(EMPTY_FORM);
      setHasExisting(false);
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
              placeholder="sk-..."
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
            {hasExisting && (
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
