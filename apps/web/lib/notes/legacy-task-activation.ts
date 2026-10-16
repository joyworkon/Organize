/**
 * G2 legacy 任务激活的纯函数（自 page.tsx runLegacyActivation 抽出，便于单测）。
 *
 * 背景：无 taskId 的 taskItem（legacy 项）在用户编辑时触发激活——批量建任务后
 * 把 taskId 回填进块。建任务要走两个 await（auth.getUser + insert），网络窗口内
 * 用户继续编辑会使扫描时记下的 pos 漂移；因此回填**绝不依赖旧 pos**，只按
 * block id 在回填时的当前文档里重新定位，找不到/已被绑定/类型不符的块跳过
 * （对应已建出的任务由保存 RPC 的 orphaned 回收兜底，见 g0-protocol §5）。
 *
 * 本文件只做纯数据变换：输入 ProseMirror Node，输出收集结果/回填计划，
 * 不碰 React、DOM、supabase，也不 dispatch 事务。
 */
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** 超过该数量的 legacy 项不自动激活，由调用方先弹预览确认（G3）。 */
export const LEGACY_TASK_ACTIVATION_LIMIT = 20;

/** 预览样例标题数（buildLegacyActivationPreview 取前 N 条）。 */
export const LEGACY_ACTIVATION_SAMPLE_SIZE = 5;

export interface LegacyTaskItem {
  /** 块 id：文档里已有的 attrs.id，或为缺 id 的节点新生成（须先落进文档再发网络请求）。 */
  blockId: string;
  /** 首段纯文本；空 →「未命名任务」。 */
  title: string;
  /** 勾选态，建任务时映射 status（true→done / false→todo）。 */
  checked: boolean;
  /** 文档里本来就有 attrs.id；false 表示 blockId 是新生成的、尚未写入文档。 */
  hasStoredId: boolean;
}

export interface NodeAttrUpdate {
  pos: number;
  attrs: Record<string, unknown>;
}

export interface LegacyBackfillPlan {
  /** 可安全回填的 {pos, attrs}；pos 取自传入的当前文档，attrs 含 taskId。 */
  updates: NodeAttrUpdate[];
  /** 被跳过的项数：网络窗口内被删除/被绑定/类型不符/重复 id。 */
  skipped: number;
}

const genBlockId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** taskItem 首个 paragraph 的纯文本。
 *  注意：Fragment.forEach 的回调返回值不生效（原 page.tsx 内联版因此实际取了末段），
 *  这里用真实早退取首段，与保存链路 extractTaskMutations 的取题规则一致。 */
function firstParagraphText(node: ProseMirrorNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === "paragraph") return child.textContent || "";
  }
  return "";
}

/**
 * 收集文档里所有无 taskId 的 taskItem（legacy 项），按文档顺序返回。
 * 缺 attrs.id 的节点分配新 blockId（hasStoredId=false）；调用方必须在发起
 * 网络请求前用 planBlockIdAssignment 把这些 id 写进文档，否则之后无法按 id 找回。
 * 0 项 / 超 LEGACY_TASK_ACTIVATION_LIMIT 项不动作的判定在调用方。
 */
export function collectLegacyTaskItems(doc: ProseMirrorNode): LegacyTaskItem[] {
  const items: LegacyTaskItem[] = [];
  doc.descendants((node) => {
    if (node.type.name === "taskItem" && !node.attrs.taskId) {
      const storedId = node.attrs.id ? String(node.attrs.id) : "";
      items.push({
        blockId: storedId || genBlockId(),
        title: firstParagraphText(node) || "未命名任务",
        checked: node.attrs.checked === true,
        hasStoredId: Boolean(storedId),
      });
    }
    return true;
  });
  return items;
}

/**
 * >20 预览确认（G3）的弹窗数据：数量与前若干条标题。标题直接用 collect 出的
 * item.title（首段纯文本/「未命名任务」），不再二次处理。
 */
