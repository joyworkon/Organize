/**
 * B02 性能仪表（修复 R12 两项缺口：savePosts 计数与 draftSize 未捕获）。
 *
 * 设计：
 * - 应用层计数，不再包装 fetch——R12 的坑：supabase-js 在模块加载时捕获了
 *   window.fetch 引用，测量脚本再包装为时已晚。现在 savePosts 由保存会话
 *   （note-save-session.runSaveRound）直接上报，draftSize 由草稿持久化点
 *   （persistDraft）直接上报，计数与真实保存链一一对应，可人工抽查：
 *     浏览器控制台执行 `__organizePerf.snapshot()`（编辑器页打字、⌘S 后）。
 * - longtask / event timing（INP 原料）观察器在首个客户端组件挂载时启用，
 *   覆盖全应用生命周期。
 * - 所有 API 在无 window（SSR / Vitest node 环境）时安全 no-op；
 *   window.__organizePerf 恒定存在（客户端），测量脚本与人工抽查同源。
 */

export interface PerfSaveRecord {
  rpcName: string;
  durationMs: number;
  contentBytes: number;
  ok: boolean;
  at: string;
}

export interface PerfDraftRecord {
  bytes: number;
  durationMs: number;
  status: "ok" | "quota" | "unavailable" | "serialization" | "clear";
  at: string;
}

export interface OrganizePerfProbe {
  savePosts: number;
  saveFailures: number;
  saves: PerfSaveRecord[];
  draftWrites: number;
  draftBytesLast: number;
  draftBytesMax: number;
  drafts: PerfDraftRecord[];
  longTasks: { durationMs: number; at: string }[];
  /** interactionId → 最大 event duration（INP 原料，Chromium event timing） */
  interactions: Map<number, number>;
  serializationMs: number[];
  recordSave(record: PerfSaveRecord): void;
  recordDraft(record: PerfDraftRecord): void;
  recordSerialization(durationMs: number): void;
  snapshot(): Record<string, unknown>;
  reset(): void;
}

const MAX_RECORDS = 500;

export function createProbe(): OrganizePerfProbe {
  return {
    savePosts: 0,
    saveFailures: 0,
    saves: [],
    draftWrites: 0,
    draftBytesLast: 0,
    draftBytesMax: 0,
    drafts: [],
    longTasks: [],
    interactions: new Map(),
    serializationMs: [],
    recordSave(record) {
      this.savePosts += 1;
      if (!record.ok) this.saveFailures += 1;
      this.saves.push(record);
      if (this.saves.length > MAX_RECORDS) this.saves.shift();
    },
    recordDraft(record) {
      this.draftWrites += 1;
      this.draftBytesLast = record.bytes;
      if (record.bytes > this.draftBytesMax) this.draftBytesMax = record.bytes;
      this.drafts.push(record);
      if (this.drafts.length > MAX_RECORDS) this.drafts.shift();
    },
    recordSerialization(durationMs) {
      if (this.serializationMs.length > MAX_RECORDS) this.serializationMs.shift();
      this.serializationMs.push(durationMs);
    },
    snapshot() {
      const interactions = [...this.interactions.entries()];
      const inpSorted = interactions.map(([, d]) => d).sort((a, b) => a - b);
      return {
        savePosts: this.savePosts,
        saveFailures: this.saveFailures,
        lastSave: this.saves[this.saves.length - 1] ?? null,
        avgSaveMs:
          this.saves.length > 0
            ? Math.round(
                this.saves.reduce((sum, s) => sum + s.durationMs, 0) / this.saves.length
              )
            : 0,
        draftWrites: this.draftWrites,
        draftBytesLast: this.draftBytesLast,
        draftBytesMax: this.draftBytesMax,
        lastDraft: this.drafts[this.drafts.length - 1] ?? null,
        longTaskCount: this.longTasks.length,
        longTaskTotalMs: this.longTasks.reduce((sum, t) => sum + t.durationMs, 0),
        longTaskMaxMs: this.longTasks.reduce((max, t) => Math.max(max, t.durationMs), 0),
        inpMaxMs: inpSorted[inpSorted.length - 1] ?? 0,
        inpP75Ms:
          inpSorted.length > 0
            ? inpSorted[Math.min(inpSorted.length - 1, Math.floor(inpSorted.length * 0.75))]
            : 0,
        serializationAvgMs:
          this.serializationMs.length > 0
            ? Math.round(
                (this.serializationMs.reduce((a, b) => a + b, 0) /
                  this.serializationMs.length) *
                  1000
              ) / 1000
            : 0,
        memory:
          typeof performance !== "undefined" &&
          (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
                .usedJSHeapSize
            : null,
      };
    },
    reset() {
      this.savePosts = 0;
      this.saveFailures = 0;
      this.saves = [];
      this.draftWrites = 0;
      this.draftBytesLast = 0;
      this.draftBytesMax = 0;
      this.drafts = [];
      this.longTasks = [];
      this.interactions = new Map();
      this.serializationMs = [];
    },
  };
}

declare global {
  interface Window {
    __organizePerf?: OrganizePerfProbe;
  }
}

/**
 * 启用仪表（客户端一次）：挂 window.__organizePerf + longtask/event 观察器。
 * 重复调用安全；SSR / 测试 node 环境返回 null。
 */
export function enablePerfProbe(): OrganizePerfProbe | null {
  if (typeof window === "undefined") return null;
  if (!window.__organizePerf) {
    window.__organizePerf = createProbe();
  }
  const probe = window.__organizePerf;

  if (typeof PerformanceObserver !== "undefined" && !probeObserved(probe)) {
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({ durationMs: entry.duration, at: new Date().toISOString() });
          if (probe.longTasks.length > MAX_RECORDS) probe.longTasks.shift();
        }
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });

      // INP 原料：event timing 带 interactionId 的条目（Chromium）
      const eventObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const eventEntry = entry as PerformanceEntry & { interactionId?: number };
          const interactionId = eventEntry.interactionId ?? 0;
          if (interactionId > 0) {
            const prev = probe.interactions.get(interactionId) ?? 0;
            if (entry.duration > prev) probe.interactions.set(interactionId, entry.duration);
          }
        }
      });
      eventObserver.observe({ type: "event", buffered: true } as PerformanceObserverInit);
      observedProbes.add(probe);
    } catch {
      // 观察器不可用（旧浏览器）：计数仪表仍然工作
    }
  }
  return probe;
}

const observedProbes = new WeakSet<object>();
function probeObserved(probe: OrganizePerfProbe): boolean {
  return observedProbes.has(probe);
}

/** 无窗口安全读取（测量脚本在 page.evaluate 里直接读 window.__organizePerf） */
export function getPerfProbe(): OrganizePerfProbe | null {
  if (typeof window === "undefined") return null;
  return window.__organizePerf ?? null;
}
