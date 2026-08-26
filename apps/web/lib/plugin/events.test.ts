import { describe, expect, it, vi } from "vitest";
import { AppEventBus } from "./events";

describe("AppEventBus", () => {
  it("订阅者收到对应事件的 payload", () => {
    const bus = new AppEventBus();
    const handler = vi.fn();
    bus.on("task:completed", handler);

    bus.emit("task:completed", { taskId: "t1", title: "写周报" });

    expect(handler).toHaveBeenCalledWith({ taskId: "t1", title: "写周报" });
  });

  it("只通知匹配事件的订阅者", () => {
    const bus = new AppEventBus();
    const noteHandler = vi.fn();
    const readingHandler = vi.fn();
    bus.on("note:saved", noteHandler);
    bus.on("reading:item-created", readingHandler);

    bus.emit("note:saved", { noteId: "n1", title: "日记" });

    expect(noteHandler).toHaveBeenCalledTimes(1);
    expect(readingHandler).not.toHaveBeenCalled();
  });

  it("disposer 退订；空桶自动清理", () => {
    const bus = new AppEventBus();
    const handler = vi.fn();
    const dispose = bus.on("note:opened", handler);

    expect(bus.listenerCount("note:opened")).toBe(1);
    dispose();
    expect(bus.listenerCount("note:opened")).toBe(0);
    expect(bus.listenerCount()).toBe(0);

    bus.emit("note:opened", { noteId: "n1", title: "" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("单个订阅者抛错不影响其他订阅者与发射方", () => {
    const bus = new AppEventBus();
    const goodHandler = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.on("reading:status-changed", () => {
      throw new Error("bad plugin");
    });
    bus.on("reading:status-changed", goodHandler);

    expect(() =>
      bus.emit("reading:status-changed", { itemId: "r1", from: "unread", to: "read" })
    ).not.toThrow();
    expect(goodHandler).toHaveBeenCalledWith({ itemId: "r1", from: "unread", to: "read" });

    errorSpy.mockRestore();
  });
});
