import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./registry";

describe("CommandRegistry", () => {
  it("注册后可列出，注销后移除", () => {
    const registry = new CommandRegistry();
    registry.register({ id: "a", title: "命令 A", run: () => {} });
    registry.register({ id: "b", title: "命令 B", section: "导航", run: () => {} });

    expect(registry.list().map((command) => command.id)).toEqual(["a", "b"]);
    expect(registry.get("a")?.title).toBe("命令 A");

    registry.unregister("a");
    expect(registry.list().map((command) => command.id)).toEqual(["b"]);
    expect(registry.get("a")).toBeUndefined();
  });

  it("disposer 注销命令；重复注销安全", () => {
    const registry = new CommandRegistry();
    const dispose = registry.register({ id: "x", title: "X", run: () => {} });

    dispose();
    expect(registry.list()).toHaveLength(0);
    dispose(); // no-op
    expect(registry.list()).toHaveLength(0);
  });

  it("同 id 重复注册覆盖旧命令", () => {
    const registry = new CommandRegistry();
    registry.register({ id: "a", title: "旧", run: () => {} });
    registry.register({ id: "a", title: "新", run: () => {} });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("a")?.title).toBe("新");
  });

  it("变更时通知订阅者；退订后不再通知", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.register({ id: "a", title: "A", run: () => {} });
    registry.unregister("a");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registry.register({ id: "b", title: "B", run: () => {} });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("list 在两次变更之间返回同一引用（useSyncExternalStore 快照稳定）", () => {
    const registry = new CommandRegistry();
    const first = registry.list();
    expect(registry.list()).toBe(first);

    registry.register({ id: "a", title: "A", run: () => {} });
    const second = registry.list();
    expect(second).not.toBe(first);
    expect(registry.list()).toBe(second);
  });
});
