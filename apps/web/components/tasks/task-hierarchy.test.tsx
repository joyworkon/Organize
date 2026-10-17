// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TaskHierarchy 完成重复子任务时下一实例生成失败诚实提示的组件测试。
 * 子任务查询走 from("tasks") 的 thenable builder；完成走真实 applyTaskUpdate /
 * requestNextRecurringTask（只 mock supabase client 的 rpc），覆盖
 * 「complete_recurring_task RPC error → destructive toast 且不回滚完成状态」
 * 与「none（无需生成）→ 保持沉默」。
 */

const mocks = vi.hoisted(() => ({
  recurringRpc: { data: null as string | null, error: null as Error | null },
  toast: vi.fn(),
  router: { push: vi.fn() },
  children: [] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => {
  const client = {
    from: (table: string) => {
      if (table !== "tasks") throw new Error(`Unexpected table ${table}`);
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        then: (
          onfulfilled: (value: { data: unknown; error: unknown }) => unknown,
          onrejected?: (error: unknown) => unknown,
        ) => Promise.resolve({ data: mocks.children, error: null }).then(onfulfilled, onrejected),
      };
      return query;
    },
    rpc: (name: string) => {
      if (name === "update_task_atomic") {
        return Promise.resolve({ data: { status: "applied", sync_version: 2 }, error: null });
      }
      if (name === "complete_recurring_task") {
        return Promise.resolve(mocks.recurringRpc);
      }
      return Promise.resolve({ data: null, error: new Error(`Unexpected rpc ${name}`) });
    },
  };
  return { createClient: () => client };
});
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import { TaskHierarchy } from "./task-hierarchy";
import type { Task } from "@organize/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "parent-1",
    user_id: "u1",
    title: "父任务",
    description: null,
    status: "todo",
    priority: "medium",
    category: "work",
    due_date: null,
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    deleted_at: null,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    ...overrides,
  };
}

function makeChild(): Task {
  return makeTask({ id: "child-1", title: "重复子任务", parent_task_id: "parent-1", status: "todo", sync_version: 1 });
}

let container: HTMLDivElement;
let root: Root;

function render(task: Task) {
  return act(async () => {
    root.render(createElement(TaskHierarchy, { task }));
  });
}

/** 勾选第一个子任务的完成复选框 */
async function completeFirstChild() {
  const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]');
  expect(checkbox).not.toBeNull();
  await act(async () => {
    checkbox!.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recurringRpc = { data: null, error: null };
  mocks.children = [makeChild()];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  try {
    act(() => root.unmount());
  } catch {
    /* 已卸载 */
  }
  container.remove();
});

describe("TaskHierarchy 完成重复子任务的下一实例生成失败诚实提示", () => {
  it("complete_recurring_task RPC 失败：弹 destructive toast，且完成状态不回滚", async () => {
    mocks.recurringRpc = { data: null, error: new Error("boom") };
    await render(makeTask());

    await completeFirstChild();

    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "子任务已完成，但下一次重复任务生成失败",
      description: "boom",
      variant: "destructive",
    }));
    // 完成本身已成功：复选框保持勾选
    expect(container.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
  });

  it("无需生成下一实例（none）：保持沉默不弹 toast", async () => {
    await render(makeTask());

    await completeFirstChild();

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(container.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
  });
});
