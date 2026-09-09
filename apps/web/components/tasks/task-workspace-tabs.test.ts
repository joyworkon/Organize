import { describe, expect, it } from "vitest";
import { taskWorkspaceTabKey, taskWorkspaceQuery } from "./task-workspace-tabs";

describe("task workspace tabs", () => {
  it("maps static routes and task details to the correct tab", () => {
    expect(taskWorkspaceTabKey("/tasks")).toBe("tasks");
    expect(taskWorkspaceTabKey("/tasks/123")).toBe("tasks");
    expect(taskWorkspaceTabKey("/tasks/calendar")).toBe("calendar");
    expect(taskWorkspaceTabKey("/tasks/countdown")).toBe("countdown");
    expect(taskWorkspaceTabKey("/tasks/lessons")).toBe("lessons");
    expect(taskWorkspaceTabKey("/tasks/search")).toBe("search");
  });
});

describe("task workspace navigation context", () => {
  it("preserves a selected list through countdown and back to tasks", () => {
    const query = taskWorkspaceQuery("/tasks", new URLSearchParams("scope=list&list=design"), "countdown");
    expect(query).toBe("?scope=list&list=design");
    expect(taskWorkspaceQuery("/tasks/countdown", new URLSearchParams(query), "tasks")).toBe(query);
  });
  it("keeps task search separate from list selection and defaults to all tasks", () => {
    expect(taskWorkspaceQuery("/tasks/search", new URLSearchParams("q=hello"), "tasks")).toBe("?scope=all");
    expect(taskWorkspaceQuery("/tasks/calendar", new URLSearchParams("scope=today&task=old"), "calendar")).toBe("?scope=today");
  });
});
