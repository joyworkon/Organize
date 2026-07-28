import { describe, it, expect } from "vitest";
import { cycleStatus, getHostname } from "./reading-card-utils";

describe("cycleStatus", () => {
  it("按 unread → reading → read → unread 循环", () => {
    expect(cycleStatus("unread")).toBe("reading");
    expect(cycleStatus("reading")).toBe("read");
    expect(cycleStatus("read")).toBe("unread");
  });
});

describe("getHostname", () => {
  it("提取主机名并去掉 www. 前缀", () => {
    expect(getHostname("https://www.example.com/a/b?c=1")).toBe("example.com");
    expect(getHostname("https://mp.weixin.qq.com/s/xxx")).toBe("mp.weixin.qq.com");
  });

  it("非法 URL 返回空串而不抛异常", () => {
    expect(getHostname("not-a-url")).toBe("");
    expect(getHostname("")).toBe("");
  });
});
