import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb, MOCK_USER } from "./mock-data";

describe("mock task attachments", () => {
  const path = `${MOCK_USER.id}/tasks/task-1/test.txt`;

  afterEach(async () => {
    mockDb.task_attachments = [];
    await createMockClient().storage.from("attachments").remove([path]);
  });

  it("支持对象上传、公开地址、下载和删除", async () => {
    const storage = createMockClient().storage.from("attachments");
    const file = new Blob(["附件内容"], { type: "text/plain" });

    const uploaded = await storage.upload(path, file);
    expect(uploaded.error).toBeNull();
    expect(storage.getPublicUrl(path).data.publicUrl).toBeTruthy();

    const downloaded = await storage.download(path);
    expect(downloaded.error).toBeNull();
    expect(await downloaded.data.text()).toBe("附件内容");

    const removed = await storage.remove([path]);
    expect(removed.error).toBeNull();
    expect((await storage.download(path)).error?.message).toBe("对象不存在");
  });

  it("支持附件元数据新增和删除", async () => {
    const client = createMockClient();
    const inserted = await client
      .from("task_attachments")
      .insert({
        user_id: MOCK_USER.id,
        task_id: "task-1",
        name: "test.txt",
        bucket: "attachments",
        path,
        mime_type: "text/plain",
        size_bytes: 12,
      })
      .select("*")
      .single();

    expect(inserted.data.path).toBe(path);
    await client.from("task_attachments").delete().eq("id", inserted.data.id);
    expect(mockDb.task_attachments).toEqual([]);
  });
});
