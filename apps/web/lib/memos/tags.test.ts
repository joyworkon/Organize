import { describe, expect, it } from "vitest";
import { parseMemoTags } from "./tags";

describe("parseMemoTags", () => {
  it("提取 #标签 并去重保序", () => {
    expect(parseMemoTags("记录一个想法 #产品 #灵感 #产品")).toEqual(["产品", "灵感"]);
  });

  it("剥掉标签尾部标点", () => {
    expect(parseMemoTags("坚持不了一周 #产品。")).toEqual(["产品"]);
    expect(parseMemoTags("英文也行 #idea, 记完就走")).toEqual(["idea"]);
  });

  it("无标签返回空数组", () => {
    expect(parseMemoTags("没有标签的内容")).toEqual([]);
  });

  it("井号后空白不算标签；## 宽容处理为普通标签（flomo 嵌套风格）", () => {
    expect(parseMemoTags("# 这不是标签")).toEqual([]);
    expect(parseMemoTags("##这也不是")).toEqual(["这也不是"]);
  });
});
