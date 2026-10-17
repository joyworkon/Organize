// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TaskInlineDetail 次要数据加载诚实提示的组件测试：
 * loadChildren 的 5 个并行查询挂起在外部可控的 deferred 上，用来覆盖
 * 「失败出 alert + 重试」「失败不覆盖上次成功数据」「切任务清空」「晚到响应丢弃」。
 * 复杂子组件（日期弹层/提醒/层级/依赖/关联内容/附件列表）mock 成占位，只测本组件自身的加载接线。
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
  filters: Record<string, unknown>;
  deferred: Deferred;
}

/** loadChildren 并行查询的 5 张表（与组件内 Promise.all 顺序一致） */
const LOAD_TABLES = ["task_checklists", "task_activities", "task_attachments", "task_tags", "tags"] as const;
type LoadTable = (typeof LOAD_TABLES)[number];

function createFakeSupabase() {
  const queries: QueryRecord[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table: string) {
      // from() 时立即注册查询记录：注册时机不能依赖 then 被调用（那要等 Promise.all 的微任务），
      // 否则测试在 render 后同步 resolve 时找不到记录
      const filters: Record<string, unknown> = {};
      const deferred = makeDeferred();
      queries.push({ table, filters, deferred });
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
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
vi.mock("@/components/ui/prompt-dialog", () => ({ showPrompt: vi.fn() }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
}));
vi.mock("@/components/tasks/task-date-popover", () => ({
  TaskDatePopover: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
  formatTaskDate: () => "10月17日",
}));
vi.mock("@/components/tasks/task-reminders-editor", () => ({ TaskRemindersEditor: () => null }));
vi.mock("@/components/tasks/task-hierarchy", () => ({ TaskHierarchy: () => null }));
vi.mock("@/components/tasks/task-dependencies", () => ({ TaskDependencies: () => null }));
vi.mock("@/components/tasks/task-linked-content", () => ({ TaskLinkedContent: () => null }));
vi.mock("@/components/tasks/task-attachment-list", () => ({
  TaskAttachmentList: ({ attachments }: { attachments: Array<{ name: string }> }) => (
    <div data-attachments>{attachments.map((item) => item.name).join(",")}</div>
  ),
}));

import { TaskInlineDetail } from "./task-inline-detail";
import type { TaskWithTags } from "@organize/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTask(id: string): TaskWithTags {
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
    schedule_start_at: null,
    tags: [],
  };
}

function checklistRow(id: string, taskId: string, content: string) {
  return { id, task_id: taskId, content, is_completed: false, sort_order: 0, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" };
}

function roundQuery(round: number, table: LoadTable): QueryRecord {
  const record = state.supabase.queries.filter((q) => q.table === table)[round];
  if (!record) throw new Error(`缺少第 ${round} 轮 ${table} 查询`);
  return record;
}

/** 放行一整轮 5 个查询；默认全部成功空数据，overrides 指定某表的数据或错误 */
async function resolveRound(round: number, overrides: Partial<Record<LoadTable, { data?: unknown[]; error?: unknown }>> = {}) {
  await act(async () => {
    for (const table of LOAD_TABLES) {
      const override = overrides[table] ?? {};
      roundQuery(round, table).deferred.resolve({ data: override.data ?? [], error: override.error ?? null });
    }
  });
}

function alertEl() {
  return container.querySelector('[role="alert"]');
}

function retryButton() {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("重试"));
}

let container: HTMLDivElement;
let root: Root;
const lists: never[] = [];
const onUpdate = vi.fn();
const onDelete = vi.fn();
const onClose = vi.fn();
const onOpenTask = vi.fn();

