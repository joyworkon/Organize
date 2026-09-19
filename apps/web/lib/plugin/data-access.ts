import type { PluginDataAccess } from "@organize/plugin-sdk";
import { validateMaterialRequest, validateMaterialResult } from "@/lib/materials/schema";
import { isMockBackend } from "@/lib/env";

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * Web 宿主的数据访问面实现。
 *
 * 桌面端（Tauri）/ 移动端（Capacitor）后续提供各自的实现：
 * 插件只面向 PluginDataAccess 编程，跨端零改动。
 */
export function createWebDataAccess(fetchImpl: FetchLike = fetch): PluginDataAccess {
  return {
    organizeMaterials: async (request) => {
      validateMaterialRequest(request);
      if (isMockBackend()) throw new Error("演示模式不调用真实 AI，请连接后端并在设置中配置 AI 服务");
      const form = new FormData();
      request.files.forEach((file) => form.append("files", file));
      form.append("mode", request.mode);
      if (request.text) form.append("text", request.text);
      const response = await fetchImpl("/api/ai/materials", { method: "POST", body: form, signal: request.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `物料整理失败（${response.status}）`);
      return validateMaterialResult(data);
    },
    askAI: async ({ instruction, text }) => {
      const response = await fetchImpl("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, text }),
      });
      if (!response.ok) {
        throw new Error(`AI 服务请求失败（${response.status}）`);
      }
      const data = (await response.json()) as { text?: string };
      if (!data.text) {
        throw new Error("AI 服务未返回内容");
      }
      return data.text;
    },
  };
}
