import { describe, it, expect } from "vitest";
import { describeAutoGroupApplyFailure, describeAutoGroupApplySuccess } from "./auto-group-apply";

describe("describeAutoGroupApplyFailure", () => {
  it("全失败（没建组也没移动）：维持「应用分组失败」，不需要刷新", () => {
    const view = describeAutoGroupApplyFailure(0, 0, new Error("network down"));
    expect(view.title).toBe("应用分组失败");
    expect(view.description).toBe("network down");
    expect(view.wroteAnything).toBe(false);
  });

  it("仅创建组后失败：如实说明建了几个组，需要刷新（服务器上已有空组）", () => {
    const view = describeAutoGroupApplyFailure(0, 0, new Error("insert members failed"), 1);
    expect(view.title).toBe("已创建 1 个分组，但整理笔记失败");
    expect(view.description).toContain("另有 1 个新建分组还没放入笔记");
    expect(view.description).toContain("insert members failed");
    expect(view.wroteAnything).toBe(true);
  });

  it("移动部分笔记后失败：报「已整理 N 篇到 M 个分组，后续失败」，需要刷新", () => {
    const view = describeAutoGroupApplyFailure(2, 5, new Error("boom"));
    expect(view.title).toBe("已整理 5 篇到 2 个分组，后续失败");
    expect(view.description).toBe("boom");
    expect(view.wroteAnything).toBe(true);
  });

  it("移动部分后、失败组又已建好：标题报已整理量，description 补充空组", () => {
    const view = describeAutoGroupApplyFailure(2, 5, new Error("boom"), 1);
    expect(view.title).toBe("已整理 5 篇到 2 个分组，后续失败");
    expect(view.description).toBe("另有 1 个新建分组还没放入笔记；boom");
    expect(view.wroteAnything).toBe(true);
  });

  it("错误不是 Error 实例时降级为字符串；没有错误信息时 description 省略", () => {
    expect(describeAutoGroupApplyFailure(0, 0, "plain text").description).toBe("plain text");
    expect(describeAutoGroupApplyFailure(1, 3, null).description).toBeUndefined();
    expect(describeAutoGroupApplyFailure(1, 3, new Error("")).description).toBeUndefined();
  });
});

describe("describeAutoGroupApplySuccess", () => {
  it("全成功沿用「已应用 X 个分组，整理了 Y 篇笔记」，不误用失败模板", () => {
    const success = describeAutoGroupApplySuccess(3, 7);
    expect(success).toBe("已应用 3 个分组，整理了 7 篇笔记");
    expect(success).not.toContain("失败");
    // 反向：部分失败文案也不是成功话术
    const failure = describeAutoGroupApplyFailure(2, 5, new Error("boom"));
    expect(failure.title).toContain("失败");
    expect(failure.title).not.toContain("已应用");
  });
});
