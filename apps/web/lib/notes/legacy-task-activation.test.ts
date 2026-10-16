// @vitest-environment jsdom
// legacy 任务激活纯函数测试：网络窗口内 pos 漂移/删块/被绑定/缺 id 等场景下，
// 回填必须按 block id 定位到正确的块，绝不贴错。
// 用真实 Tiptap schema 构造 doc（同 task-item-linked.test.ts 的做法），不 mock 定位逻辑。
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import UniqueID from "@tiptap/extension-unique-id";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TaskItemLinked } from "@/components/editor/extensions/task-item-linked";
import {
  LEGACY_TASK_ACTIVATION_LIMIT,
  collectLegacyTaskItems,
  needsLegacyActivationConfirm,
  buildLegacyActivationPreview,
  buildLegacyActivationConfirmOptions,
  planBlockIdAssignment,
  planLegacyBackfill,
  type LegacyTaskItem,
  type NodeAttrUpdate,
} from "./legacy-task-activation";

/** updateDocument:false——保留 id 属性定义但不自动补 id，便于构造「缺 id」的历史节点。 */
function createEditor(content: any) {
  return new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItemLinked.configure({ nested: true }),
      UniqueID.configure({ types: ["taskItem"], updateDocument: false }),
    ],
    content,
  });
}

const editors: Editor[] = [];
function newEditor(content: unknown) {
  const editor = createEditor(content);
  editors.push(editor);
  return editor;
}
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function taskItem(id: string, text: string, extraAttrs: Record<string, unknown> = {}) {
  return {
    type: "taskItem",
    attrs: { id, checked: false, ...extraAttrs },
    content: text === "" ? [{ type: "paragraph" }] : [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function docOf(...nodes: unknown[]) {
  return { type: "doc", content: nodes };
}

/** 编辑器 JSON 里按文档顺序取全部 taskItem。 */
function taskItemsInDoc(editor: Editor) {
  const out: { attrs: Record<string, unknown> }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") out.push({ attrs: node.attrs as Record<string, unknown> });
    return true;
  });
  return out;
}

/** 按 page.tsx 的方式应用回填/补 id 计划。 */
function applyUpdates(editor: Editor, updates: NodeAttrUpdate[]) {
  const tr = editor.state.tr;
  updates.forEach(({ pos, attrs }) => tr.setNodeMarkup(pos, undefined, attrs));
  tr.setMeta("transactionSource", "hydrate");
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/** 找第一个满足条件的节点位置（模拟网络窗口内用户的编辑都通过真实事务完成）。 */
function findPos(editor: Editor, pred: (node: ProseMirrorNode) => boolean): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && pred(node)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

describe("collectLegacyTaskItems", () => {
  it("无 taskItem / 全部已绑定 → 收集为空（0 项不动作）", () => {
    const empty = newEditor(docOf({ type: "paragraph", content: [{ type: "text", text: "纯文本" }] }));
    expect(collectLegacyTaskItems(empty.state.doc)).toEqual([]);

    const allBound = newEditor(docOf({ type: "taskList", content: [taskItem("blk-1", "已绑定", { taskId: "t-1" })] }));
    expect(collectLegacyTaskItems(allBound.state.doc)).toEqual([]);
  });

  it("空标题 →「未命名任务」；title 只取首个段落；checked 原样带回", () => {
    const editor = newEditor(
      docOf(
        { type: "taskList", content: [taskItem("blk-empty", "", { checked: true })] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { id: "blk-multi", checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
                { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
              ],
            },
          ],
        }
      )
    );
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ blockId: "blk-empty", title: "未命名任务", checked: true, hasStoredId: true });
    expect(items[1]).toMatchObject({ blockId: "blk-multi", title: "第一段", checked: false, hasStoredId: true });
  });

  it("缺 id 的节点分配新 blockId 且 hasStoredId=false", () => {
    const editor = newEditor({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "新待办" }] }],
            },
          ],
        },
      ],
    });
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items).toHaveLength(1);
    expect(items[0].hasStoredId).toBe(false);
    expect(typeof items[0].blockId).toBe("string");
    expect(items[0].blockId.length).toBeGreaterThan(0);
  });

  it("收集 21 项（超过 LEGACY_TASK_ACTIVATION_LIMIT=20，由调用方跳过激活）", () => {
    const many = Array.from({ length: 21 }, (_, i) => taskItem(`blk-${i + 1}`, `任务${i + 1}`));
    const editor = newEditor(docOf({ type: "taskList", content: many }));
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items).toHaveLength(21);
    expect(LEGACY_TASK_ACTIVATION_LIMIT).toBe(20);
    expect(items.length).toBeGreaterThan(LEGACY_TASK_ACTIVATION_LIMIT);
    expect(new Set(items.map((i) => i.blockId)).size).toBe(21);
  });
});

