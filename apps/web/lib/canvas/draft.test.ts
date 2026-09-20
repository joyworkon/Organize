import { describe, expect, it } from "vitest";
import { deleteDraft, loadDraft, saveDraft, putBlob, getBlob, deleteBlob, type CanvasDraft } from "./draft";
import { emptyDoc } from "./model";

// Node 环境无 IndexedDB → 走内存 Map 回退路径（浏览器走 IndexedDB，行为契约一致）
function draft(seq: number): CanvasDraft {
  return {
    docId: "doc-1",
    userId: "user-1",
    title: `草稿${seq}`,
    doc: emptyDoc(),
    savedRevision: 1,
    localSeq: seq,
    updatedAt: Date.now(),
  };
}

describe("canvas draft store（IndexedDB 不可用时内存回退）", () => {
  it("保存后可读取，更新取最新", async () => {
    await saveDraft(draft(1));
    const loaded = await loadDraft("user-1", "doc-1");
    expect(loaded?.title).toBe("草稿1");
    await saveDraft(draft(2));
    expect((await loadDraft("user-1", "doc-1"))?.localSeq).toBe(2);
  });

  it("按用户与文档隔离：不同账号互不可见", async () => {
    await saveDraft(draft(3));
    expect(await loadDraft("user-2", "doc-1")).toBeNull();
    expect(await loadDraft("user-1", "doc-2")).toBeNull();
  });

  it("删除后不可读", async () => {
    await saveDraft(draft(4));
    await deleteDraft("user-1", "doc-1");
    expect(await loadDraft("user-1", "doc-1")).toBeNull();
  });
});

describe("canvas blob store（mock 图片 / 待重试上传）", () => {
  it("blob 存取删除，按账号隔离", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    await putBlob("user-1", "img-1", blob);
    expect((await getBlob("user-1", "img-1"))?.size).toBe(5);
    expect(await getBlob("user-2", "img-1")).toBeNull();
    await deleteBlob("user-1", "img-1");
    expect(await getBlob("user-1", "img-1")).toBeNull();
  });
});
