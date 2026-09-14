import { describe, expect, it, vi } from "vitest";
import {
  fetchAllNoteBacklinks,
  fetchAllNoteBacklinksV1,
  fetchAllNoteBacklinksV2,
} from "./backlinks";

const row = (id: string) => ({ id, title: `来源 ${id}`, created_at: "2026-09-05T00:00:00Z" });

describe("fetchAllNoteBacklinksV1（R10a，074 回退路径）", () => {
  function fakeSupabase(pages: Array<{ total: number; rows: Array<{ id: string }> }>) {
    const calls: number[] = [];
    const supabase = {
      rpc: vi.fn(async (_fn: string, args: { p_page: number }) => {
        calls.push(args.p_page);
        return { data: pages[args.p_page] ?? { total: pages[0].total, rows: [] }, error: null };
      }),
    };
    return { supabase, calls };
  }

  it("分页取全：total 超过单页时循环取齐", async () => {
    const { supabase, calls } = fakeSupabase([
      { total: 250, rows: Array.from({ length: 100 }, (_, i) => row(`a-${i}`)) },
      { total: 250, rows: Array.from({ length: 100 }, (_, i) => row(`b-${i}`)) },
      { total: 250, rows: Array.from({ length: 50 }, (_, i) => row(`c-${i}`)) },
    ]);
    const all = await fetchAllNoteBacklinksV1(supabase, "note-1", 100);
    expect(all).toHaveLength(250);
    expect(calls).toEqual([0, 1, 2]);
  });

  it("单页即全：不再发多余请求", async () => {
    const { supabase, calls } = fakeSupabase([
      { total: 3, rows: [row("a"), row("b"), row("c")] },
    ]);
    const all = await fetchAllNoteBacklinksV1(supabase, "note-1", 100);
    expect(all).toHaveLength(3);
    expect(calls).toEqual([0]);
  });

  it("错误抛出、空页终止、页数上限防御", async () => {
    const errSupabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    };
    await expect(fetchAllNoteBacklinksV1(errSupabase as never, "n", 100)).rejects.toMatchObject({ message: "boom" });

    const emptyPage = fakeSupabase([{ total: 10, rows: [] }]);
    expect(await fetchAllNoteBacklinksV1(emptyPage.supabase as never, "n", 100)).toEqual([]);

    // total 谎报超大（服务端异常）：页数上限 5000/100=50 兜底终止
    let liarCalls = 0;
    const liar = {
      rpc: vi.fn(async (_fn: string, args: { p_page: number }) => {
        liarCalls += 1;
        if (args.p_page === 0) return { data: { total: 999999, rows: [row("x")] }, error: null };
        if (args.p_page === 1) return { data: { total: 999999, rows: [row("y")] }, error: null };
        return { data: { total: 999999, rows: [] }, error: null };
      }),
    };
    const all = await fetchAllNoteBacklinksV1(liar as never, "n", 100);
    expect(all.length).toBeLessThanOrEqual(5000);
    expect(liarCalls).toBeLessThanOrEqual(51);
  });
});

describe("fetchAllNoteBacklinksV2（R10b，078 索引读）", () => {
  function v2Fake(pages: Array<{ rows: Array<{ id: string }>; next_cursor?: unknown }>) {
    const calls: Array<unknown> = [];
    const supabase = {
      rpc: vi.fn(async (_fn: string, args: { p_cursor: unknown }) => {
        calls.push(args.p_cursor);
        const idx = calls.length - 1;
        return { data: pages[idx] ?? { rows: [] }, error: null };
      }),
    };
    return { supabase, calls };
  }

  it("游标翻页取全：cursor 推进、键缺失判停", async () => {
    const cursor2 = { u: "2026-09-05T01:00:00+00", i: "s-100" };
    const cursor3 = { u: "2026-09-04T01:00:00+00", i: "s-200" };
    const { supabase, calls } = v2Fake([
      { rows: Array.from({ length: 100 }, (_, i) => row(`a-${i}`)), next_cursor: cursor2 },
      { rows: Array.from({ length: 100 }, (_, i) => row(`b-${i}`)), next_cursor: cursor3 },
      { rows: [row("c-0")], next_cursor: undefined }, // 取尽：省略键
    ]);
    const all = await fetchAllNoteBacklinksV2(supabase as never, "note-1", 100);
    expect(all).toHaveLength(201);
    expect(calls[0]).toBeNull();
    expect(calls[1]).toEqual(cursor2);
    expect(calls[2]).toEqual(cursor3);
    expect(calls).toHaveLength(3); // 判停后不再发请求
  });

  it("JSON null 游标同样判停（防御：键存在但值为 null）", async () => {
    const { supabase, calls } = v2Fake([
      { rows: [row("a")], next_cursor: null },
    ]);
    const all = await fetchAllNoteBacklinksV2(supabase as never, "note-1", 100);
    expect(all).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("错误抛出", async () => {
    const errSupabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "v2 boom" } })),
    };
    await expect(fetchAllNoteBacklinksV2(errSupabase as never, "n", 100)).rejects.toMatchObject({ message: "v2 boom" });
  });
});

describe("fetchAllNoteBacklinks（合并入口：v2 优先，v1 回退）", () => {
  it("v2 可用时直接走 v2", async () => {
    const supabase = {
      rpc: vi.fn(async (fn: string) => {
        expect(fn).toBe("get_note_backlinks_v2");
        return { data: { rows: [row("a")], next_cursor: undefined }, error: null };
      }),
    };
    const all = await fetchAllNoteBacklinks(supabase as never, "note-1", 100);
    expect(all).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("v2 报错时回退 v1（守门窗口语义）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fnNames: string[] = [];
    const supabase = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        fnNames.push(fn);
        if (fn === "get_note_backlinks_v2") {
          return { data: null, error: { message: "function missing" } };
        }
        // v1 两页
        return (args as { p_page: number }).p_page === 0
          ? { data: { total: 2, rows: [row("v1-a")] }, error: null }
          : { data: { total: 2, rows: [row("v1-b")] }, error: null };
      }),
    };
    const all = await fetchAllNoteBacklinks(supabase as never, "note-1", 100);
    expect(all.map((r) => r.id)).toEqual(["v1-a", "v1-b"]);
    expect(fnNames[0]).toBe("get_note_backlinks_v2");
    expect(fnNames).toContain("get_note_backlinks");
    warn.mockRestore();
  });
});
