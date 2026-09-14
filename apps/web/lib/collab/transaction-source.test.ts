import { describe, expect, it } from "vitest";
import { resolveTransactionSource, type TransactionSource } from "./transaction-source";

/** 用元数据表构造最小 reader（TipTap Transaction 的 getMeta 形状） */
const fromMeta = (meta: Record<string, unknown>): TransactionSource =>
  resolveTransactionSource({ getMeta: (key) => meta[key] });

describe("resolveTransactionSource", () => {
  it("y-sync$ meta 存在 → remote-sync（优先级最高）", () => {
    expect(fromMeta({ "y-sync$": true })).toBe("remote-sync");
    // 值形态由 yjs sync plugin 决定，非布尔真值同样按远端处理
    expect(fromMeta({ "y-sync$": "update" })).toBe("remote-sync");
  });

  it("y-sync$ 与 transactionSource 同时存在 → 远端优先", () => {
    expect(fromMeta({ "y-sync$": true, transactionSource: "user" })).toBe("remote-sync");
  });

  it("transactionSource meta 透传系统来源", () => {
    expect(fromMeta({ transactionSource: "hydrate" })).toBe("hydrate");
    expect(fromMeta({ transactionSource: "version-restore" })).toBe("version-restore");
    expect(fromMeta({ transactionSource: "backup-restore" })).toBe("backup-restore");
    expect(fromMeta({ transactionSource: "remote-sync" })).toBe("remote-sync");
  });

  it("无任何 meta → user（用户主动编辑）", () => {
    expect(fromMeta({})).toBe("user");
  });

  it("空串 meta 兜底为 user（与原 || 判定逐字一致）", () => {
    expect(fromMeta({ transactionSource: "" })).toBe("user");
  });
});
