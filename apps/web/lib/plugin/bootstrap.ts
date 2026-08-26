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

import type { OrganizePlugin, PluginContext, PluginDataAccess } from "@organize/plugin-sdk";
import type { PluginRecord } from "@organize/shared";
import { commandRegistry, type CommandRegistry } from "@/lib/commands/registry";
import { appEvents, type AppEventBus } from "@/lib/plugin/events";
import { getCurrentReadingItem } from "@/lib/plugin/current-context";
import { slashCommandRegistry, type SlashCommandRegistry } from "@/lib/plugin/slash-commands";

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
  /** 记录插件激活期注册的清理函数（停用时统一回收）；缺省则不跟踪 */
  trackRegistration?: (pluginId: string, dispose: () => void) => void;
  notify: BootstrapNotify;
  /** 测试注入用；默认应用级单例 */
  commands?: CommandRegistry;
  /** 测试注入用；默认应用级单例 */
  events?: AppEventBus;
  /** 测试注入用；默认应用级单例 */
  slashCommands?: SlashCommandRegistry;
  /** 宿主数据访问面；不注入则插件 ctx.data 为 undefined（插件需自行降级） */
  dataAccess?: PluginDataAccess;
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
  const {
    plugins,
    userId,
    fetchImpl,
    registerPlugin,
    activatePlugin,
    trackRegistration,
    notify,
    commands = commandRegistry,
    events = appEvents,
    slashCommands = slashCommandRegistry,
    dataAccess,
  } = deps;

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
      getCurrentItem: () => getCurrentReadingItem(),
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
      registerCommand: (command) => {
        // 命令 id 加插件前缀避免跨插件冲突；section 缺省归到插件名分组
        const dispose = commands.register({
          id: `${plugin.id}:${command.id}`,
          title: command.title,
          section: command.section || plugin.name,
          icon: command.icon,
          shortcut: command.shortcut,
          keywords: command.keywords,
          run: () => command.handler(ctx),
        });
        trackRegistration?.(plugin.id, dispose);
      },
      registerSlashCommand: (command) => {
        // 与命令面板同规则：id 加插件前缀避免跨插件冲突
        const dispose = slashCommands.register({
          id: `${plugin.id}:${command.id}`,
          pluginId: plugin.id,
          pluginName: plugin.name,
          command,
          ctx,
        });
        trackRegistration?.(plugin.id, dispose);
      },
      onAppEvent: (event, handler) => {
        const dispose = events.on(event, handler);
        trackRegistration?.(plugin.id, dispose);
      },
      data: dataAccess,
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
