import { describe, expect, it, vi } from "vitest";
import { AutosaveController, type AutosaveSnapshot, type AutosaveSubmitter } from "./autosave";

type SubmitOutcome = Awaited<ReturnType<AutosaveSubmitter>>;

function snap(seq: number, revision = 1): AutosaveSnapshot {
  return { title: `t${seq}`, docJson: { seq }, expectedRevision: revision, localSeq: seq };
}

/** 简单可控的提交器：按预设响应依次返回，并记录收到的快照。 */
function makeSubmitter(responses: SubmitOutcome[]) {
  const received: AutosaveSnapshot[] = [];
  const resolvers: Array<(v: SubmitOutcome) => void> = [];
  const submit = vi.fn((snapshot: AutosaveSnapshot) => {
    received.push(snapshot);
    const next = responses.shift();
    if (next) return Promise.resolve(next);
    return new Promise<SubmitOutcome>((resolve) => resolvers.push(resolve));
  });
  return {
    submit: submit as unknown as AutosaveSubmitter,
    mock: submit.mock,
    received,
    resolveNext: (value: SubmitOutcome) => {
      const r = resolvers.shift();
      if (r) r(value);
    },
  };
}

describe("AutosaveController", () => {
  it("停止编辑 800ms 后保存一次，期间编辑合并为最新快照", async () => {
    vi.useFakeTimers();
    const { submit, received } = makeSubmitter([{ ok: true, revision: 2 }]);
    const c = new AutosaveController(submit, () => {}, { debounceMs: 800 });
    c.schedule(snap(1));
    c.schedule(snap(2));
    c.schedule(snap(3));
    await vi.advanceTimersByTimeAsync(799);
    expect(received).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toHaveLength(1);
    expect(received[0].title).toBe("t3"); // 只保存最新
    vi.useRealTimers();
  });

  it("串行：在途请求期间的编辑排队补发，不并发", async () => {
    const { submit, received, resolveNext } = makeSubmitter([]);
    const c = new AutosaveController(submit, () => {}, { debounceMs: 10 });
    c.schedule(snap(1));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    c.schedule(snap(2)); // 保存在途时继续编辑
    resolveNext({ ok: true, revision: 2 });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1].localSeq).toBe(2);
  });

  it("冲突：暂停自动写回并上报 currentRevision；resume 后恢复", async () => {
    const { submit, received } = makeSubmitter([
      { ok: false, reason: "conflict", currentRevision: 7 },
      { ok: true, revision: 8 },
    ]);
    const c = new AutosaveController(submit, () => {}, { debounceMs: 10 });
    c.schedule(snap(1));
    await vi.waitFor(() => expect(c.state).toBe("paused"));
    c.resume(7);
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1].expectedRevision).toBe(7);
  });

  it("网络错误：进入重试循环，成功后回到 idle", async () => {
    const { submit } = makeSubmitter([
      { ok: false, reason: "network" },
      { ok: true, revision: 3 },
    ]);
    const seen: string[] = [];
    const c = new AutosaveController(submit, (s) => seen.push(s), { debounceMs: 10, retryMs: 50 });
    c.schedule(snap(1));
    await vi.waitFor(() => expect(c.state).toBe("error"));
    await vi.waitFor(() => expect(c.state).toBe("idle"), { timeout: 2000 });
    expect(seen).toContain("error");
  });

  it("not-found 与 conflict 一样暂停（不复活已删除文档）", async () => {
    const { submit } = makeSubmitter([{ ok: false, reason: "not-found" }]);
    const c = new AutosaveController(submit, () => {}, { debounceMs: 10 });
    c.schedule(snap(1));
    await vi.waitFor(() => expect(c.state).toBe("paused"));
  });

  it("destroy 后不再保存", async () => {
    const { submit, received } = makeSubmitter([{ ok: true, revision: 2 }]);
    const c = new AutosaveController(submit, () => {}, { debounceMs: 10 });
    c.destroy();
    c.schedule(snap(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });
});
