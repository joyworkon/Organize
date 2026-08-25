import { describe, expect, it } from "vitest";
import { usePluginStore } from "./store";
import type { OrganizePlugin, PluginContext } from "@organize/plugin-sdk";

function makePlugin(id: string): OrganizePlugin {
  return { id, name: id, version: "1.0.0", description: "", extensions: [] };
}

function makeCtx(): PluginContext {
  return {
    userId: "u1",
    getCurrentItem: () => null,
    getConfig: <T = Record<string, unknown>>() => ({}) as T,
    setConfig: async () => {},
    notify: () => {},
  };
}

describe("usePluginStore 去重", () => {
  it("相同 id 的插件只注册一次，激活覆盖同 id 上下文", () => {
    const { registerPlugin, activatePlugin, deactivatePlugin } = usePluginStore.getState();
    const plugin = makePlugin("dup");

    registerPlugin(plugin);
    registerPlugin({ ...plugin, version: "2.0.0" }); // 同 id 重复注册被忽略
    expect(usePluginStore.getState().plugins).toHaveLength(1);
    expect(usePluginStore.getState().plugins[0].version).toBe("1.0.0");

    activatePlugin("dup", makeCtx());
    activatePlugin("dup", makeCtx()); // 同 id 重复激活只保留一份
    expect(usePluginStore.getState().activePlugins.size).toBe(1);
    expect(usePluginStore.getState().contexts.size).toBe(1);

    expect(usePluginStore.getState().isPluginActive("dup")).toBe(true);
    deactivatePlugin("dup");
    expect(usePluginStore.getState().isPluginActive("dup")).toBe(false);
    expect(usePluginStore.getState().activePlugins.size).toBe(0);
    expect(usePluginStore.getState().contexts.size).toBe(0);

    // 清理，避免影响其他用例
    usePluginStore.setState({ plugins: [], activePlugins: new Map(), contexts: new Map() });
  });

  it("激活未注册的插件 id 是 no-op", () => {
    const { activatePlugin } = usePluginStore.getState();
    activatePlugin("ghost", makeCtx());
    expect(usePluginStore.getState().activePlugins.size).toBe(0);
    expect(usePluginStore.getState().contexts.size).toBe(0);
  });
});
