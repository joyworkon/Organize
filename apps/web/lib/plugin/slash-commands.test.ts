import { describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry, type RegisteredSlashCommand } from "./slash-commands";
import type { PluginContext } from "@organize/plugin-sdk";

function makeEntry(id: string, overrides: Partial<RegisteredSlashCommand> = {}): RegisteredSlashCommand {
  return {
    id,
    pluginId: id.split(":")[0],
    pluginName: "测试插件",
    command: { id: id.split(":")[1], label: `命令 ${id}`, handler: vi.fn() },
    ctx: { userId: "u1" } as unknown as PluginContext,
    ...overrides,
  };
}

describe("SlashCommandRegistry", () => {
  it("注册后可按 id 获取，list 返回全部条目", () => {
    const registry = new SlashCommandRegistry();
    registry.register(makeEntry("p1:a"));
    registry.register(makeEntry("p1:b"));

    expect(registry.get("p1:a")?.command.label).toBe("命令 p1:a");
    expect(registry.list().map((entry) => entry.id)).toEqual(["p1:a", "p1:b"]);
  });

  it("disposer 注销后条目消失；注销不存在的 id 不报错", () => {
    const registry = new SlashCommandRegistry();
    const dispose = registry.register(makeEntry("p1:a"));

    dispose();
    expect(registry.get("p1:a")).toBeUndefined();
    expect(registry.list()).toEqual([]);

    expect(() => registry.unregister("missing")).not.toThrow();
  });

  it("同 id 重复注册覆盖旧条目", () => {
    const registry = new SlashCommandRegistry();
    registry.register(makeEntry("p1:a"));
    registry.register(makeEntry("p1:a", { pluginName: "新插件" }));

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("p1:a")?.pluginName).toBe("新插件");
  });

  it("订阅者在注册/注销时收到通知；退订后不再通知", () => {
    const registry = new SlashCommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    const dispose = registry.register(makeEntry("p1:a"));
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registry.register(makeEntry("p1:b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("list 快照在两次变更间保持同一引用（useSyncExternalStore 契约）", () => {
    const registry = new SlashCommandRegistry();
    registry.register(makeEntry("p1:a"));

    const first = registry.list();
    const second = registry.list();
    expect(first).toBe(second);

    registry.register(makeEntry("p1:b"));
    expect(registry.list()).not.toBe(first);
  });
});
