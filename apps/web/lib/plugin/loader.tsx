"use client";

import { useEffect } from "react";
import { usePluginStore } from "./store";
import type { PluginContext } from "@organize/plugin-sdk";
import type { PluginRecord } from "@organize/shared";

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
      let records: PluginRecord[] = [];
      try {
        const response = await fetch("/api/plugins", { cache: "no-store" });
        if (response.ok) records = await response.json();
      } catch {
        // 数据库不可用时仍注册插件，但不自动激活。
      }

      for (const plugin of plugins) {
        registerPlugin(plugin);
        let record = records.find((item) => item.package_name === plugin.id);
        if (!record) {
          const defaults = Object.fromEntries((plugin.configFields || []).filter((field) => field.default !== undefined).map((field) => [field.key, field.default]));
          const response = await fetch("/api/plugins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: plugin.name, package_name: plugin.id, version: plugin.version, config: defaults }),
          });
          if (response.ok) record = await response.json();
        }
        if (!record?.enabled) continue;

        let currentConfig = record.config || {};
        const ctx: PluginContext = {
          userId,
          getCurrentItem: () => null,
          getConfig: <T = Record<string, unknown>>() => currentConfig as T,
          setConfig: async (config) => {
            const response = await fetch(`/api/plugins/${record!.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ config }),
            });
            if (!response.ok) throw new Error("插件配置保存失败");
            const updated = await response.json();
            currentConfig = updated.config || {};
          },
          notify: (message, type = "info") => console.log(`[Plugin ${type}]: ${message}`),
        };
        activatePlugin(plugin.id, ctx);
      }
    }

    init();
  }, [userId, registerPlugin, activatePlugin]);

  return null;
}
