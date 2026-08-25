"use client";

import { useEffect } from "react";
import { usePluginStore } from "./store";
import { bootstrapPlugins } from "./bootstrap";
import type { OrganizePlugin } from "@organize/plugin-sdk";
import { toast } from "@/hooks/use-toast";

// 动态导入所有内置插件
// 在 monorepo 中，插件通过 transpilePackages 编译
async function loadBuiltinPlugins(): Promise<OrganizePlugin[]> {
  const plugins: OrganizePlugin[] = [];

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
  const registerPlugin = usePluginStore((state) => state.registerPlugin);
  const activatePlugin = usePluginStore((state) => state.activatePlugin);

  useEffect(() => {
    async function init() {
      const plugins = await loadBuiltinPlugins();
      await bootstrapPlugins({
        plugins,
        userId,
        fetchImpl: fetch,
        registerPlugin,
        activatePlugin,
        notify: (message, variant) =>
          toast({ title: message, variant: variant === "destructive" ? "destructive" : "default" }),
      });
    }

    init();
  }, [userId, registerPlugin, activatePlugin]);

  return null;
}