export interface LegacyActivationPreview {
  count: number;
  sampleTitles: string[];
}

/** >20 时需要先弹确认；=20 及以内保持自动激活。 */
export function needsLegacyActivationConfirm(count: number): boolean {
  return count > LEGACY_TASK_ACTIVATION_LIMIT;
}

/** 取数量 + 前 LEGACY_ACTIVATION_SAMPLE_SIZE 条标题做预览。 */
export function buildLegacyActivationPreview(items: LegacyTaskItem[]): LegacyActivationPreview {
  return {
    count: items.length,
    sampleTitles: items.slice(0, LEGACY_ACTIVATION_SAMPLE_SIZE).map((item) => item.title),
  };
}

/** 预览确认弹窗文案（结构兼容 prompt-dialog 的 ConfirmOptions）。 */
export function buildLegacyActivationConfirmOptions(preview: LegacyActivationPreview): {
  title: string;
  description: string;
  confirmText: string;
} {
  const quoted = preview.sampleTitles.map((t) => `「${t}」`).join("、");
  const more = preview.count - preview.sampleTitles.length;
  const suffix = more > 0 ? `……等共 ${preview.count} 项` : "";
  return {
    title: `批量创建 ${preview.count} 个关联任务？`,
    description: `将创建 ${preview.count} 个关联任务并绑定到对应待办块：${quoted}${suffix}`,
    confirmText: "创建任务",
  };
}

/**
 * 为缺 block id 的 legacy taskItem 产出补 id 计划：文档里仍无 attrs.id 的
 * legacy taskItem 按文档顺序与 items 中 hasStoredId=false 的项一一配对
 * （collect 与本函数须在同一个文档快照上同步调用，顺序必然一致）。
 */
export function planBlockIdAssignment(doc: ProseMirrorNode, items: LegacyTaskItem[]): NodeAttrUpdate[] {
  const pending = items.filter((item) => !item.hasStoredId).map((item) => item.blockId);
  const updates: NodeAttrUpdate[] = [];
  let cursor = 0;
  doc.descendants((node, pos) => {
    if (cursor >= pending.length) return false;
    if (node.type.name === "taskItem" && !node.attrs.taskId && !node.attrs.id) {
      updates.push({ pos, attrs: { ...node.attrs, id: pending[cursor] } });
      cursor += 1;
    }
    return true;
  });
  return updates;
}

/**
 * 按当前文档为 legacy 项规划 taskId 回填：只对「仍是 taskItem、attrs.id 等于
 * blockId、仍无 taskId」的节点产出 {pos, attrs}；其余（网络窗口内被删除/被
 * 绑定/类型已变/重复 id 的后续项）计入 skipped，绝不把 taskId 贴到别的块上。
 * createdIds 与 items 等长且按序对应（建任务接口的返回顺序）。
 */
export function planLegacyBackfill(
  doc: ProseMirrorNode,
  items: LegacyTaskItem[],
  createdIds: string[]
): LegacyBackfillPlan {
  // 当前文档里仍待激活的 taskItem 按 block id 建索引；同 id 只认第一个，匹配即消费，
  // 防御文档异常（重复 id）时把两个 taskId 先后贴到同一块。
  const byId = new Map<string, { pos: number; node: ProseMirrorNode }>();
  doc.descendants((node, pos) => {
    if (node.type.name === "taskItem" && !node.attrs.taskId && node.attrs.id) {
      const id = String(node.attrs.id);
      if (!byId.has(id)) byId.set(id, { pos, node });
    }
    return true;
  });
  const updates: NodeAttrUpdate[] = [];
  let skipped = 0;
  items.forEach((item, i) => {
    const found = byId.get(item.blockId);
    const taskId = createdIds[i];
    if (!found || !taskId) {
      skipped += 1;
      return;
    }
    byId.delete(item.blockId);
    updates.push({ pos: found.pos, attrs: { ...found.node.attrs, taskId } });
  });
  return { updates, skipped };
}
