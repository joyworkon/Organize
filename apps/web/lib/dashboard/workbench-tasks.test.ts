import { describe, expect, it } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { mergeActionableTasks } from "@/lib/dashboard/workbench-tasks";

const task = (id: string) => ({ id }) as TaskWithTags;

describe("mergeActionableTasks", () => {
  it("deduplicates tasks that qualify for multiple dashboard groups", () => {
    expect(mergeActionableTasks([task("overdue"), task("shared")], [task("shared"), task("today")], [task("shared")]).map((item) => item.id))
      .toEqual(["overdue", "shared", "today"]);
  });
});
