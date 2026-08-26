import { create } from "zustand";
import type { OrganizePlugin, PluginContext } from "@organize/plugin-sdk";

interface PluginState {
  plugins: OrganizePlugin[];
  activePlugins: Map<string, OrganizePlugin>;
  contexts: Map<string, PluginContext>;
  /** 插件在激活期间注册的清理函数（命令注销、事件退订……），停用时统一执行 */
  registrations: Map<string, Set<() => void>>;
  registerPlugin: (plugin: OrganizePlugin) => void;
  activatePlugin: (id: string, ctx: PluginContext) => void;
  deactivatePlugin: (id: string) => void;
  /** 记录一个插件激活期注册的清理函数；插件停用时自动调用（Obsidian register* 语义） */
  trackRegistration: (pluginId: string, dispose: () => void) => void;
  getExtensionsByType: <T extends string>(type: T) => any[];
  isPluginActive: (id: string) => boolean;
  getContext: (id: string) => PluginContext | undefined;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  activePlugins: new Map(),
  contexts: new Map(),
  registrations: new Map(),

  registerPlugin: (plugin) => {
    set((state) => {
      const exists = state.plugins.find((p) => p.id === plugin.id);
      if (exists) return state;
      return { plugins: [...state.plugins, plugin] };
    });
  },

  activatePlugin: (id, ctx) => {
    const { plugins } = get();
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin) return;

    plugin.onActivate?.(ctx);

    set((state) => {
      const newMap = new Map(state.activePlugins);
      newMap.set(id, plugin);
      const contexts = new Map(state.contexts);
      contexts.set(id, ctx);
      return { activePlugins: newMap, contexts };
    });
  },

  deactivatePlugin: (id) => {
    const { activePlugins } = get();
    const plugin = activePlugins.get(id);
    if (!plugin) return;

    plugin.onDeactivate?.();

    // 自动回收激活期注册的资源（命令、事件订阅……），
    // 即使 onDeactivate 没清理也不会泄漏
    const disposers = get().registrations.get(id);
    if (disposers) {
      disposers.forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          console.error(`[plugin-store] cleanup for "${id}" failed:`, error);
        }
      });
    }

    set((state) => {
      const newMap = new Map(state.activePlugins);
      newMap.delete(id);
      const contexts = new Map(state.contexts);
      contexts.delete(id);
      const registrations = new Map(state.registrations);
      registrations.delete(id);
      return { activePlugins: newMap, contexts, registrations };
    });
  },

  trackRegistration: (pluginId, dispose) => {
    set((state) => {
      const registrations = new Map(state.registrations);
      const bucket = new Set(registrations.get(pluginId) ?? []);
      bucket.add(dispose);
      registrations.set(pluginId, bucket);
      return { registrations };
    });
  },

  getExtensionsByType: (type) => {
    const { activePlugins } = get();
    const extensions: any[] = [];
    activePlugins.forEach((plugin) => {
      plugin.extensions
        .filter((ext) => ext.type === type)
        .forEach((ext) => extensions.push(ext));
    });
    return extensions;
  },

  isPluginActive: (id) => {
    return get().activePlugins.has(id);
  },
  getContext: (id) => get().contexts.get(id),
}));
