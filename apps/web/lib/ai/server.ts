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

function config() {
  const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY;
  const textModel = process.env.AI_TEXT_MODEL;
  const transcriptionModel = process.env.AI_TRANSCRIPTION_MODEL;
  if (!baseUrl || !apiKey) throw new Error("AI 服务尚未配置");
  return { baseUrl, apiKey, textModel, transcriptionModel };
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

export async function askAI(instruction: string, text: string) {
  const { baseUrl, apiKey, textModel } = config();
  if (!textModel) throw new Error("缺少 AI_TEXT_MODEL 配置");
  const response = await request(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: textModel,
      messages: [
        { role: "system", content: "你是笔记编辑助手。只输出可直接放入笔记的正文，不要解释过程。" },
        { role: "user", content: `任务：${instruction}\n\n原文：\n${text.slice(0, 20_000)}` },
      ],
      temperature: 0.3,
    }),
  });
  const data = await response.json();
  const result = data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim()) throw new Error("AI 未返回有效内容");
  return result.trim();
}

export async function transcribeAudio(file: File) {
  if (file.size > MAX_AUDIO_BYTES) throw new Error("录音不能超过 25MB");
  const mime = file.type.split(";")[0];
  if (!ALLOWED_AUDIO.has(mime)) throw new Error("不支持该录音格式");
  const { baseUrl, apiKey, transcriptionModel } = config();
  if (!transcriptionModel) throw new Error("缺少 AI_TRANSCRIPTION_MODEL 配置");
  const form = new FormData();
  form.append("file", file, file.name || "recording.webm");
  form.append("model", transcriptionModel);
  form.append("response_format", "json");
  const response = await request(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
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

export async function summarizeTranscript(transcript: string): Promise<AIBlockResult> {
  const raw = await askAI(
    "将转写整理为严格 JSON：{\"summary\":\"简洁摘要\",\"keyPoints\":[\"要点\"],\"actionItems\":[\"待办\"]}。不要输出 JSON 以外的内容。",
    transcript
  );
  return parseJsonResult(raw, transcript);
}
