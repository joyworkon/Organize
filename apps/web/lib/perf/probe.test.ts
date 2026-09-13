// B02 性能仪表单测：node 环境安全 no-op + 记录/聚合口径。
// 浏览器端观察器（longtask/INP）依赖真实 PerformanceObserver，由
// scripts/perf 测量驱动在真实 Chromium 里验证。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProbe,
  enablePerfProbe,
  getPerfProbe,
  type OrganizePerfProbe,
} from "./probe";

describe("性能仪表（B02 修复 R12 savePosts/draftSize 捕获缺口）", () => {
  describe("createProbe 记录与聚合", () => {
    let probe: OrganizePerfProbe;

    beforeEach(() => {
      probe = createProbe();
    });

    it("savePosts 计数：成功与失败分开累计，超上限滚动丢弃", () => {
      for (let i = 0; i < 510; i++) {
        probe.recordSave({
          rpcName: "save_note_with_tasks",
          durationMs: 10,
          contentBytes: 100,
          ok: i % 10 !== 0,
          at: "2026-09-13T00:00:00.000Z",
        });
      }
      expect(probe.savePosts).toBe(510);
      expect(probe.saveFailures).toBe(51);
      expect(probe.saves.length).toBe(500); // 上限滚动
      const snapshot = probe.snapshot();
      expect(snapshot.savePosts).toBe(510);
      expect(snapshot.avgSaveMs).toBe(10);
    });

    it("draftSize：last/max 口径分离", () => {
      probe.recordDraft({ bytes: 100, durationMs: 1, status: "ok", at: "x" });
      probe.recordDraft({ bytes: 300, durationMs: 2, status: "ok", at: "x" });
      probe.recordDraft({ bytes: 200, durationMs: 1, status: "ok", at: "x" });
      expect(probe.draftWrites).toBe(3);
      expect(probe.draftBytesLast).toBe(200);
      expect(probe.draftBytesMax).toBe(300);
    });

    it("INP 原料：interaction 取最大 event duration，快照给 max/p75", () => {
      probe.interactions.set(1, 50);
      probe.interactions.set(2, 200);
      probe.interactions.set(3, 80);
      const snapshot = probe.snapshot();
      expect(snapshot.inpMaxMs).toBe(200);
      expect(snapshot.inpP75Ms).toBe(200); // 3 个样本 p75 落在最大段
    });

    it("reset 清空全部累计", () => {
      probe.recordSave({ rpcName: "r", durationMs: 5, contentBytes: 1, ok: true, at: "x" });
      probe.recordDraft({ bytes: 1, durationMs: 1, status: "ok", at: "x" });
      probe.reset();
      expect(probe.snapshot().savePosts).toBe(0);
      expect(probe.draftWrites).toBe(0);
    });
  });

  describe("无 window 环境（SSR / Vitest node）安全", () => {
    it("enablePerfProbe / getPerfProbe 返回 null 且不抛", () => {
      expect(enablePerfProbe()).toBeNull();
      expect(getPerfProbe()).toBeNull();
    });
  });

  describe("window 环境", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {} as unknown as Window & typeof globalThis);
      // PerformanceObserver 缺省未定义 → 观察器分支跳过，计数仪表仍工作
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("挂载 window.__organizePerf 并幂等复用同一实例", () => {
      const first = enablePerfProbe();
      const second = enablePerfProbe();
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(window.__organizePerf).toBe(first);
    });

    it("应用层上报与人工抽查同源（snapshot 可见 savePosts/draftSize）", () => {
      const probe = enablePerfProbe()!;
      probe.recordSave({
        rpcName: "save_note_with_tasks",
        durationMs: 42,
        contentBytes: 1234,
        ok: true,
        at: "x",
      });
      probe.recordDraft({ bytes: 5678, durationMs: 3, status: "ok", at: "x" });
      const snapshot = window.__organizePerf!.snapshot();
      expect(snapshot.savePosts).toBe(1);
      expect(snapshot.draftBytesLast).toBe(5678);
      expect(snapshot.avgSaveMs).toBe(42);
    });
  });
});
