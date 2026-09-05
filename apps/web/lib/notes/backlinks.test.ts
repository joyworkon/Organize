import { describe, expect, it, vi } from "vitest";
import { fetchAllNoteBacklinks } from "./backlinks";

const row = (id: string) => ({ id, title: `来源 ${id}`, created_at: "2026-09-05T00:00:00Z" });

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

describe("fetchAllNoteBacklinks（R10a）", () => {
  it("分页取全：total 超过单页时循环取齐", async () => {
    const { supabase, calls } = fakeSupabase([
      { total: 250, rows: Array.from({ length: 100 }, (_, i) => row(`a-${i}`)) },
      { total: 250, rows: Array.from({ length: 100 }, (_, i) => row(`b-${i}`)) },
      { total: 250, rows: Array.from({ length: 50 }, (_, i) => row(`c-${i}`)) },
    ]);
    const all = await fetchAllNoteBacklinks(supabase, "note-1", 100);
    expect(all).toHaveLength(250);
    expect(calls).toEqual([0, 1, 2]);
  });

  it("单页即全：不再发多余请求", async () => {
    const { supabase, calls } = fakeSupabase([
      { total: 3, rows: [row("a"), row("b"), row("c")] },
    ]);
    const all = await fetchAllNoteBacklinks(supabase, "note-1", 100);
    expect(all).toHaveLength(3);
    expect(calls).toEqual([0]);
  });

  it("错误抛出、空页终止、页数上限防御", async () => {
    const errSupabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    };
    await expect(fetchAllNoteBacklinks(errSupabase as never, "n", 100)).rejects.toMatchObject({ message: "boom" });

    const emptyPage = fakeSupabase([{ total: 10, rows: [] }]);
    expect(await fetchAllNoteBacklinks(emptyPage.supabase as never, "n", 100)).toEqual([]);

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
    const all = await fetchAllNoteBacklinks(liar, "n", 100);
    expect(all.length).toBeLessThanOrEqual(5000);
    expect(liarCalls).toBeLessThanOrEqual(51);
  });
});