// >20 预览确认（G3）的纯辅助：输入直接用 LegacyTaskItem，无需编辑器。
function legacyItems(n: number): LegacyTaskItem[] {
  return Array.from({ length: n }, (_, i) => ({
    blockId: `blk-${i + 1}`,
    title: `任务${i + 1}`,
    checked: false,
    hasStoredId: true,
  }));
}

describe(">20 预览确认辅助", () => {
  it("buildLegacyActivationPreview：0 项 → count 0、无样例", () => {
    expect(buildLegacyActivationPreview([])).toEqual({ count: 0, sampleTitles: [] });
  });

  it("buildLegacyActivationPreview：≤5 项 → 全量样例", () => {
    const preview = buildLegacyActivationPreview(legacyItems(3));
    expect(preview).toEqual({ count: 3, sampleTitles: ["任务1", "任务2", "任务3"] });
  });

  it("buildLegacyActivationPreview：>5 项 → 截断为前 5 条，count 仍为全量", () => {
    const preview = buildLegacyActivationPreview(legacyItems(7));
    expect(preview.count).toBe(7);
    expect(preview.sampleTitles).toEqual(["任务1", "任务2", "任务3", "任务4", "任务5"]);
  });

  it("needsLegacyActivationConfirm：边界 20 不确认、21 需确认", () => {
    expect(needsLegacyActivationConfirm(0)).toBe(false);
    expect(needsLegacyActivationConfirm(LEGACY_TASK_ACTIVATION_LIMIT)).toBe(false);
    expect(needsLegacyActivationConfirm(LEGACY_TASK_ACTIVATION_LIMIT + 1)).toBe(true);
  });

  it("confirm 文案：写清创建数量、顿号列出全部样例标题", () => {
    const options = buildLegacyActivationConfirmOptions(buildLegacyActivationPreview(legacyItems(2)));
    expect(options.title).toBe("批量创建 2 个关联任务？");
    expect(options.description).toBe("将创建 2 个关联任务并绑定到对应待办块：「任务1」、「任务2」");
    expect(options.confirmText).toBe("创建任务");
  });

  it("confirm 文案：超出样例数时带「等共 N 项」后缀", () => {
    const options = buildLegacyActivationConfirmOptions(buildLegacyActivationPreview(legacyItems(21)));
    expect(options.title).toBe("批量创建 21 个关联任务？");
    expect(options.description).toContain("「任务1」、「任务2」、「任务3」、「任务4」、「任务5」");
    expect(options.description).toContain("……等共 21 项");
    expect(options.description).not.toContain("「任务6」");
  });
});

