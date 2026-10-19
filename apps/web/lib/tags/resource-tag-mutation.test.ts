import { describe, expect, it } from "vitest";
import {
  addTagMutationFromMock,
  readAddTagMutation,
  removeTagMutationFromMock,
  removeTagMutationFromResponse,
} from "./resource-tag-mutation";

function fakeResponse(ok: boolean, body?: unknown, jsonThrows = false): Response {
  return {
    ok,
    json: async () => {
      if (jsonThrows) throw new Error("invalid json");
      return body;
    },
  } as unknown as Response;
}

describe("readAddTagMutation", () => {
  it("响应 ok 且带 tag_id 时判定成功", async () => {
    const outcome = await readAddTagMutation(fakeResponse(true, { tag_id: "t1" }));

    expect(outcome).toEqual({ ok: true, tagId: "t1" });
  });

  it("响应 !ok 时判定失败（不回读 body）", async () => {
    const outcome = await readAddTagMutation(fakeResponse(false, { tag_id: "t1" }));

    expect(outcome).toEqual({ ok: false });
  });

  it("响应 ok 但缺 tag_id 时判定失败", async () => {
    const outcome = await readAddTagMutation(fakeResponse(true, {}));

    expect(outcome).toEqual({ ok: false });
  });

  it("响应 ok 但 tag_id 为空字符串时判定失败", async () => {
    const outcome = await readAddTagMutation(fakeResponse(true, { tag_id: "" }));

    expect(outcome).toEqual({ ok: false });
  });

  it("响应 ok 但 json 解析失败时判定失败", async () => {
    const outcome = await readAddTagMutation(fakeResponse(true, undefined, true));

    expect(outcome).toEqual({ ok: false });
  });
});

describe("addTagMutationFromMock", () => {
  it("mock 返回 tag id 时判定成功", () => {
    expect(addTagMutationFromMock("t1")).toEqual({ ok: true, tagId: "t1" });
  });

  it("mock 返回 undefined 时判定失败", () => {
    expect(addTagMutationFromMock(undefined)).toEqual({ ok: false });
  });
});

describe("removeTagMutationFromResponse", () => {
  it("响应 ok 时判定成功", () => {
    expect(removeTagMutationFromResponse(fakeResponse(true))).toEqual({ ok: true });
  });

  it("响应 !ok 时判定失败", () => {
    expect(removeTagMutationFromResponse(fakeResponse(false))).toEqual({ ok: false });
  });
});

describe("removeTagMutationFromMock", () => {
  it("无 error 时判定成功", () => {
    expect(removeTagMutationFromMock(null)).toEqual({ ok: true });
  });

  it("有 error 时判定失败", () => {
    expect(removeTagMutationFromMock({ message: "boom" })).toEqual({ ok: false });
  });
});
