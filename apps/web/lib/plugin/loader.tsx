"use client";

import { useEffect } from "react";
import { usePluginStore } from "./store";
import type { PluginContext } from "@organize/plugin-sdk";

// 动态导入所有内置插件
// 在 monorepo 中，插件通过 transpilePackages 编译
async function loadBuiltinPlugins() {
  const plugins = [];

  try {
    const aiSummary = await import("@organize/plugin-ai-summary");
    plugins.push(aiSummary.default);
  } catch {
    // 插件未安装，跳过
  }

  try {
    const tagSuggest = await import("@organize/plugin-tag-suggest");
    plugins.push(tagSuggest.default);
  } catch {
    // 插件未安装，跳过
  }

  return plugins;
}

export function PluginLoader({ userId }: { userId: string }) {
  const { registerPlugin, activatePlugin } = usePluginStore();

  useEffect(() => {
    async function init() {
      const plugins = await loadBuiltinPlugins();

      const ctx: PluginContext = {
        userId,
        getCurrentItem: () => null,
        getConfig: () => ({}) as any,
        setConfig: async () => {},
        notify: (message, type = "info") => {
          console.log(`[Plugin ${type}]: ${message}`);
        },
      };

      for (const plugin of plugins) {
        registerPlugin(plugin);
        activatePlugin(plugin.id, ctx);
      }
    }

    init();
  }, [userId, registerPlugin, activatePlugin]);

  return null;
}
