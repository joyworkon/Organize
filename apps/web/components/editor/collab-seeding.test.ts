// @vitest-environment jsdom
/**
 * 协作播种租约协议控制器（B05 自 tiptap-editor 隔离的状态机）：
 * - 并发冷启动只播种一次：grant 只在房间为空时写一次快照（服务端租约仲裁在
 *   collab-server seed-lease.ts，客户端合同由本套用例钉住）
 * - 断线恢复不重复：内容到达后再次 synced 不再发 seed-req
 * - 阻塞态合同：空房 + 有快照 = 阻塞；grant/deny/内容到达 = 解除
 * - seed-wait 重试封顶、deny 观察窗、detach 清理
 */
import { describe, expect, it, vi } from "vitest";
import {
  createCollabSeedController,
  type CollabSeedEditorLike,
  type CollabSeedProviderLike,
} from "./collab-seeding";

function createFakeEditor(initialEmpty = true) {
  const state = { isEmpty: initialEmpty, isDestroyed: false };
  const updateFns = new Set<() => void>();
  const setContentCalls: { content: Record<string, unknown>; emitUpdate: boolean }[] = [];
  const editor: CollabSeedEditorLike = {
    get isEmpty() {
      return state.isEmpty;
    },
    get isDestroyed() {
      return state.isDestroyed;
    },
    setContent(content, emitUpdate) {
      setContentCalls.push({ content, emitUpdate });
      // 与真实 setContent 一致：写入后文档非空
      state.isEmpty = false;
    },
    onUpdate(fn) {
      updateFns.add(fn);
    },
    offUpdate(fn) {
      updateFns.delete(fn);
    },
  };
  return {
    editor,
    state,
    setContentCalls,
    /** 模拟文档更新（远端同步或本地输入都会走编辑器 update 事件） */
    emitDocUpdate() {
      for (const fn of [...updateFns]) fn();
    },
  };
}

function createFakeProvider(initialSynced = false) {
  const state = { isSynced: initialSynced };
  const syncedFns = new Set<() => void>();
  const statelessFns = new Set<(message: { payload: string }) => void>();
  const sentPayloads: string[] = [];
  const provider: CollabSeedProviderLike = {
    get isSynced() {
      return state.isSynced;
    },
    onSynced(fn) {
      syncedFns.add(fn);
    },
    offSynced(fn) {
      syncedFns.delete(fn);
    },
    onStateless(fn) {
      statelessFns.add(fn);
    },
    offStateless(fn) {
      statelessFns.delete(fn);
    },
    sendStateless(payload) {
      sentPayloads.push(payload);
    },
  };
  return {
    provider,
    sentPayloads,
    /** 模拟服务端 stateless 消息（对象自动序列化，与 sendStateless 对称） */
    receive(message: unknown) {
      for (const fn of [...statelessFns]) fn({ payload: JSON.stringify(message) });
    },
    /** 模拟损坏 payload */
    receiveRaw(payload: string) {
      for (const fn of [...statelessFns]) fn({ payload });
    },
    /** 模拟首次同步完成 / 断线重连后再次同步 */
    markSynced() {
      state.isSynced = true;
      for (const fn of [...syncedFns]) fn();
    },
  };
}

function createHarness(seedContent: Record<string, unknown> | null, providerSynced = false) {
  const ed = createFakeEditor();
  const pv = createFakeProvider(providerSynced);
  const blockedStates: boolean[] = [];
  const onDenyTimeout = vi.fn();
  const controller = createCollabSeedController({
    editor: ed.editor,
    provider: pv.provider,
    seedContent,
    callbacks: {
      onBlockedChange: (blocked) => blockedStates.push(blocked),
      onDenyTimeout,
    },
  });
  return { ed, pv, blockedStates, onDenyTimeout, controller };
}

const SEED = { type: "doc", content: [{ type: "paragraph" }] };