describe("planBlockIdAssignment + planLegacyBackfill（网络窗口场景）", () => {
  it("网络期间在目标块前插入新任务块（pos 漂移）→ 仍回填到正确的块", () => {
    const editor = newEditor(docOf({ type: "taskList", content: [taskItem("blk-a", "任务A")] }));
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items).toHaveLength(1);

    // 模拟网络窗口内用户在 taskList 前插入新的 legacy 任务块：所有 pos 后移
    const schema = editor.state.schema;
    const insertedTask = schema.nodes.taskItem.createAndFill(
      { checked: false, id: "blk-b" },
      schema.nodes.paragraph.createAndFill(null, schema.text("插入的新任务"))!
    )!;
    const insertedList = schema.nodes.taskList.createAndFill(null, insertedTask)!;
    const listPos = findPos(editor, (node) => node.type.name === "taskList");
    expect(listPos).not.toBeNull();
    editor.view.dispatch(editor.state.tr.insert(listPos!, insertedList));

    const plan = planLegacyBackfill(editor.state.doc, items, ["t-a"]);
    expect(plan.skipped).toBe(0);
    expect(plan.updates).toHaveLength(1);
    applyUpdates(editor, plan.updates);

    const blocks = taskItemsInDoc(editor);
    expect(blocks).toHaveLength(2);
    // 文档顺序在前的是网络期间插入的 blk-b：不能被贴上旧任务
    expect(blocks[0].attrs).toMatchObject({ id: "blk-b" });
    expect(blocks[0].attrs.taskId ?? null).toBeNull();
    // 目标块 blk-a 拿到新建任务的 id
    expect(blocks[1].attrs).toMatchObject({ id: "blk-a", taskId: "t-a" });
  });

  it("网络期间目标块被删除 → 跳过，不贴到别的块", () => {
    const editor = newEditor(
      docOf({
        type: "taskList",
        content: [taskItem("blk-a", "任务A"), taskItem("blk-other", "别的任务")],
      })
    );
    const items = collectLegacyTaskItems(editor.state.doc).filter((i) => i.blockId === "blk-a");

    let target: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (!target && node.type.name === "taskItem" && node.attrs.id === "blk-a") {
        target = { pos, size: node.nodeSize };
        return false;
      }
      return true;
    });
    editor.view.dispatch(editor.state.tr.delete(target!.pos, target!.pos + target!.size));

    const plan = planLegacyBackfill(editor.state.doc, items, ["t-a"]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toBe(1);

    const blocks = taskItemsInDoc(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs).toMatchObject({ id: "blk-other" });
    expect(blocks[0].attrs.taskId ?? null).toBeNull();
  });

  it("网络期间目标块已被别处赋了 taskId → 不覆盖", () => {
    const editor = newEditor(docOf({ type: "taskList", content: [taskItem("blk-a", "任务A")] }));
    const items = collectLegacyTaskItems(editor.state.doc);

    // 模拟窗口内另一个来源（如协作端/重复激活）先绑定了别的任务
    const pos = findPos(editor, (node) => node.type.name === "taskItem")!;
    const node = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, taskId: "t-existing" })
    );

    const plan = planLegacyBackfill(editor.state.doc, items, ["t-new"]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toBe(1);
    expect(taskItemsInDoc(editor)[0].attrs.taskId).toBe("t-existing");
  });

  it("原本无 block id 的节点：补 id 后能按 id 找回并回填", () => {
    const editor = newEditor({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "无 id 老块" }] }],
            },
          ],
        },
      ],
    });
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items[0].hasStoredId).toBe(false);

    // 网络请求前：先把分配的 id 同步写进文档（page.tsx 的补 id 事务）
    const assignments = planBlockIdAssignment(editor.state.doc, items);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].attrs.id).toBe(items[0].blockId);
    applyUpdates(editor, assignments);

    // 网络返回后：按 id 找回
    const plan = planLegacyBackfill(editor.state.doc, items, ["t-9"]);
    expect(plan.skipped).toBe(0);
    expect(plan.updates).toHaveLength(1);
    applyUpdates(editor, plan.updates);

    const block = taskItemsInDoc(editor)[0];
    expect(block.attrs).toMatchObject({ id: items[0].blockId, taskId: "t-9", checked: true });
  });

  it("文档异常：两个 legacy 块同 id → 只回填第一个，第二个跳过", () => {
    const editor = newEditor(docOf({ type: "taskList", content: [taskItem("dup", "甲"), taskItem("dup", "乙")] }));
    const items = collectLegacyTaskItems(editor.state.doc);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.blockId === "dup")).toBe(true);

    const plan = planLegacyBackfill(editor.state.doc, items, ["t-1", "t-2"]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.skipped).toBe(1);
    applyUpdates(editor, plan.updates);

    const blocks = taskItemsInDoc(editor);
    expect(blocks[0].attrs.taskId).toBe("t-1");
    expect(blocks[1].attrs.taskId ?? null).toBeNull();
  });
});
