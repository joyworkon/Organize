import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb, MOCK_USER } from "./mock-data";

describe("mock task reminders", () => {
  afterEach(() => {
    mockDb.task_reminders = [];
    mockDb.web_push_subscriptions = [];
    mockDb.task_reminder_deliveries = [];
  });

  it("支持提醒的新增、读取和删除", async () => {
    const client = createMockClient();
    const created = await client
      .from("task_reminders")
      .insert({
        user_id: MOCK_USER.id,
        task_id: "task-1",
        anchor: "start",
        offset_minutes: -10,
        notified_at: null,
      })
      .select("*")
      .single();

    expect(created.data).toMatchObject({
      task_id: "task-1",
      anchor: "start",
      offset_minutes: -10,
    });

    const loaded = await client
      .from("task_reminders")
      .select("*")
      .eq("task_id", "task-1");
    expect(loaded.data).toHaveLength(1);

    await client.from("task_reminders").delete().eq("id", created.data.id);
    expect(mockDb.task_reminders).toEqual([]);
  });

  it("按 endpoint 更新已有 Push 订阅而不重复插入", async () => {
    const client = createMockClient();
    const base = {
      user_id: MOCK_USER.id,
      endpoint: "https://push.example.test/subscription",
      p256dh: "first-key",
      auth_secret: "first-secret",
      disabled_at: null,
    };
    await client
      .from("web_push_subscriptions")
      .upsert(base, { onConflict: "endpoint" });
    await client
      .from("web_push_subscriptions")
      .upsert(
        { ...base, p256dh: "rotated-key", auth_secret: "rotated-secret" },
        { onConflict: "endpoint" }
      );

    expect(mockDb.web_push_subscriptions).toHaveLength(1);
    expect(mockDb.web_push_subscriptions[0]).toMatchObject({
      p256dh: "rotated-key",
      auth_secret: "rotated-secret",
    });
  });
});
