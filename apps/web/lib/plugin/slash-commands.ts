import type { PluginContext, SlashCommandContribution } from "@organize/plugin-sdk";

/**
 * 斜杠命令注册表：插件贡献的编辑器 "/" 菜单命令统一登记处。
 *
 * 与命令面板注册表（lib/commands/registry）同构但相互独立：
 * 斜杠命令执行时需要编辑器上下文（PluginEditorBridge），由编辑器菜单
 * 在执行点注入；命令面板命令则是全局无上下文动作。
 *
 * 纯 TS 实现，不依赖 React，可单测。注册返回 disposer，
 * 由插件生命周期（bootstrap → trackRegistration）负责停用时注销。
 */

export interface RegisteredSlashCommand {
  /** 全局唯一 id（已带插件前缀：pluginId:commandId） */
  id: string;
  /** 来源插件 id */
  pluginId: string;
  /** 来源插件名（菜单分组用） */
  pluginName: string;
  command: SlashCommandContribution;
  /** 执行时由 bootstrap 装配好的插件上下文 */
  ctx: PluginContext;
}

type Listener = () => void;

export class SlashCommandRegistry {
  private commands = new Map<string, RegisteredSlashCommand>();
  private listeners = new Set<Listener>();
  /** 缓存列表引用：useSyncExternalStore 的 getSnapshot 必须在两次变更间返回同一引用 */
  private cachedList: RegisteredSlashCommand[] = [];

  register(entry: RegisteredSlashCommand): () => void {
    this.commands.set(entry.id, entry);
    this.refresh();
    return () => this.unregister(entry.id);
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) this.refresh();
  }

  get(id: string): RegisteredSlashCommand | undefined {
    return this.commands.get(id);
  }

  list(): RegisteredSlashCommand[] {
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

/** 应用级单例；测试里自行 new SlashCommandRegistry() 隔离 */
export const slashCommandRegistry = new SlashCommandRegistry();
