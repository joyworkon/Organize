// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 阶段 5 修正：use-source-status 状态机——查询失败（网络/服务异常）是
// "error"（状态未知），不是 "missing"（来源被删）；探测在途 "loading"。
// 任何状态都不改变快照内容（hook 只返回状态 Map，不裁剪文档）。

let mockFromResult: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        in: () => ({
          is: async () => mockFromResult,
        }),
      }),
    }),
  }),
}));

const { useSourceStatus, statusOf } = await import("./use-source-status");
const { collectSourceRefs } = await import("@/lib/canvas/source-ref");

const doc = {
  schemaVersion: 2,
  boards: [],
  freeItems: [],
  // collectSourceRefs 只读 block 的 sourceRef 字段；用最小伪造文档
} as unknown as Parameters<typeof useSourceStatus>[0];

// 直接构造 sourceRef 集合路径：伪造 doc 走不通（collectSourceRefs 需要完整结构），
// 改为把 hook 的输入文档换成含一个 materialCard 的最小 v2 文档
const digestDoc = (() => {
  const block = {
    id: "blk-1",
    type: "materialCard",
    title: "引用卡",
    text: "摘录",
    sourceRef: { kind: "reading", id: "src-1", title: "来源" },
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
  } as unknown as Parameters<typeof useSourceStatus>[0];
})();

let container: HTMLDivElement;
let root: Root;

function renderHook() {
  let latest: ReturnType<typeof useSourceStatus>;
  function Probe() {
    latest = useSourceStatus(digestDoc);
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return () => latest;
}

describe("useSourceStatus 状态机（阶段 5 修正）", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFromResult = { data: [], error: null };
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("查询成功但无行 → missing（真实来源不可用）", async () => {
    const get = renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const map = get();
    expect(map.get("reading:src-1")).toBe("missing");
  });

  it("查询成功有行 → ok", async () => {
    mockFromResult = { data: [{ id: "src-1" }], error: null };
    const get = renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(get().get("reading:src-1")).toBe("ok");
  });

  it("查询失败（网络/服务异常）→ error（状态未知），不是 missing", async () => {
    mockFromResult = { data: null, error: { message: "fetch failed" } };
    const get = renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(get().get("reading:src-1")).toBe("error");
  });

  it("statusOf：未探测的引用按 loading（渲染按可用，不误报）", () => {
    const map = new Map();
    expect(statusOf(map, { kind: "memo", id: "x" } as never)).toBe("loading");
  });

  it("引用集合为空 → 空 Map（无探测请求）", async () => {
    const get = renderHook();
    void get;
    // 空 doc 路径
    const { useSourceStatus: hook } = await import("./use-source-status");
    let latest: ReturnType<typeof hook>;
    function Probe() {
      latest = hook(doc);
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
      await Promise.resolve();
    });
    expect(latest!.size).toBe(0);
    expect(collectSourceRefs(doc)).toHaveLength(0);
  });
});
