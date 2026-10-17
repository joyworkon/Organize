// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TaskDependencies 加载诚实提示的组件测试：
 * load 的 tasks / task_dependencies 两路查询挂起在外部可控的 deferred 上，覆盖
 * 「依赖失败出 alert + 重试且无假空状态」「重试成功恢复」「重载失败不覆盖上次成功数据」
 * 「切任务清空」「晚到响应丢弃」。
 */

interface Deferred {
  promise: Promise<{ data: unknown; error: unknown }>;
  resolve: (value: { data: unknown; error: unknown }) => void;
}

function makeDeferred(): Deferred {
  let resolve!: Deferred["resolve"];
  const promise = new Promise<{ data: unknown; error: unknown }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface QueryRecord {
  table: string;
  deferred: Deferred;
}

/** load 并行查询的 2 张表（与组件内 Promise.all 顺序一致） */
const LOAD_TABLES = ["tasks", "task_dependencies"] as const;
type LoadTable = (typeof LOAD_TABLES)[number];

function createFakeSupabase() {
  const queries: QueryRecord[] = [];
  const client = {
    // 增删依赖的 RPC：默认成功，用于触发「操作成功后的重载」路径
    rpc: async () => ({ error: null }),
    from(table: string) {
      // from() 时立即注册查询记录：注册时机不能依赖 then 被调用（那要等 Promise.all 的微任务），
      // 否则测试在 render 后同步 resolve 时找不到记录
      const deferred = makeDeferred();
      queries.push({ table, deferred });
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        then(
          onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return deferred.promise.then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client, queries };
}

const state = vi.hoisted(() => ({ supabase: createFakeSupabase() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => state.supabase.client,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { TaskDependencies } from "./task-dependencies";
import type { Task, TaskDependency } from "@organize/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTask(id: string): Task {
  return {
    id,
    user_id: "u1",
    title: `任务 ${id}`,
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
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
  };
}

/** task_id 是后置任务、depends_on_task_id 是前置任务（041 迁移语义） */
function edge(taskId: string, dependsOnTaskId: string): TaskDependency {
  return {
    task_id: taskId,
    depends_on_task_id: dependsOnTaskId,
    user_id: "u1",
    created_at: "2026-10-17T00:00:00Z",
  };
}

function roundQuery(round: number, table: LoadTable): QueryRecord {
  const record = state.supabase.queries.filter((q) => q.table === table)[round];
  if (!record) throw new Error(`缺少第 ${round} 轮 ${table} 查询`);
  return record;
}

/** 放行一整轮 2 个查询；默认全部成功空数据，overrides 指定某表的数据或错误 */
async function resolveRound(
  round: number,
  overrides: Partial<Record<LoadTable, { data?: unknown[]; error?: unknown }>> = {},
) {
  await act(async () => {
    for (const table of LOAD_TABLES) {
      const override = overrides[table] ?? {};
      roundQuery(round, table).deferred.resolve({
        data: override.data ?? [],
        error: override.error ?? null,
      });
    }
  });
}

function alertEl() {
  return container.querySelector('[role="alert"]');
}

function retryButton() {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("重试"));
}

function candidateSelect() {
  return container.querySelector<HTMLSelectElement>('select[aria-label="选择前置任务"]');
}

/** 两组任务数据：默认 round 0 给 task-a / task-b 两行 */
const TWO_TASKS = () => [makeTask("task-a"), makeTask("task-b")];

let container: HTMLDivElement;
let root: Root;

function render(task: Task) {
  act(() => {
    root.render(createElement(TaskDependencies, { task }));
  });
}

beforeEach(() => {
  state.supabase = createFakeSupabase();
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

describe("TaskDependencies 加载失败诚实提示", () => {
  it("依赖查询失败：出现 role=alert 提示与重试；不显示假空状态，下拉与添加禁用", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { error: { message: "network down" } },
    });

    const alert = alertEl();
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("依赖关系加载失败，显示的内容可能不完整");
    expect(retryButton()).toBeTruthy();
    // 依赖未成功加载过：不得冒充「没有依赖」
    expect(container.textContent).not.toContain("暂无前置任务");
    expect(container.textContent).not.toContain("暂无后置任务");
    expect(container.textContent).toContain("依赖关系暂时无法加载");
    // 数据不全时禁止添加依赖（环检测需要完整依赖数据）
    expect(candidateSelect()!.disabled).toBe(true);
  });

  it("重试成功：提示消失、下拉恢复，并显示真实依赖", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      task_dependencies: { error: { message: "network down" } },
    });
    expect(alertEl()).not.toBeNull();

    await act(async () => {
      retryButton()!.click();
    });
    await resolveRound(1, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { data: [edge("task-a", "task-b")] },
    });

    expect(alertEl()).toBeNull();
    // task-a 的前置任务 = task-b
    expect(container.textContent).toContain("任务 task-b");
    expect(container.textContent).not.toContain("暂无前置任务");
    expect(candidateSelect()!.disabled).toBe(false);
  });

  it("移除依赖后的重载失败：不用空数组覆盖上次成功的依赖数据", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { data: [edge("task-a", "task-b")] },
    });
    expect(container.textContent).toContain("任务 task-b");

    // 移除依赖成功 → 组件重载（round 1）：此时依赖查询失败
    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="移除前置任务 任务 task-b"]',
    );
    expect(removeButton).toBeTruthy();
    await act(async () => {
      removeButton!.click();
    });
    await resolveRound(1, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { error: { message: "500" } },
    });

    // 失败部分保留上次成功数据，提示条如实说明
    expect(container.textContent).toContain("任务 task-b");
    expect(alertEl()?.textContent).toContain("依赖关系加载失败");
  });

  it("切换任务：立即清空上一任务的依赖数据与失败提示（新请求挂起中）", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      tasks: { data: TWO_TASKS() },
      // task-a 的后置任务 = task-b
      task_dependencies: { data: [edge("task-b", "task-a")] },
    });
    expect(container.textContent).toContain("任务 task-b");

    render(makeTask("task-b"));

    // 新任务的查询还在挂起：上一任务的数据与失败状态都不能留给它
    expect(container.textContent).not.toContain("任务 task-b");
    expect(alertEl()).toBeNull();
    expect(container.textContent).toContain("依赖关系暂时无法加载");

    await resolveRound(1, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { data: [edge("task-b", "task-a")] },
    });
    // task-b 的前置任务 = task-a
    expect(container.textContent).toContain("任务 task-a");
  });

  it("旧任务的晚到响应被丢弃，不覆盖新任务状态", async () => {
    render(makeTask("task-a"));
    // task-a 的 2 个查询挂起中就切到 task-b
    render(makeTask("task-b"));

    // task-a 的慢响应现在才到（task-a 有一条前置 task-b）：应被丢弃
    await resolveRound(0, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { data: [edge("task-a", "task-b")] },
    });
    // 若未被丢弃：dependenciesLoaded 会变 true 且 deps 被写入，task-b 将显示假数据
    expect(container.textContent).toContain("依赖关系暂时无法加载");
    expect(candidateSelect()!.disabled).toBe(true);

    // task-b 的响应到达：正常显示（task-a 是它的前置）
    await resolveRound(1, {
      tasks: { data: TWO_TASKS() },
      task_dependencies: { data: [edge("task-b", "task-a")] },
    });
    expect(container.textContent).toContain("任务 task-a");
    expect(alertEl()).toBeNull();
  });
});
