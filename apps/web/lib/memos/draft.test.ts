import { describe, expect, it } from "vitest";
import {
  clearMemoDraft,
  loadMemoDraft,
  memoDraftKey,
  saveMemoDraft,
} from "./draft";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** F02 回归：草稿按 用户+入口 隔离，存取与清除语义正确 */
describe("速记本机草稿（F02）", () => {
  it("key 按用户与入口隔离", () => {
    expect(memoDraftKey("u1", "main")).not.toBe(memoDraftKey("u2", "main"));
    expect(memoDraftKey("u1", "main")).not.toBe(memoDraftKey("u1", "notch"));
  });

  it("保存后可恢复；清除后为空", () => {
    const storage = memoryStorage();
    saveMemoDraft(storage, "u1", "main", "未保存的想法");
    expect(loadMemoDraft(storage, "u1", "main")).toBe("未保存的想法");
    clearMemoDraft(storage, "u1", "main");
    expect(loadMemoDraft(storage, "u1", "main")).toBe("");
  });

  it("另一账号读不到该草稿", () => {
    const storage = memoryStorage();
    saveMemoDraft(storage, "u1", "main", "私有");
    expect(loadMemoDraft(storage, "u2", "main")).toBe("");
  });

  it("存储异常时不抛出（草稿降级为仅内存）", () => {
    const throwing = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("boom");
      },
    };
    expect(() => saveMemoDraft(throwing, "u1", "main", "x")).not.toThrow();
    expect(() => clearMemoDraft(throwing, "u1", "main")).not.toThrow();
    expect(loadMemoDraft(throwing, "u1", "main")).toBe("");
  });
});
