import { describe, expect, it } from "vitest";
import {
  buildTaskFromTemplate,
  normalizeTaskTemplate,
} from "./templates";

describe("task templates", () => {
  it("只读取任务模板白名单字段并规范非法值", () => {
    expect(
      normalizeTaskTemplate({
        title: "  周报  ",
        description: "",
        priority: "urgent",
        category: "work",
        estimated_minutes: "25",
        status: "done",
        note_id: "secret-note",
      })
    ).toEqual({
      title: "周报",
      description: null,
      priority: "medium",
      category: "work",
      list_id: null,
      estimated_minutes: 25,
      all_day: false,
      timezone: null,
      recurrence_rule: null,
    });
  });

  it("套用模板时重置状态并使用当前上下文日期", () => {
    const snapshot = normalizeTaskTemplate({
      title: "复盘",
      priority: "high",
      category: "study",
      all_day: true,
      recurrence_rule: { frequency: "weekly", interval: 99 },
    });
    expect(
      buildTaskFromTemplate(snapshot, "user-1", {
        listId: "list-1",
        dueDate: "2026-08-20T00:00:00.000Z",
      })
    ).toMatchObject({
      user_id: "user-1",
      title: "复盘",
      status: "todo",
      list_id: "list-1",
      due_date: "2026-08-20T00:00:00.000Z",
      recurrence_rule: { frequency: "weekly", interval: 1 },
    });
  });
});
