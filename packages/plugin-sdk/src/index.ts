import type { ComponentType } from "react";
import type { ReadingItem, ScrapeResult } from "@organize/shared";

// ============ 插件上下文 ============

export interface PluginContext {
  /** 当前用户 ID */
  userId: string;
  /** 获取当前阅读条目 */
  getCurrentItem: () => ReadingItem | null;
  /** 获取插件配置 */
  getConfig: <T = Record<string, unknown>>() => T;
  /** 更新插件配置 */
  setConfig: (config: Record<string, unknown>) => Promise<void>;
  /** 显示通知 */
  notify: (message: string, type?: "info" | "success" | "error") => void;
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
