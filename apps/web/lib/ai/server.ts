import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIBlockResult } from "@organize/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMockBackend } from "@/lib/env";
import {
  AIRequestError,
  buildMultipartBody,
  maskApiKey,
  safeAIRequest,
} from "./safe-request";

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
 * 读取当前用户的 AI 配置：优先「设置 › AI 服务」存到 user_ai_settings 的值，
 * 未配置时回退环境变量（AI_BASE_URL / AI_API_KEY / AI_TEXT_MODEL / AI_TRANSCRIPTION_MODEL）。
 * P0-03：api_key 列已对客户端角色收回 SELECT，这里经 service_role（真实后端）
 * 或 mock client（mock 后端模式）读取，完整密钥不再出服务端。
 */
export async function getAIConfig(_supabase: SupabaseClient, userId: string): Promise<AIConfig> {
  let row: AISettingsRow | null = null;
  if (isMockBackend()) {
    const { data } = await _supabase
      .from("user_ai_settings")
      .select("base_url, api_key, text_model, transcription_model")
      .eq("user_id", userId)
      .maybeSingle();
    row = (data as AISettingsRow | null) ?? null;
  } else {
    const admin = createAdminClient();
    if (!admin) throw new Error("AI 服务未配置（缺少服务端凭据）");
    const { data, error } = await admin
      .from("user_ai_settings")
      .select("base_url, api_key, text_model, transcription_model")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error("AI 配置读取失败");
    row = (data as AISettingsRow | null) ?? null;
  }

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

/** 供设置页读取的展示态：密钥只回掩码，完整密钥不出服务端 */
export async function getAISettingsView(_supabase: SupabaseClient, userId: string) {
  let row: AISettingsRow | null = null;
  if (isMockBackend()) {
    const { data } = await _supabase
      .from("user_ai_settings")
      .select("base_url, api_key, text_model, transcription_model")
      .eq("user_id", userId)
      .maybeSingle();
    row = (data as AISettingsRow | null) ?? null;
  } else {
    const admin = createAdminClient();
    if (!admin) return { configured: false, base_url: "", text_model: "", transcription_model: "", api_key_masked: "", has_key: false };
    const { data } = await admin
      .from("user_ai_settings")
      .select("base_url, api_key, text_model, transcription_model")
      .eq("user_id", userId)
      .maybeSingle();
    row = (data as AISettingsRow | null) ?? null;
  }
  return {
    configured: !!row,
    base_url: row?.base_url || "",
    text_model: row?.text_model || "",
    transcription_model: row?.transcription_model || "",
    api_key_masked: row?.api_key ? maskApiKey(row.api_key) : "",
    has_key: !!row?.api_key,
  };
}

async function request(url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: Buffer | string }, timeoutMs = 90_000) {
  try {
    const response = await safeAIRequest(url, { ...init, timeoutMs });
    if (response.status < 200 || response.status >= 300) {
      // P0-03：错误详情不得回显密钥（恶意端点可能在响应里回显 Authorization）
      const detail = redactSecret(response.text(), init.headers.Authorization ?? "");
      throw new AIRequestError(
        "HTTP_ERROR",
        `AI 请求失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`,
        response.status
      );
    }
    return response;
  } catch (error) {
    if (error instanceof AIRequestError) {
      // 同上：对上层透出的消息统一脱敏
      throw new AIRequestError(error.code, redactSecret(error.message, init.headers.Authorization ?? ""), error.statusCode);
    }
    throw error;
  }
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  const bare = secret.replace(/^Bearer\s+/i, "");
  let result = text;
  if (secret && text.includes(secret)) result = result.split(secret).join("***");
  if (bare && result.includes(bare)) result = result.split(bare).join("***");
  return result;
}

/** 通用聊天补全：所有走 OpenAI 兼容协议的文本 AI 功能复用。 */
export async function chatCompletion(config: AIConfig, system: string, user: string) {
  if (!config.textModel) throw new Error("缺少文本模型配置，请到「设置 › AI 服务」填写模型名称");
  const response = await request(
    `${config.baseUrl}/chat/completions`,
    {
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
    }
  );
  const data = JSON.parse(response.text());
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
  const { contentType, body } = await buildMultipartBody(file, {
    model: config.transcriptionModel,
    response_format: "json",
  });
  const response = await request(
    `${config.baseUrl}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": contentType },
      body,
    },
    180_000
  );
  const data = JSON.parse(response.text());
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
