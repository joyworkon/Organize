import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/040_hierarchical_subtasks.sql"),
  "utf8"
);

describe("migration 040: hierarchical subtasks", () => {
  it("使用可空自引用外键，删除父任务时提升子任务为根任务", () => {
    expect(sql).toContain("add column if not exists parent_task_id uuid");
    expect(sql).toContain("foreign key (parent_task_id)");
    expect(sql).toContain("references public.tasks(id)");
    expect(sql).toContain("on delete set null");
  });

  it("约束触发器阻止跨用户、自引用和间接循环", () => {
    expect(sql).toContain("check (parent_task_id is null or parent_task_id <> id)");
    expect(sql).toContain("parent.user_id = new.user_id");
    expect(sql).toContain("child.parent_task_id = new.id");
    expect(sql).toContain("child.user_id is distinct from new.user_id");
    expect(sql).toContain("with recursive ancestors");
    expect(sql).toContain("select 1 from ancestors where id = new.id");
    expect(sql).toContain("create constraint trigger validate_task_parent_trigger");
  });

  it("恢复函数验证父引用和循环，并在基础恢复后回填父关系", () => {
    expect(sql).toContain("restore_backup_v2_with_hierarchy");
    expect(sql).toContain("Restore contains an invalid parent task reference");
    expect(sql).toContain("Restore task hierarchy cannot contain a cycle");
    expect(sql).toContain("public.restore_backup_v2_with_pages(p_payload)");
    expect(sql).toMatch(
      /update public\.tasks task[\s\S]*set parent_task_id = \(payload_task->>'parent_task_id'\)::uuid/
    );
  });
});
