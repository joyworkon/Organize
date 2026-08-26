import type { ComponentType } from "react";

/**
 * 命令注册表（Obsidian 风格「一切皆命令」的核心）。
 *
 * 应用内可执行动作（导航、快速新建、插件贡献的功能）统一注册为命令，
 * 命令面板（Cmd/Ctrl+K）从这里取列表渲染；后续快捷键绑定、菜单入口
 * 也消费同一份注册表。
 *
 * 纯 TS 实现，不依赖 React / Supabase，可单测。注册返回 disposer，
 * 调用方（如插件生命周期）负责在停用时注销。
 */

export interface CommandDefinition {
  /** 全局唯一 id；插件命令建议带插件前缀（bootstrap 会自动加） */
  id: string;
  /** 展示标题，如「新建笔记」 */
  title: string;
  /** 分组标签：命令面板按 section 分组展示（如「导航」「AI 摘要」） */
  section?: string;
  /** React 图标组件或 emoji 字符串 */
  icon?: ComponentType<{ className?: string }> | string;
  /** 展示用快捷键文本（如 "G H"）；仅展示，绑定由快捷键系统负责 */
  shortcut?: string;
  /** 搜索别名（命令面板匹配用） */
  keywords?: string[];
  run: () => void | Promise<void>;
}

type Listener = () => void;

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private listeners = new Set<Listener>();
  /** 缓存列表引用：useSyncExternalStore 的 getSnapshot 必须在两次变更间返回同一引用 */
  private cachedList: CommandDefinition[] = [];

  register(command: CommandDefinition): () => void {
    this.commands.set(command.id, command);
    this.refresh();
    return () => this.unregister(command.id);
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) this.refresh();
  }

  get(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  list(): CommandDefinition[] {
    return this.cachedList;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private refresh(): void {
    this.cachedList = Array.from(this.commands.values());
    this.listeners.forEach((listener) => listener());
  }
}

/** 应用级单例；测试里自行 new CommandRegistry() 隔离 */
export const commandRegistry = new CommandRegistry();
