import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIBlockResult } from "@organize/shared";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const ALLOWED_AUDIO = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
]);

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  textModel?: string;
  transcriptionModel?: string;
}

interface AISettingsRow {
  base_url: string;
  api_key: string;
  text_model: string | null;
  transcription_model: string | null;
}

/**
 * 解析当前用户的 AI 配置：优先读「设置 › AI 服务」里存到 user_ai_settings 的值，
 * 未配置时回退到环境变量（AI_BASE_URL / AI_API_KEY / AI_TEXT_MODEL / AI_TRANSCRIPTION_MODEL）。
 * 所有 AI 功能（笔记问 AI、AI 速记、标签推荐）共用这一份配置。
 */
export async function getAIConfig(supabase: SupabaseClient, userId: string): Promise<AIConfig> {
  const { data } = await supabase
    .from("user_ai_settings")
    .select("base_url, api_key, text_model, transcription_model")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as AISettingsRow | null;

  const baseUrl = (row?.base_url || process.env.AI_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = row?.api_key || process.env.AI_API_KEY || "";
  if (!baseUrl || !apiKey) {
    throw new Error("AI 服务尚未配置，请到「设置 › AI 服务」填写 API 地址和密钥");
  }
  return {
    baseUrl,
    apiKey,
    textModel: row?.text_model || process.env.AI_TEXT_MODEL,
    transcriptionModel: row?.transcription_model || process.env.AI_TRANSCRIPTION_MODEL,
  };
}

async function request(url: string, init: RequestInit, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`AI 请求失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** 通用聊天补全：所有走 OpenAI 兼容协议的文本 AI 功能复用。 */
export async function chatCompletion(config: AIConfig, system: string, user: string) {
  if (!config.textModel) throw new Error("缺少文本模型配置，请到「设置 › AI 服务」填写模型名称");
  const response = await request(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.textModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    }),
  });
  const data = await response.json();
  const result = data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim()) throw new Error("AI 未返回有效内容");
  return result.trim();
}

export async function askAI(config: AIConfig, instruction: string, text: string) {
  return chatCompletion(
    config,
    "你是笔记编辑助手。只输出可直接放入笔记的正文，不要解释过程。",
    `任务：${instruction}\n\n原文：\n${text.slice(0, 20_000)}`
  );
}

export async function transcribeAudio(config: AIConfig, file: File) {
  if (file.size > MAX_AUDIO_BYTES) throw new Error("录音不能超过 25MB");
  const mime = file.type.split(";")[0];
  if (!ALLOWED_AUDIO.has(mime)) throw new Error("不支持该录音格式");
  if (!config.transcriptionModel) throw new Error("缺少转写模型配置，请到「设置 › AI 服务」填写转写模型");
  const form = new FormData();
  form.append("file", file, file.name || "recording.webm");
  form.append("model", config.transcriptionModel);
  form.append("response_format", "json");
  const response = await request(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  }, 180_000);
  const data = await response.json();
  const transcript = data.text || data.transcript;
  if (typeof transcript !== "string" || !transcript.trim()) throw new Error("转写服务未返回文本");
  return transcript.trim();
}

function parseJsonResult(raw: string, transcript: string): AIBlockResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return {
        summary: String(parsed.summary || "").trim() || raw,
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String).filter(Boolean).slice(0, 12) : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String).filter(Boolean).slice(0, 12) : [],
        transcript,
      };
    } catch {
      // 兼容不严格遵循 JSON 的模型，降级为纯摘要。
    }
  }
  return { summary: raw.trim(), keyPoints: [], actionItems: [], transcript };
}

export async function summarizeTranscript(config: AIConfig, transcript: string): Promise<AIBlockResult> {
  const raw = await askAI(
    config,
    "将转写整理为严格 JSON：{\"summary\":\"简洁摘要\",\"keyPoints\":[\"要点\"],\"actionItems\":[\"待办\"]}。不要输出 JSON 以外的内容。",
    transcript
  );
  return parseJsonResult(raw, transcript);
}
