// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CompleteTaskDialog 完成结果诚实处理的组件测试：
 * onComplete 返回 false（任务未完成 / 复盘保存失败）时弹窗保持打开、
 * 已填写的复盘文字不被清空；返回 true/undefined（成功或旧回调契约）才关闭。
 */

// Radix Dialog 渲染进 portal，jsdom 下改为 open 时内联渲染，便于在 container 内断言
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// Radix Select 交互重：mock 成原生 select（option 与 LESSON_TYPE_CONFIG 的 key 一致），
// 经 onChange 触发 onValueChange；trigger/content 系纯展示包装，渲染为空
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <select data-testid="lesson-type" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="reflection">任务复盘</option>
      <option value="lesson">经验教训</option>
      <option value="insight">灵感</option>
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

import { CompleteTaskDialog } from "./complete-task-dialog";
import type { Task } from "@organize/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTask(): Task {
  return {
    id: "task-a",
    user_id: "u1",
    title: "整理库存",
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

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onComplete: ReturnType<
  typeof vi.fn<
    (
      reflectionData?: { title?: string; content?: string; lessonType?: string },
    ) => Promise<boolean | void>
  >
>;

function renderDialog() {
  act(() => {
    root.render(
      createElement(CompleteTaskDialog, {
        open: true,
        task: makeTask(),
        onClose,
        onComplete,
      }),
    );
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`找不到按钮「${text}」`);
  return btn;
}

function titleInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>("#lesson-title")!;
}

function contentTextarea(): HTMLTextAreaElement {
  return container.querySelector<HTMLTextAreaElement>("#lesson-content")!;
}

/** React 受控输入需要原生 setter 绕过 value tracker 再派发事件 */
function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function enterReflection() {
  await act(async () => {
    buttonByText("写复盘").click();
  });
  act(() => {
    setInputValue(titleInput(), "库存复盘");
    setInputValue(contentTextarea(), "清点时先按货架分区，效率更高");
  });
  const select = container.querySelector<HTMLSelectElement>('[data-testid="lesson-type"]')!;
  await act(async () => {
    select.value = "insight";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickSave() {
  await act(async () => {
    buttonByText("保存并完成任务").click();
  });
}

beforeEach(() => {
  onClose = vi.fn();
  onComplete = vi.fn(async () => undefined);
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

describe("CompleteTaskDialog 完成结果诚实处理", () => {
  it("快速完成：onComplete resolve undefined（旧契约）→ 调用 onClose", async () => {
    onComplete = vi.fn(async () => undefined);
    renderDialog();

    await act(async () => {
      buttonByText("跳过，直接完成").click();
    });

    expect(onComplete).toHaveBeenCalledWith();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("快速完成：onComplete resolve true → 调用 onClose", async () => {
    onComplete = vi.fn(async () => true);
    renderDialog();

    await act(async () => {
      buttonByText("跳过，直接完成").click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("写复盘保存失败：onComplete resolve false → 不调用 onClose，标题/内容/类型均保留", async () => {
    onComplete = vi.fn(async () => false);
    renderDialog();
    await enterReflection();

    await clickSave();

    expect(onClose).not.toHaveBeenCalled();
    // 弹窗仍在：保存按钮与输入框还在，且用户写的文字未被清空
    expect(buttonByText("保存并完成任务")).toBeTruthy();
    expect(titleInput().value).toBe("库存复盘");
    expect(contentTextarea().value).toBe("清点时先按货架分区，效率更高");
    expect(container.querySelector<HTMLSelectElement>('[data-testid="lesson-type"]')!.value).toBe("insight");
  });

  it("失败后重试成功：再次点保存且 resolve true → 调用 onClose", async () => {
    onComplete = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderDialog();
    await enterReflection();

    await clickSave();
    expect(onClose).not.toHaveBeenCalled();

    await clickSave();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("保存复盘时 onComplete 收到填写的 title/content/lessonType（trim 后）", async () => {
    onComplete = vi.fn(async () => true);
    renderDialog();
    await act(async () => {
      buttonByText("写复盘").click();
    });
    act(() => {
      setInputValue(titleInput(), "  库存复盘  ");
      setInputValue(contentTextarea(), "  清点时先按货架分区  ");
    });

    await clickSave();

    expect(onComplete).toHaveBeenCalledWith({
      title: "库存复盘",
      content: "清点时先按货架分区",
      lessonType: "reflection",
    });
  });
});