function render(task: TaskWithTags) {
  act(() => {
    root.render(createElement(TaskInlineDetail, { task, lists, onUpdate, onDelete, onClose, onOpenTask }));
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

describe("TaskInlineDetail 次要数据加载失败诚实提示", () => {
  it("附件查询失败：出现 role=alert 提示与重试；重试成功后提示消失、数据补上", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      task_attachments: { error: { message: "network down" } },
      task_tags: { data: [{ tag_id: "tag-1" }] },
      tags: { data: [{ id: "tag-1", name: "工作", color: "blue", user_id: "u1", created_at: "2026-10-17T00:00:00Z" }] },
    });

    const alert = alertEl();
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("附件加载失败，显示的内容可能不完整");
    expect(retryButton()).toBeTruthy();
    // 成功的部分照常显示：标签来自 task_tags × tags 的 join
    expect(container.textContent).toContain("#工作");

    await act(async () => {
      retryButton()!.click();
    });
    await resolveRound(1, {
      task_attachments: { data: [{ id: "att-1", task_id: "task-a", name: "截图.png", bucket: "attachments", path: "p", mime_type: "image/png", size_bytes: 1, created_at: "2026-10-17T00:00:00Z" }] },
    });

    expect(alertEl()).toBeNull();
    // 附件折叠区默认收起：展开后确认重试加载到的数据已补上
    const attachmentsToggle = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("附件"));
    await act(async () => {
      attachmentsToggle!.click();
    });
    expect(container.querySelector("[data-attachments]")?.textContent).toContain("截图.png");
  });

  it("重试时清单查询失败：不用空数组覆盖上次成功的清单数据", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      task_checklists: { data: [checklistRow("cl-1", "task-a", "旧清单项")] },
      task_attachments: { error: { message: "boom" } },
    });
    expect(container.textContent).toContain("清单项");
    expect(alertEl()).not.toBeNull();

    await act(async () => {
      retryButton()!.click();
    });
    await resolveRound(1, {
      task_checklists: { error: { message: "500" } },
    });

    // 失败的清单保留上次成功数据（区块仍在），且提示如实说明
    expect(container.textContent).toContain("清单项");
    expect(alertEl()?.textContent).toContain("子任务加载失败");
  });

  it("重试时清单查询成功返回空：成功部分照常替换，区块消失", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      task_checklists: { data: [checklistRow("cl-1", "task-a", "旧清单项")] },
      task_attachments: { error: { message: "boom" } },
    });
    expect(container.textContent).toContain("清单项");

    await act(async () => {
      retryButton()!.click();
    });
    await resolveRound(1);

    expect(container.textContent).not.toContain("清单项");
    expect(alertEl()).toBeNull();
  });

  it("切换任务：立即清空上一任务的清单数据与失败提示（新请求挂起中）", async () => {
    render(makeTask("task-a"));
    await resolveRound(0, {
      task_checklists: { data: [checklistRow("cl-1", "task-a", "清单A")] },
      task_attachments: { error: { message: "network down" } },
    });
    expect(container.textContent).toContain("清单项");
    expect(alertEl()).not.toBeNull();

    render(makeTask("task-b"));

    // 新任务的查询还在挂起：上一任务的数据与提示都不能留给它
    expect(container.textContent).not.toContain("清单项");
    expect(alertEl()).toBeNull();

    await resolveRound(1, {
      task_checklists: { data: [checklistRow("cl-b1", "task-b", "清单B1"), checklistRow("cl-b2", "task-b", "清单B2")] },
    });
    expect(container.textContent).toContain("清单项");
  });

  it("旧任务的晚到响应被丢弃，不覆盖新任务数据", async () => {
    render(makeTask("task-a"));
    // task-a 的 5 个查询挂起中就切到 task-b
    render(makeTask("task-b"));

    // task-a 的慢响应现在才到（带 1 项清单）：应被丢弃
    await resolveRound(0, {
      task_checklists: { data: [checklistRow("cl-a", "task-a", "清单A")] },
    });
    expect(container.textContent).not.toContain("清单项");

    // task-b 的响应到达：正常显示（2 项）
    await resolveRound(1, {
      task_checklists: { data: [checklistRow("cl-b1", "task-b", "清单B1"), checklistRow("cl-b2", "task-b", "清单B2")] },
    });
    expect(container.textContent).toContain("清单项");
  });
});

