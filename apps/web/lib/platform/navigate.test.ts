import { describe, expect, it } from "vitest";
import { sanitizeNavigatePath } from "./navigate";

describe("sanitizeNavigatePath", () => {
  it("放行应用内相对路径", () => {
    expect(sanitizeNavigatePath("/memos")).toBe("/memos");
    expect(sanitizeNavigatePath("/notes/abc?x=1")).toBe("/notes/abc?x=1");
    expect(sanitizeNavigatePath("/")).toBe("/");
  });

  it("拒绝非字符串与空串", () => {
    expect(sanitizeNavigatePath(null)).toBeNull();
    expect(sanitizeNavigatePath(undefined)).toBeNull();
    expect(sanitizeNavigatePath(42)).toBeNull();
    expect(sanitizeNavigatePath({ path: "/memos" })).toBeNull();
    expect(sanitizeNavigatePath("")).toBeNull();
  });

  it("拒绝外链与协议相对路径", () => {
    expect(sanitizeNavigatePath("https://evil.example")).toBeNull();
    expect(sanitizeNavigatePath("http://localhost:3000/memos")).toBeNull();
    expect(sanitizeNavigatePath("//evil.example")).toBeNull();
    expect(sanitizeNavigatePath("javascript:alert(1)")).toBeNull();
    expect(sanitizeNavigatePath("memos")).toBeNull();
  });

  it("拒绝含控制字符的路径", () => {
    expect(sanitizeNavigatePath("/memos\u0000")).toBeNull();
    expect(sanitizeNavigatePath("/me\nmos")).toBeNull();
  });
});