describe("createCollabSeedController", () => {
  it("attach 即已 synced + 房间空 + 有快照：立即申请播种并进入阻塞态", () => {
    const h = createHarness(SEED, true);
    expect(h.pv.sentPayloads).toEqual([JSON.stringify({ t: "seed-req" })]);
    expect(h.blockedStates).toEqual([true]);
  });

  it("无快照（空笔记）：不阻塞、不申请播种", () => {
    const h = createHarness(null, true);
    expect(h.pv.sentPayloads).toEqual([]);
    expect(h.blockedStates).toEqual([false]);
    h.pv.markSynced();
    expect(h.pv.sentPayloads).toEqual([]);
  });

  it("synced 晚于 attach：事件到达时才申请；房间非空则不申请", () => {
    const h = createHarness(SEED);
    expect(h.pv.sentPayloads).toEqual([]);
    h.pv.markSynced();
    expect(h.pv.sentPayloads).toEqual([JSON.stringify({ t: "seed-req" })]);

    // 模拟断线重连后再次 synced，此时房间已有内容：不再申请（断线恢复不重复）
    h.ed.state.isEmpty = false;
    h.pv.markSynced();
    expect(h.pv.sentPayloads).toHaveLength(1);
  });

  it("seed-grant：用 DB 快照播种一次且 emitUpdate=false；重复 grant 不再写", () => {
    const h = createHarness(SEED, true);
    h.pv.receive({ t: "seed-grant" });
    expect(h.ed.setContentCalls).toEqual([{ content: SEED, emitUpdate: false }]);
    expect(h.blockedStates.at(-1)).toBe(false);

    h.pv.receive({ t: "seed-grant" });
    expect(h.ed.setContentCalls).toHaveLength(1);
  });

  it("seed-wait：2.5s 重问，至多 3 次后封顶（首问 + 3 次重问 = 4 次）", () => {
    vi.useFakeTimers();
    try {
      const h = createHarness(SEED, true);
      h.pv.receive({ t: "seed-wait" });
      h.pv.receive({ t: "seed-wait" });
      h.pv.receive({ t: "seed-wait" });
      // 封顶后多余的 wait 不再安排重试
      h.pv.receive({ t: "seed-wait" });
      h.pv.receive({ t: "seed-wait" });
      vi.advanceTimersByTime(2_500 * 5);
      expect(h.pv.sentPayloads).toHaveLength(4);
      expect(h.pv.sentPayloads.every((p) => p === JSON.stringify({ t: "seed-req" }))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("seed-deny：立即解除阻塞；观察窗后仍为空才报 onDenyTimeout，且只报一次", () => {
    vi.useFakeTimers();
    try {
      const h = createHarness(SEED, true);
      h.pv.receive({ t: "seed-deny" });
      expect(h.blockedStates.at(-1)).toBe(false);
      expect(h.ed.setContentCalls).toEqual([]);
      expect(h.onDenyTimeout).not.toHaveBeenCalled();

      // 第二条 deny 不叠加观察窗
      h.pv.receive({ t: "seed-deny" });
      vi.advanceTimersByTime(12_000);
      expect(h.onDenyTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deny 观察窗内内容到达：不再报 onDenyTimeout", () => {
    vi.useFakeTimers();
    try {
      const h = createHarness(SEED, true);
      h.pv.receive({ t: "seed-deny" });
      // 内容随同步到达（11s 后）
      vi.advanceTimersByTime(11_000);
      h.ed.state.isEmpty = false;
      h.ed.emitDocUpdate();
      vi.advanceTimersByTime(1_000);
      expect(h.onDenyTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("内容到达（update 事件）解除阻塞", () => {
    const h = createHarness(SEED, true);
    expect(h.blockedStates.at(-1)).toBe(true);
    h.ed.state.isEmpty = false;
    h.ed.emitDocUpdate();
    expect(h.blockedStates.at(-1)).toBe(false);
    // 解锁后 grant 不再写快照（内容已在房间）
    h.pv.receive({ t: "seed-grant" });
    expect(h.ed.setContentCalls).toEqual([]);
  });

  it("损坏的 stateless payload 被忽略", () => {
    const h = createHarness(SEED, true);
    expect(() => h.pv.receiveRaw("not-json{")).not.toThrow();
    expect(h.ed.setContentCalls).toEqual([]);
    expect(h.blockedStates.at(-1)).toBe(true);
  });

  it("detach：解绑事件、清理定时器并复位阻塞态", () => {
    vi.useFakeTimers();
    try {
      const h = createHarness(SEED, true);
      h.pv.receive({ t: "seed-wait" });
      h.controller.detach();
      const sendsBefore = h.pv.sentPayloads.length;
      vi.advanceTimersByTime(60_000);
      h.pv.markSynced();
      h.pv.receive({ t: "seed-grant" });
      expect(h.pv.sentPayloads).toHaveLength(sendsBefore);
      expect(h.ed.setContentCalls).toEqual([]);
      expect(h.blockedStates.at(-1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("编辑器销毁后：grant 不写入、观察窗不报", () => {
    vi.useFakeTimers();
    try {
      const h = createHarness(SEED, true);
      h.ed.state.isDestroyed = true;
      h.pv.receive({ t: "seed-grant" });
      expect(h.ed.setContentCalls).toEqual([]);
      h.pv.receive({ t: "seed-deny" });
      vi.advanceTimersByTime(12_000);
      expect(h.onDenyTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
