import { describe, expect, it } from "vitest";
import { taskWorkspaceTabKey } from "./task-workspace-tabs";

describe("task workspace tabs", () => {
  it("maps static routes and task details to the correct tab", () => {
    expect(taskWorkspaceTabKey("/tasks")).toBe("tasks");
    expect(taskWorkspaceTabKey("/tasks/123")).toBe("tasks");
    expect(taskWorkspaceTabKey("/tasks/calendar")).toBe("calendar");
    expect(taskWorkspaceTabKey("/tasks/countdown")).toBe("countdown");
    expect(taskWorkspaceTabKey("/tasks/search")).toBe("search");
  });
});
