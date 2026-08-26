/**
 * X5 知识图谱——数据构建（纯函数）
 *
 * 数据来源：
 * - 笔记间链接：客户端从 notes.content (TipTap jsonb) 提取（复用 lib/note-links.ts），
 *   与反链面板同一判定路径，保证图谱与反链语义一致
 * - 笔记父子层级：notes.parent_note_id
 * - 任务依赖：task_dependencies 表（task_id → depends_on_task_id 表示「前置」）
 *
 * 边只保留两端节点都存在的（指向已删除/不存在目标的链接丢弃——图谱表达
 * 「现存知识的连接」，失效链接状态由编辑器的 internal-link-state 负责）。
 */

import { extractLinksFromContent } from "@/lib/note-links";

export type GraphNodeKind = "note" | "task";
export type GraphEdgeKind = "link" | "parent" | "dependency";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** 连接度（出边 + 入边），用于节点大小与孤立判定 */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NoteGraphRow {
  id: string;
  title: string | null;
  content: unknown;
  parent_note_id: string | null;
}

export interface TaskGraphRow {
  id: string;
  title: string | null;
  status: string;
}

export interface TaskDependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

const UNTITLED_NOTE = "无标题笔记";
const UNTITLED_TASK = "无标题任务";

function withDegrees(nodes: Omit<GraphNode, "degree">[], edges: GraphEdge[]): GraphNode[] {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
}

/** 笔记图谱：内部链接边（link）+ 父子层级边（parent） */
export function buildNoteGraph(notes: NoteGraphRow[]): GraphData {
  const ids = new Set(notes.map((note) => note.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string, kind: GraphEdgeKind) => {
    if (source === target) return;
    if (!ids.has(source) || !ids.has(target)) return;
    const key = `${kind}:${source}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  for (const note of notes) {
    for (const link of extractLinksFromContent(note.content)) {
      if (link.type === "note") push(note.id, link.url, "link");
    }
    if (note.parent_note_id) push(note.parent_note_id, note.id, "parent");
  }

  const nodes = withDegrees(
    notes.map((note) => ({
      id: note.id,
      kind: "note" as const,
      label: note.title?.trim() || UNTITLED_NOTE,
    })),
    edges
  );
  return { nodes, edges };
}

/**
 * 任务依赖图谱：边方向 前置任务 → 被阻塞任务
 * （depends_on_task_id 是 task_id 的前置，箭头指向「解除阻塞后可以做」的一方）
 */
export function buildTaskGraph(
  tasks: TaskGraphRow[],
  dependencies: TaskDependencyRow[]
): GraphData {
  const ids = new Set(tasks.map((task) => task.id));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const dep of dependencies) {
    if (dep.task_id === dep.depends_on_task_id) continue;
    if (!ids.has(dep.task_id) || !ids.has(dep.depends_on_task_id)) continue;
    const key = `${dep.depends_on_task_id}:${dep.task_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: dep.depends_on_task_id, target: dep.task_id, kind: "dependency" });
  }

  const nodes = withDegrees(
    tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      label: task.title?.trim() || UNTITLED_TASK,
    })),
    edges
  );
  return { nodes, edges };
}

/** 过滤孤立节点（无任何连接），保留有边的节点 */
export function filterIsolatedNodes(graph: GraphData): GraphData {
  const nodes = graph.nodes.filter((node) => node.degree > 0);
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}
