import type { PluginDataAccess } from "@organize/plugin-sdk";

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
