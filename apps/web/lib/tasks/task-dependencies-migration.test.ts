import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/041_task_dependencies.sql"),
  "utf8"
);

describe("migration 041: task dependencies", () => {
  it("使用复合主键和双向级联外键保存依赖边", () => {
    expect(sql).toContain("primary key (task_id, depends_on_task_id)");
    expect(sql.match(/references public\.tasks\(id\) on delete cascade/g)).toHaveLength(2);
    expect(sql).toContain("constraint task_dependencies_not_self");
  });

  it("RPC 串行化同一用户的图修改并拒绝任意深度循环", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtextextended(target_user::text, 0)");
    expect(sql).toContain("with recursive reachable");
    expect(sql).toContain("select 1 from reachable where task_id = p_task_id");
    expect(sql).toContain("Task dependencies cannot contain a cycle");
  });

  it("RLS 只允许读取，依赖增删统一通过 RPC", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("for select");
    expect(sql).toContain("revoke insert, update, delete");
    expect(sql).toContain("add_task_dependency");
    expect(sql).toContain("remove_task_dependency");
  });

  it("恢复包装验证引用、重复和循环后再原子写入", () => {
    expect(sql).toContain("restore_backup_v2_with_dependencies");
    expect(sql).toContain("Restore contains an invalid task dependency reference");
    expect(sql).toContain("Restore contains duplicate task dependencies");
    expect(sql).toContain("Restore task dependencies cannot contain a cycle");
    expect(sql).toContain("public.restore_backup_v2_with_hierarchy(p_payload)");
  });
});
