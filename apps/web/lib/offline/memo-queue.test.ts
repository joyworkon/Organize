import { describe, expect, it } from "vitest";
import {
  enqueueMemoCreate,
  makeMemoCreateOp,
  memoCreatesCount,
  readMemoCreates,
  replayMemoCreates,
} from "./memo-queue";

const USER = "u1";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** F02 回归：速记离线创建队列——稳定 id 去重、回放失败分类、按用户隔离 */
describe("速记离线队列（F02）", () => {
  it("makeMemoCreateOp 生成稳定 id 与载荷", () => {
    const op = makeMemoCreateOp("内容");
    expect(op.memo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.memo.content).toBe("内容");
  });

  it("同 memo id 重复入队只保留一条", () => {
    const storage = memoryStorage();
    const op = makeMemoCreateOp("第一版");
    enqueueMemoCreate(storage, USER, op);
    enqueueMemoCreate(storage, USER, { ...op, memo: { ...op.memo, content: "第二版" } });
    const ops = readMemoCreates(storage, USER);
    expect(ops).toHaveLength(1);
    expect(ops[0].memo.content).toBe("第二版");
  });

  it("队列按用户隔离", () => {
    const storage = memoryStorage();
    enqueueMemoCreate(storage, "u1", makeMemoCreateOp("甲"));
    enqueueMemoCreate(storage, "u2", makeMemoCreateOp("乙"));
    expect(memoCreatesCount(storage, "u1")).toBe(1);
    expect(memoCreatesCount(storage, "u2")).toBe(1);
    expect(readMemoCreates(storage, "u1")[0].memo.content).toBe("甲");
  });

  it("回放：成功应用后清空队列", async () => {
    const storage = memoryStorage();
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("a"));
    const result = await replayMemoCreates(
      { createMemo: async () => ({ ok: true }) },
      USER,
      storage
    );
    expect(result).toEqual({ applied: 1, rejected: 0, remaining: 0 });
    expect(memoCreatesCount(storage, USER)).toBe(0);
  });

  it("回放：网络错误中止且保留队列（等下次 online）", async () => {
    const storage = memoryStorage();
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("a"));
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("b"));
    const result = await replayMemoCreates(
      {
        createMemo: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
      USER,
      storage
    );
    expect(result.applied).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it("回放：5xx 视为临时故障中止（不丢用户内容）", async () => {
    const storage = memoryStorage();
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("a"));
    const result = await replayMemoCreates(
      { createMemo: async () => ({ ok: false, retryable: true }) },
      USER,
      storage
    );
    expect(result.applied).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it("回放：4xx 业务拒绝丢弃该条并继续后续", async () => {
    const storage = memoryStorage();
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("bad"));
    enqueueMemoCreate(storage, USER, makeMemoCreateOp("good"));
    let call = 0;
    const result = await replayMemoCreates(
      {
        createMemo: async () => {
          call += 1;
          return call === 1 ? { ok: false } : { ok: true };
        },
      },
      USER,
      storage
    );
    expect(result).toEqual({ applied: 1, rejected: 1, remaining: 0 });
  });
});
