import { describe, expect, it } from "vitest";
import { runSingleInstance, type WebLocksLike } from "./single-instance";

/** 模拟 Web Locks API 的串行语义：同一名字的 request 排队执行 */
function fakeLocks() {
  const queue: Array<() => void> = [];
  let held = false;
  const locks: WebLocksLike = {
    request: async <R,>(_name: string, callback: () => Promise<R>): Promise<R> => {
      if (held) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      held = true;
      try {
        return await callback();
      } finally {
        held = false;
        queue.shift()?.();
      }
    },
  };
  const isLocked = () => held;
  return { locks, isLocked };
}

describe("runSingleInstance 跨标签页单实例（P1-03）", () => {
  it("有锁 API 时串行执行：第二个请求等第一个完成（含释放后的返回值）", async () => {
    const { locks, isLocked } = fakeLocks();
    const events: string[] = [];

    const first = runSingleInstance(locks, "lock", async () => {
      events.push("first-start");
      expect(isLocked()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first-end");
      return 1;
    });
    const second = runSingleInstance(locks, "lock", async () => {
      events.push("second-start");
      return 2;
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect([r1, r2]).toEqual([1, 2]);
    // 串行：first 完整结束后 second 才开始
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("无锁 API（旧浏览器/测试环境）退化为直接执行，不抛错", async () => {
    const result = await runSingleInstance(null, "lock", async () => "ok");
    expect(result).toBe("ok");
  });

  it("被锁任务抛错时锁仍会释放，后续任务可继续", async () => {
    const { locks } = fakeLocks();
    const first = runSingleInstance(locks, "lock", async () => {
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");
    const second = await runSingleInstance(locks, "lock", async () => "recovered");
    expect(second).toBe("recovered");
  });
});
