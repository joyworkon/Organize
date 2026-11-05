// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 阶段 5 修正：use-source-status 状态机——查询失败（网络/服务异常）是
// "error"（状态未知），不是 "missing"（来源被删）；探测在途 "loading"。
// 任何状态都不改变快照内容（hook 只返回状态 Map，不裁剪文档）。
//
// 稳定探测键：探测 effect 由「按 kind+id 去重排序后的引用集合键」驱动——
// 正文编辑/拖动等引用集合不变的文档变化不得重发查询。

let mockFromResult: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};
/** 探测查询（.is()）默认实现：读 mockFromResult；测试可用 mockImplementationOnce 注入慢响应 */
const isMock = vi.fn(async () => mockFromResult);
/** 探测查询次数（每次 .from() 计 1） */
let queryCount = 0;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (_table: string) => {
      queryCount += 1;
      return {
        select: () => ({
          in: () => ({
            is: () => isMock(),
          }),
        }),
      };
    },
  }),
}));

const { useSourceStatus, statusOf } = await import("./use-source-status");
const { collectSourceRefs } = await import("@/lib/canvas/source-ref");

type Doc = Parameters<typeof useSourceStatus>[0];

const emptyDoc = {
  schemaVersion: 2,
  boards: [],
  freeItems: [],
} as unknown as Doc;

/** 含一个 materialCard 的最小 v2 文档；text 可变，用于模拟「只改正文」的编辑 */
function docWithReadingRef(id: string, text = "摘录"): Doc {
  const block = {
    id: "blk-1",
    type: "materialCard",
    title: "引用卡",
    text,
    sourceRef: { kind: "reading", id, title: "来源" },
  };
  return {
    schemaVersion: 2,
    freeItems: [],
    boards: [
      {
        id: "b1",
        sections: [],
        regions: [
          { id: "r1", name: "区块", style: {}, sections: [{ id: "s1", columns: [{ id: "c1", blocks: [block] }] }] },
        ],
      },
    ],
  } as unknown as Doc;
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderHook(initialDoc: Doc = docWithReadingRef("src-1")) {
  let latest: ReturnType<typeof useSourceStatus>;
  let applyDoc: ((d: Doc) => void) | null = null;
  function Probe() {
    const [value, setValue] = useState(initialDoc);
    applyDoc = setValue;
    latest = useSourceStatus(value);
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    get: () => latest,
    /** 模拟一次文档编辑：传入新的文档对象（引用集合可同可异） */
    setDoc: (next: Doc) => {
      act(() => applyDoc?.(next));
    },
  };
}

describe("useSourceStatus 状态机（阶段 5 修正）", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFromResult = { data: [], error: null };
    queryCount = 0;
    isMock.mockReset();
    isMock.mockImplementation(async () => mockFromResult);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("查询成功但无行 → missing（真实来源不可用）", async () => {
    const h = renderHook();
    await flush();
    expect(h.get().get("reading:src-1")).toBe("missing");
  });

  it("查询成功有行 → ok", async () => {
    mockFromResult = { data: [{ id: "src-1" }], error: null };
    const h = renderHook();
    await flush();
    expect(h.get().get("reading:src-1")).toBe("ok");
  });

  it("查询失败（网络/服务异常）→ error（状态未知），不是 missing", async () => {
    mockFromResult = { data: null, error: { message: "fetch failed" } };
    const h = renderHook();
    await flush();
    expect(h.get().get("reading:src-1")).toBe("error");
  });

  it("statusOf：未探测的引用按 loading（渲染按可用，不误报）", () => {
    const map = new Map();
    expect(statusOf(map, { kind: "memo", id: "x" } as never)).toBe("loading");
  });

  it("引用集合为空 → 空 Map（无探测请求）", async () => {
    const h = renderHook(emptyDoc);
    await flush();
    expect(h.get().size).toBe(0);
    expect(queryCount).toBe(0);
    expect(collectSourceRefs(emptyDoc)).toHaveLength(0);
  });
});

describe("useSourceStatus 稳定探测键", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFromResult = { data: [], error: null };
    queryCount = 0;
    isMock.mockReset();
    isMock.mockImplementation(async () => mockFromResult);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("正文变化但引用集合不变 → 不重发查询，状态保持", async () => {
    mockFromResult = { data: [{ id: "src-1" }], error: null };
    const h = renderHook(docWithReadingRef("src-1", "v1"));
    await flush();
    expect(h.get().get("reading:src-1")).toBe("ok");
    const before = queryCount;
    h.setDoc(docWithReadingRef("src-1", "v2"));
    await flush();
    expect(queryCount).toBe(before);
    expect(h.get().get("reading:src-1")).toBe("ok");
  });

  it("引用集合变化 → 重新查询并重建状态", async () => {
    mockFromResult = { data: [{ id: "src-1" }], error: null };
    const h = renderHook(docWithReadingRef("src-1", "v1"));
    await flush();
    expect(h.get().get("reading:src-1")).toBe("ok");
    const before = queryCount;
    mockFromResult = { data: [], error: null };
    h.setDoc(docWithReadingRef("src-2", "v1"));
    await flush();
    expect(queryCount).toBe(before + 1);
    expect(h.get().get("reading:src-2")).toBe("missing");
    expect(h.get().has("reading:src-1")).toBe(false);
  });

  it("迟到响应防护：旧探测的响应不得覆盖新状态", async () => {
    let resolveFirst!: (value: { data: unknown; error: { message: string } | null }) => void;
    const firstProbe = new Promise<{ data: unknown; error: { message: string } | null }>((resolve) => {
      resolveFirst = resolve;
    });
    isMock.mockImplementationOnce(() => firstProbe);
    mockFromResult = { data: [], error: null };

    const h = renderHook(docWithReadingRef("src-1", "v1"));
    h.setDoc(docWithReadingRef("src-2", "v1"));
    await flush();
    expect(h.get().get("reading:src-2")).toBe("missing");

    await act(async () => {
      resolveFirst({ data: [{ id: "src-1" }], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.get().get("reading:src-2")).toBe("missing");
    expect(h.get().has("reading:src-1")).toBe(false);
  });
});
