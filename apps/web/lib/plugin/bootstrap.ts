/**
 * 插件启动编排（纯函数，可测试）。
 *
 * 职责：注册插件 → 读取配置记录 → 补建缺失记录 → 激活已启用插件。
 * 所有失败路径都通过 notify 给出用户可见的非阻塞提示：
 * - 配置读取失败：插件仍注册但不激活，提示后直接返回（避免对不可用后端连发 N 个创建请求）；
 * - 记录创建失败：该插件不激活，结束时按插件名聚合提示；
 * - setConfig 保存失败：toast 提示并向插件抛出统一文案（不透出原始数据库错误）。
 *
 * 注：提示文案刻意不包含接口返回的原始 error（可能带约束/RLS 细节），统一用固定话术。
 */

import type { OrganizePlugin, PluginContext } from "@organize/plugin-sdk";
import type { PluginRecord } from "@organize/shared";

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type BootstrapNotify = (
  message: string,
  variant: "default" | "destructive"
) => void;

export interface BootstrapDeps {
  plugins: OrganizePlugin[];
  userId: string;
  fetchImpl: FetchLike;
  registerPlugin: (plugin: OrganizePlugin) => void;
  activatePlugin: (id: string, ctx: PluginContext) => void;
  notify: BootstrapNotify;
}

export interface BootstrapResult {
  /** 已注册插件数 */
  registered: number;
  /** 已激活插件数 */
  activated: number;
  /** 配置读取失败（此时所有插件仅注册未激活） */
  configLoadFailed: boolean;
  /** 记录创建失败的插件名 */
  failedCreations: string[];
}

export const MSG_CONFIG_LOAD_FAILED = "插件配置读取失败，插件功能暂不可用";
export const MSG_CONFIG_SAVE_FAILED = "插件配置保存失败";

export function buildCreateFailedMessage(names: string[]): string {
  return `插件初始化失败：${names.join("、")}`;
}

/** 从插件配置字段提取默认配置 */
export function pluginDefaultConfig(plugin: OrganizePlugin): Record<string, unknown> {
  return Object.fromEntries(
    (plugin.configFields || [])
      .filter((field) => field.default !== undefined)
      .map((field) => [field.key, field.default])
  );
}

async function fetchJson(
  fetchImpl: FetchLike,
  input: string,
  init?: RequestInit
): Promise<unknown | null> {
  const response = await fetchImpl(input, init);
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function bootstrapPlugins(deps: BootstrapDeps): Promise<BootstrapResult> {
  const { plugins, userId, fetchImpl, registerPlugin, activatePlugin, notify } = deps;

  // 1. 全部注册（store 内部对重复 id 去重）
  for (const plugin of plugins) {
    registerPlugin(plugin);
  }

  const result: BootstrapResult = {
    registered: plugins.length,
    activated: 0,
    configLoadFailed: false,
    failedCreations: [],
  };

  if (plugins.length === 0) return result;

  // 2. 读取插件配置记录
  let records: PluginRecord[] = [];
  try {
    const response = await fetchImpl("/api/plugins", { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    records = await response.json();
  } catch {
    // 数据库不可用：插件已注册但一律不激活（也不逐个尝试创建，避免连发失败请求）
    result.configLoadFailed = true;
    notify(MSG_CONFIG_LOAD_FAILED, "default");
    return result;
  }

  // 3. 逐个插件：已有记录则复用，否则创建；已启用则激活
  for (const plugin of plugins) {
    let record = records.find((item) => item.package_name === plugin.id);
    if (!record) {
      const created = await fetchJson(fetchImpl, "/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: plugin.name,
          package_name: plugin.id,
          version: plugin.version,
          config: pluginDefaultConfig(plugin),
        }),
      });
      if (!created) {
        result.failedCreations.push(plugin.name);
        continue;
      }
      record = created as PluginRecord;
    }
    if (!record.enabled) continue;

    let currentConfig = record.config || {};
    const recordId = record.id;
    const ctx: PluginContext = {
      userId,
      getCurrentItem: () => null,
      getConfig: <T = Record<string, unknown>>() => currentConfig as T,
      setConfig: async (config) => {
        const updated = await fetchJson(fetchImpl, `/api/plugins/${recordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        });
        if (!updated) {
          notify(MSG_CONFIG_SAVE_FAILED, "destructive");
          throw new Error(MSG_CONFIG_SAVE_FAILED);
        }
        currentConfig = (updated as PluginRecord).config || {};
      },
      notify: (message, type = "info") =>
        notify(message, type === "error" ? "destructive" : "default"),
    };
    activatePlugin(plugin.id, ctx);
    result.activated += 1;
  }

  // 4. 聚合提示创建失败的插件
  if (result.failedCreations.length > 0) {
    notify(buildCreateFailedMessage(result.failedCreations), "default");
  }

  return result;
}
