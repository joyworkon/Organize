/**
 * 构思画布撤销/重做历史（docs/idea-canvas-plan.md §6.2）。
 *
 * 快照式：past 存「每次操作前」的文档快照，current 由 store 持有。
 * 调用顺序：变更前 push(preState) → 应用命令得到新文档。
 * 连续文本输入合并为一个短事务（800ms 窗口 + coalesceKey：窗口内的后续
 * push 直接跳过，保留这串输入之前的那份快照）；IME 一次提交一个事务；
 * 拖动从按下到松开一个事务（松开时才 push 一次）。
 */

import type { CanvasDoc, CanvasFocus } from "./model";

export interface CanvasHistoryEntry {
  doc: CanvasDoc;
  label: string;
  /** 恢复该快照时对应的焦点目标（A09：内容、ID 与焦点一起原子恢复）。 */
  focus?: CanvasFocus;
}

export interface PushOptions {
  /** 相同 key 且间隔小于 COALESCE_MS 的推送跳过（合并为同一事务）。 */
  coalesceKey?: string;
  time?: number;
  /** 操作后的焦点（redo 时恢复）。 */
  postFocus?: CanvasFocus;
  /** 操作前的焦点（undo 时恢复）。 */
  preFocus?: CanvasFocus;
}

export const COALESCE_MS = 800;

export class CanvasHistory {
  private past: CanvasHistoryEntry[] = [];
  private future: CanvasHistoryEntry[] = [];
  private lastCoalesce: { key: string; time: number } | null = null;
  /** 最近一次 push 记录的操作后焦点（undo/redo 恢复用）。 */
  private lastPostFocus: CanvasFocus = null;

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  peekUndoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  /** 变更前调用：preState 是即将被修改的文档。 */
  push(preState: CanvasDoc, label: string, opts: PushOptions = {}): void {
    const time = opts.time ?? Date.now();
    if (
      opts.coalesceKey &&
      this.lastCoalesce &&
      this.lastCoalesce.key === opts.coalesceKey &&
      time - this.lastCoalesce.time <= COALESCE_MS
    ) {
      // 同一短事务：保留最初的前置快照，跳过中间态。
      this.lastCoalesce.time = time;
      return;
    }
    this.past.push({ doc: preState, label, focus: opts.preFocus });
    if (this.past.length > this.limit) this.past.shift();
    this.lastCoalesce = opts.coalesceKey ? { key: opts.coalesceKey, time } : null;
    this.future = [];
    if (opts.postFocus !== undefined) {
      this.lastPostFocus = opts.postFocus;
    }
  }

  /** 撤销：current 是当前最新文档，压入重做栈；返回操作前的文档与焦点。 */
  undo(current: CanvasDoc): CanvasHistoryEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ doc: current, label: entry.label, focus: this.lastPostFocus });
    this.lastCoalesce = null;
    this.lastPostFocus = entry.focus ?? null;
    return entry;
  }

  /** 重做。 */
  redo(current: CanvasDoc): CanvasHistoryEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ doc: current, label: entry.label, focus: this.lastPostFocus });
    this.lastCoalesce = null;
    this.lastPostFocus = entry.focus ?? null;
    return entry;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastCoalesce = null;
    this.lastPostFocus = null;
  }
}
