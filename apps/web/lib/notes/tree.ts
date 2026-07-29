export interface NoteTreeItem {
  id: string;
  title: string | null;
  icon: string | null;
  parent_note_id: string | null;
  updated_at?: string;
}

export interface NoteTreeNode extends NoteTreeItem {
  children: NoteTreeNode[];
}

function compareNotes(a: NoteTreeItem, b: NoteTreeItem) {
  const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
  const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
  if (aTime !== bTime) return bTime - aTime;
  return (a.title || "").localeCompare(b.title || "", "zh-CN");
}

function hasValidParent(
  item: NoteTreeItem,
  byId: Map<string, NoteTreeItem>
): boolean {
  if (!item.parent_note_id || !byId.has(item.parent_note_id)) return false;

  const seen = new Set([item.id]);
  let currentId: string | null = item.parent_note_id;
  while (currentId) {
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    currentId = byId.get(currentId)?.parent_note_id || null;
  }
  return true;
}

export function buildNoteTree(items: NoteTreeItem[]): NoteTreeNode[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const nodes = new Map<string, NoteTreeNode>(
    items.map((item) => [item.id, { ...item, children: [] as NoteTreeNode[] }])
  );
  const roots: NoteTreeNode[] = [];

  for (const item of items) {
    const node = nodes.get(item.id)!;
    if (hasValidParent(item, byId)) {
      nodes.get(item.parent_note_id!)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortBranch = (branch: NoteTreeNode[]) => {
    branch.sort(compareNotes);
    branch.forEach((node) => sortBranch(node.children));
  };
  sortBranch(roots);
  return roots;
}

export function getNoteAncestors(
  items: NoteTreeItem[],
  noteId: string
): NoteTreeItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ancestors: NoteTreeItem[] = [];
  const seen = new Set([noteId]);
  let currentId = byId.get(noteId)?.parent_note_id || null;

  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const parent = byId.get(currentId);
    if (!parent) break;
    ancestors.unshift(parent);
    currentId = parent.parent_note_id;
  }

  return ancestors;
}

export function getDescendantIds(
  items: NoteTreeItem[],
  noteId: string
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parent_note_id) continue;
    const children = childrenByParent.get(item.parent_note_id) || [];
    children.push(item.id);
    childrenByParent.set(item.parent_note_id, children);
  }

  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(noteId) || [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    queue.push(...(childrenByParent.get(id) || []));
  }
  return descendants;
}

export function getParentCandidates(
  items: NoteTreeItem[],
  noteId: string
): NoteTreeItem[] {
  const excluded = getDescendantIds(items, noteId);
  excluded.add(noteId);
  return items.filter((item) => !excluded.has(item.id)).sort(compareNotes);
}
