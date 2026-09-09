import { describe, expect, it } from "vitest";
import { collectionLocation, mobileKeyboardOpen, mobileRoute, readMobileLocations } from "./mobile";

describe("mobile navigation routes", () => {
  it.each(["/tasks/calendar", "/tasks/countdown", "/tasks/lessons", "/tasks/search"])("keeps %s in the task workspace", (path) => {
    expect(mobileRoute(path)).toMatchObject({ section: "tasks", detail: false });
  });
  it.each(["/notes/a", "/library/a", "/tasks/a"])("gives %s its own detail toolbar", (path) => {
    expect(mobileRoute(path).detail).toBe(true);
  });
  it("recognizes the inline task detail without losing its collection", () => {
    const params = new URLSearchParams("scope=list&list=design&task=one");
    expect(mobileRoute("/tasks", params).detail).toBe(true);
    expect(collectionLocation("/tasks", params)).toBe("/tasks?scope=list&list=design");
    expect(params.get("task")).toBe("one");
  });
  it("does not accidentally classify similarly named routes", () => {
    expect(mobileRoute("/notes-archive").section).toBeNull();
    expect(mobileRoute("/tasks-old").section).toBeNull();
    expect(mobileRoute("/graph")).toMatchObject({ section: "notes", detail: false });
  });
  it("restores reading filters and uses explicit all-task scope on first visit", () => {
    expect(collectionLocation("/library", new URLSearchParams("status=reading&tags=design"))).toBe("/library?status=reading&tags=design");
    expect(collectionLocation("/tasks", new URLSearchParams())).toBe("/tasks?scope=all");
    expect(collectionLocation("/notes/one", new URLSearchParams())).toBeNull();
  });
});

describe("restoring mobile locations", () => {
  it("fails safely for corrupt or unavailable storage", () => {
    expect(readMobileLocations(null)).toEqual({});
    expect(readMobileLocations("{bad")).toEqual({});
    expect(readMobileLocations("[]")).toEqual({});
  });
  it("rejects external URLs, cross-section routes and details", () => {
    expect(readMobileLocations(JSON.stringify({ home: "//evil.test", library: "/\\evil.test", notes: "/notes/private-id", tasks: "/notes", memos: "javascript:alert(1)" }))).toEqual({});
  });
  it("retains the selected task list but removes a stale detail selection", () => {
    expect(readMobileLocations(JSON.stringify({ tasks: "/tasks?scope=list&list=design&task=old" }))).toEqual({ tasks: "/tasks?scope=list&list=design" });
  });
});

describe("mobile keyboard detection", () => {
  it("recognizes a keyboard occupying the visible viewport", () => {
    expect(mobileKeyboardOpen(844, 500, 0, 1, true)).toBe(true);
  });
  it("does not confuse pinch zoom, browser chrome or an unfocused page with a keyboard", () => {
    expect(mobileKeyboardOpen(844, 500, 0, 2, true)).toBe(false);
    expect(mobileKeyboardOpen(844, 780, 0, 1, true)).toBe(false);
    expect(mobileKeyboardOpen(844, 500, 0, 1, false)).toBe(false);
    expect(mobileKeyboardOpen(844, 600, 150, 1, true)).toBe(false);
  });
});
