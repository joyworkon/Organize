import type { AppEventMap } from "@organize/plugin-sdk";

/**
 * 应用事件总线（Obsidian workspace.on 的对应物）。
 *
 * 插件通过 ctx.onAppEvent 订阅应用行为（笔记保存、阅读条目创建、
 * 任务完成……）做自动化；事件名与 payload 契约定义在 plugin-sdk，
 * 这里是运行时实现。单个 handler 抛错不会影响其他订阅者与发射方。
 */

export type AppEventName = keyof AppEventMap;
export type AppEventHandler<K extends AppEventName> = (payload: AppEventMap[K]) => void;

export class AppEventBus {
  private handlers = new Map<AppEventName, Set<AppEventHandler<AppEventName>>>();

  on<K extends AppEventName>(name: K, handler: AppEventHandler<K>): () => void {
    let bucket = this.handlers.get(name);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(name, bucket);
    }
    const entry = handler as AppEventHandler<AppEventName>;
    bucket.add(entry);
    return () => {
      bucket.delete(entry);
      if (bucket.size === 0) this.handlers.delete(name);
    };
  }

  emit<K extends AppEventName>(name: K, payload: AppEventMap[K]): void {
    const bucket = this.handlers.get(name);
    if (!bucket) return;
    bucket.forEach((handler) => {
      try {
        handler(payload as AppEventMap[AppEventName]);
      } catch (error) {
        // 隔离插件异常：一个订阅者崩了不影响其他订阅者和业务代码
        console.error(`[app-events] handler for "${name}" failed:`, error);
      }
    });
  }

  /** 当前订阅数（测试与调试用） */
  listenerCount(name?: AppEventName): number {
    if (name) return this.handlers.get(name)?.size ?? 0;
    let total = 0;
    this.handlers.forEach((bucket) => {
      total += bucket.size;
    });
    return total;
  }
}

/** 应用级单例；测试里自行 new AppEventBus() 隔离 */
export const appEvents = new AppEventBus();
