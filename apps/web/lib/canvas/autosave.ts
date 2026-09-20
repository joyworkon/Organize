/**
 * 画布自动保存控制器（docs/idea-canvas-plan.md §6.4）。
 *
 * 规则：
 * - 停止编辑约 800ms 后保存；单文档请求串行（同一时刻最多一个在途请求），
 *   保存期间的编辑合并进最新待保存快照；
 * - 旧响应不得把新内容标记为已保存（只接受「本次提交的快照」的响应）；
 * - conflict / not-found 时暂停自动写回，由 UI 提供冲突恢复；
 * - 网络错误进入重试循环（间隔 8s），期间状态为 error（仅保存在本机）。
 *
 * 提交器注入，便于单测（vitest 无 fetch/IndexedDB 依赖）。
 */

export interface AutosaveSnapshot {
  title: string;
  docJson: unknown;
  expectedRevision: number;
  /** 本地序号，用于区分「这次快照」与迟到响应。 */
  localSeq: number;
}

export type AutosaveSubmitter = (
  snapshot: AutosaveSnapshot,
) => Promise<
  | { ok: true; revision: number }
  | { ok: false; reason: "conflict"; currentRevision: number }
  | { ok: false; reason: "not-found" | "network" | "invalid" | "unauthorized" }
>;

export type AutosaveState = "idle" | "pending" | "saving" | "error" | "conflict" | "paused";

export interface AutosaveOptions {
  debounceMs?: number;
  retryMs?: number;
}

export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: { snapshot: AutosaveSnapshot } | null = null;
  private latest: AutosaveSnapshot | null = null;
  private paused = false;
  private destroyed = false;

  constructor(
    private readonly submitter: AutosaveSubmitter,
    private readonly onChange: (state: AutosaveState, detail?: { currentRevision?: number }) => void,
    private readonly options: AutosaveOptions = {},
  ) {}

  get state(): AutosaveState {
    if (this.paused) return this.latest || this.inflight ? "paused" : "idle";
    if (this.inflight) return "saving";
    if (this.retryTimer) return "error";
    if (this.timer) return "pending";
    return "idle";
  }

  /** 有未落库的本地更改。 */
  get hasPending(): boolean {
    return this.latest !== null || this.inflight !== null;
  }

  /** 编辑后调用：合并快照并重新计时。 */
  schedule(snapshot: AutosaveSnapshot): void {
    if (this.destroyed || this.paused) return;
    this.latest = snapshot;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.options.debounceMs ?? 800);
  }

  /** 立即保存（切页/关闭前）。返回是否仍有未完成工作。 */
  async flush(): Promise<boolean> {
    if (this.destroyed) return false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.paused) return this.hasPending;
    if (!this.latest) return false;
    if (this.inflight) return true; // 在途请求结束后 flushPending 会带上最新
    // 拷贝打断与 this.latest 的别名关联（后续 null 赋值会让别名收窄成 never）
    const snapshot: AutosaveSnapshot = { ...this.latest };
    const snapshotSeq = snapshot.localSeq;
    this.latest = null;
    this.inflight = { snapshot };
    this.onChange("saving");
    let outcome: Awaited<ReturnType<AutosaveSubmitter>>;
    try {
      outcome = await this.submitter(snapshot);
    } catch {
      outcome = { ok: false, reason: "network" };
    }
    this.inflight = null;
    if (this.destroyed) return false;

    if (outcome.ok) {
      this.onChange("idle", { currentRevision: outcome.revision });
      if (this.latest) {
        void this.flush(); // 串行补发保存期间的编辑
        return true;
      }
      return false;
    }

    if (outcome.reason === "conflict" || outcome.reason === "not-found") {
      this.paused = true;
      this.onChange(outcome.reason === "conflict" ? "conflict" : "error", {
        currentRevision: outcome.reason === "conflict" ? outcome.currentRevision : undefined,
      });
      // 未保存快照退回 latest，恢复后可重试
      if (!this.latest) this.latest = snapshot;
      return true;
    }

    // 网络等错误：退回 latest 并安排重试（显式宽化，绕过 TS 属性别名收窄误报）
    const pendingLatest = this.latest as AutosaveSnapshot | null;
    if (!pendingLatest || pendingLatest.localSeq < snapshotSeq) {
      this.latest = snapshot;
    }
    this.scheduleRetry();
    return true;
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer) return;
    this.onChange("error");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.options.retryMs ?? 8000);
  }

  /** 冲突解决（拉远端/另存副本）后调用，恢复自动写回。 */
  resume(expectedRevision: number): void {
    this.paused = false;
    if (this.latest) {
      this.latest = { ...this.latest, expectedRevision };
    }
    if (this.latest) void this.flush();
  }

  /** 外部已保存（例如冲突解决选择了远端版本），丢弃待保存快照。 */
  discardPending(): void {
    this.latest = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }
}
