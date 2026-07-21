import { create } from "zustand";
import type { OrganizePlugin, PluginContext } from "@organize/plugin-sdk";

interface PluginState {
  plugins: OrganizePlugin[];
  activePlugins: Map<string, OrganizePlugin>;
  registerPlugin: (plugin: OrganizePlugin) => void;
  activatePlugin: (id: string, ctx: PluginContext) => void;
  deactivatePlugin: (id: string) => void;
  getExtensionsByType: <T extends string>(type: T) => any[];
  isPluginActive: (id: string) => boolean;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  activePlugins: new Map(),

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
      return { activePlugins: newMap };
    });
  },

  deactivatePlugin: (id) => {
    const { activePlugins } = get();
    const plugin = activePlugins.get(id);
    if (!plugin) return;

    plugin.onDeactivate?.();

    set((state) => {
      const newMap = new Map(state.activePlugins);
      newMap.delete(id);
      return { activePlugins: newMap };
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
}));
