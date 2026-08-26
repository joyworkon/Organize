import type { ComponentType } from "react";
import type { EditorBlockContext, Note, ReadingItem, ScrapeResult } from "@organize/shared";

// ============ 应用事件契约 ============

/**
 * 应用事件表：事件名 → payload 类型。
 * 插件通过 ctx.onAppEvent 订阅，宿主应用在对应行为发生时发射。
 */
export interface AppEventMap {
  /** 笔记内容保存成功（含自动保存） */
  "note:saved": { noteId: string; title: string };
  /** 笔记被打开 */
  "note:opened": { noteId: string; title: string };
  /** 新条目进入阅读库 */
  "reading:item-created": { itemId: string; url: string; title: string };
  /** 阅读状态流转（unread / reading / read） */
  "reading:status-changed": { itemId: string; from: string; to: string };
  /** 任务被标记完成 */
  "task:completed": { taskId: string; title: string };
}

export type AppEventName = keyof AppEventMap;

// ============ 命令贡献 ============

/** 插件贡献的命令：出现在命令面板（Cmd/Ctrl+K），可被用户搜索执行 */
export interface CommandContribution {
  /** 插件内唯一 id；宿主会加上插件 id 前缀避免冲突 */
  id: string;
  /** 展示标题，如「为当前条目生成摘要」 */
  title: string;
  /** 分组标签，缺省用插件名 */
  section?: string;
  /** emoji 图标 */
  icon?: string;
  /** 展示用快捷键文本（仅展示） */
  shortcut?: string;
  /** 搜索别名 */
  keywords?: string[];
  handler: (ctx: PluginContext) => void | Promise<void>;
}

// ============ 斜杠命令贡献（编辑器 "/" 菜单） ============

/** 编辑器文档片段（与 TipTap JSONContent 结构兼容，SDK 不直接依赖 @tiptap/core） */
export type PluginEditorContent = Record<string, unknown>;

/**
 * 受限编辑器操作面：插件斜杠命令执行时由宿主注入。
 * 只暴露「读当前块文本 / 替换当前块 / 在块后插入」三个安全操作，
 * 插件拿不到 Editor 实例，无法越权操作文档其他位置。
 */
export interface PluginEditorBridge {
  /** 当前块纯文本 */
  getBlockText: () => string;
  /** 用给定内容替换当前块（原块文本会尽量带入新块） */
  replaceBlock: (content: PluginEditorContent) => void;
  /** 在当前块之后插入内容 */
  insertAfter: (content: PluginEditorContent | PluginEditorContent[]) => void;
}

/** 插件贡献的斜杠命令：出现在编辑器 "/" 菜单的「插件」分组 */
export interface SlashCommandContribution {
  /** 插件内唯一 id；宿主会加上插件 id 前缀避免冲突 */
  id: string;
  /** 展示标题，如「生成本周复盘」 */
  label: string;
  /** 副标题描述 */
  description?: string;
  /** emoji 图标 */
  icon?: string;
  /** 搜索别名 */
  keywords?: string[];
  handler: (
    editor: PluginEditorBridge,
    ctx: PluginContext
  ) => void | Promise<void>;
}

// ============ 数据访问面（data facade） ============

/**
 * 宿主数据访问面：插件读写数据 / 调用内部服务的唯一通道。
 * 插件禁止直接 fetch / 访问 window——宿主（web / 桌面 / 移动）各自实现
 * 本接口并注入，插件代码跨端零改动。
 */
export interface PluginDataAccess {
  /**
   * 调用宿主 AI 服务（遵循用户在设置里配置的 AI 提供商）。
   * 失败时抛错，插件自行 catch 并 notify。
   */
  askAI: (request: { instruction: string; text: string }) => Promise<string>;
}

// ============ 插件上下文 ============

export interface PluginContext {
  /** 当前用户 ID */
  userId: string;
  /** 获取当前阅读条目（位于阅读详情页时有值，其余场景为 null） */
  getCurrentItem: () => ReadingItem | null;
  /** 获取插件配置 */
  getConfig: <T = Record<string, unknown>>() => T;
  /** 更新插件配置 */
  setConfig: (config: Record<string, unknown>) => Promise<void>;
  /** 显示通知 */
  notify: (message: string, type?: "info" | "success" | "error") => void;
  /** 当前笔记，仅在 note-block 场景可用 */
  getCurrentNote?: () => Pick<Note, "id" | "title" | "content"> | null;
  /** 当前编辑器块，仅在 note-block 场景可用 */
  getCurrentBlock?: () => EditorBlockContext | null;
  /**
   * 注册命令到命令面板。插件停用时自动注销（Obsidian register* 语义），
   * 无需插件自行清理。
   */
  registerCommand?: (command: CommandContribution) => void;
  /**
   * 注册斜杠命令到编辑器 "/" 菜单。插件停用时自动注销，无需插件自行清理。
   */
  registerSlashCommand?: (command: SlashCommandContribution) => void;
  /** 订阅应用事件。插件停用时自动退订，无需插件自行清理。 */
  onAppEvent?: <K extends AppEventName>(
    event: K,
    handler: (payload: AppEventMap[K]) => void
  ) => void;
  /** 宿主数据访问面（未注入的宿主环境下为 undefined，插件需做降级） */
  data?: PluginDataAccess;
}

// ============ 插件配置 ============

export interface PluginConfig {
  [key: string]: unknown;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "textarea";
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
}

// ============ 扩展点类型 ============

/** 工具栏操作按钮 */
export interface ToolbarActionExtension {
  type: "toolbar-action";
  id: string;
  label: string;
  icon: string;
  handler: (ctx: PluginContext) => void | Promise<void>;
  supports?: ("reading" | "note-block")[];
}

/** 侧边栏面板 */
export interface SidebarPanelExtension {
  type: "sidebar-panel";
  id: string;
  label: string;
  icon: string;
  component: ComponentType<{ ctx: PluginContext }>;
}

/** 内容处理器（抓取后处理） */
export interface ContentProcessorExtension {
  type: "content-processor";
  id: string;
  label: string;
  handler: (
    result: ScrapeResult,
    ctx: PluginContext
  ) => ScrapeResult | Promise<ScrapeResult>;
}

/** AI 操作 */
export interface AIActionExtension {
  type: "ai-action";
  id: string;
  label: string;
  icon: string;
  handler: (text: string, ctx: PluginContext) => string | Promise<string>;
  supports?: ("reading" | "note-block")[];
}

export type PluginExtension =
  | ToolbarActionExtension
  | SidebarPanelExtension
  | ContentProcessorExtension
  | AIActionExtension;

// ============ 插件主接口 ============

export interface OrganizePlugin {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 插件描述 */
  description: string;
  /** 作者 */
  author?: string;
  /** 插件图标 (emoji 或 URL) */
  icon?: string;
  /** 配置字段定义 */
  configFields?: PluginConfigField[];
  /** 插件提供的功能扩展 */
  extensions: PluginExtension[];
  /** 安装时调用 */
  onInstall?: (config: PluginConfig) => Promise<void>;
  /** 激活时调用 */
  onActivate?: (ctx: PluginContext) => void;
  /** 停用时调用 */
  onDeactivate?: () => void;
}

// ============ 辅助函数 ============

export function definePlugin(plugin: OrganizePlugin): OrganizePlugin {
  return plugin;
}
