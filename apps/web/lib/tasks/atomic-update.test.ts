import { describe, expect, it } from "vitest";
import { parseAtomicUpdateResponse } from "./atomic-update";

describe("update_task_atomic 响应解析（P1-03 协议）", () => {
  it("applied：带回新版本号", () => {
    expect(parseAtomicUpdateResponse({ status: "applied", sync_version: 7 })).toEqual({
      status: "applied",
      syncVersion: 7,
    });
  });

  it("already_applied：mutation id 幂等命中", () => {
    expect(parseAtomicUpdateResponse({ status: "already_applied" })).toEqual({
      status: "already_applied",
    });
  });

  it("conflict：带回服务端当前版本（缺失时为 null）", () => {
    expect(parseAtomicUpdateResponse({ status: "conflict", current_sync_version: 12 })).toEqual({
      status: "conflict",
      currentSyncVersion: 12,
    });
    expect(parseAtomicUpdateResponse({ status: "conflict" })).toEqual({
      status: "conflict",
      currentSyncVersion: null,
    });
  });

  it("not_found：任务不存在或不可见", () => {
    expect(parseAtomicUpdateResponse({ status: "not_found" })).toEqual({ status: "not_found" });
  });

  it("异常形状归一为 error（不抛出、不假成功）", () => {
    expect(parseAtomicUpdateResponse(null).status).toBe("error");
    expect(parseAtomicUpdateResponse("oops").status).toBe("error");
    expect(parseAtomicUpdateResponse({ status: "mystery" }).status).toBe("error");
  });
});
