import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteGroup } from "@organize/shared";

/**
 * 笔记分组的读写（094：note_groups + note_group_members）。
 * 浏览器端直连 Supabase，RLS 按 user_id 隔离；mock 后端下同一接口走内存表。
 * 任何写操作后派发 organize:note-groups-changed，侧栏与笔记列表各自重新读取。
 */

export const NOTE_GROUPS_CHANGED = "organize:note-groups-changed";
export const UNGROUPED_KEY = "__ungrouped__";
export const GROUP_NAME_MAX = 40;

export function notifyNoteGroupsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NOTE_GROUPS_CHANGED));
}

export function normalizeGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, GROUP_NAME_MAX);
}

export interface NoteGroupsState {
  groups: NoteGroup[];
  /** note_id → group_id */
  membership: Map<string, string>;
}

export function sortGroups(groups: NoteGroup[]): NoteGroup[] {
  return [...groups].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name, "zh-CN")
  );
}

/** nextGroupsStateAfterLoad 的返回：UI 该落到什么状态、本次是否失败、是否沿用了旧数据 */
export interface NoteGroupsLoadPlan {
  groups: NoteGroup[];
  membership: Map<string, string>;
  failed: boolean;
  /** 失败但保留了旧数据（重设同引用是无害的，React 会跳过重渲染） */
  keptPrevious: boolean;
}

/**
 * 分组加载结果落到 UI 状态的纯逻辑（供 useNoteGroups 接线并单测）：
 * - 成功：整体替换；
 * - 失败且此前成功过：保留旧数据——把任意失败伪装成「全部未分组」等于撒谎；
 * - 失败且从未成功过：只能落到空态，failed 标记留给调用方区分「没有分组」与「加载失败」。
 */
export function nextGroupsStateAfterLoad(
  previous: NoteGroupsState | null,
  result: NoteGroupsState | null
): NoteGroupsLoadPlan {
  if (result) {
    return { groups: result.groups, membership: result.membership, failed: false, keptPrevious: false };
  }
  if (previous) {
    return { groups: previous.groups, membership: previous.membership, failed: true, keptPrevious: true };
  }
  return { groups: [], membership: new Map(), failed: true, keptPrevious: false };
}

/**
 * 分组加载失败的行内错误条是否可见：loadError 非空且在线。
 * 离线时的失败由顶栏离线角标表达，不再叠一条错误横幅（与 useNoteGroups 的 toast 门控一致）。
 */
export function shouldShowGroupsLoadError(loadError: string | null, online: boolean): boolean {
  return loadError !== null && online;
}

/**
 * 「分组表未迁移（094 未应用）」判定：PGRST205 / 42P01，或这两种错误的典型文案。
 * 只有这种情况沿用空态退化；其余失败（网络/RLS/权限/5xx）按普通失败保留旧值并提示。
 */
export function isNoteGroupsTableMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "PGRST205" || code === "42P01") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /could not find the table|does not exist/i.test(message);
}

/** 抛错时保留 PostgREST/Postgres 错误码，供调用方区分「表未迁移」与瞬时失败 */
function throwPostgrestError(error: { message: string; code?: string }): never {
  throw Object.assign(new Error(error.message), { code: error.code });
}

export async function loadNoteGroups(supabase: SupabaseClient, userId: string): Promise<NoteGroupsState> {
  const [groupsRes, membersRes] = await Promise.all([
    supabase.from("note_groups").select("*").eq("user_id", userId),
    supabase.from("note_group_members").select("note_id, group_id").eq("user_id", userId),
  ]);
  if (groupsRes.error) throwPostgrestError(groupsRes.error);
  if (membersRes.error) throwPostgrestError(membersRes.error);
  const groups = sortGroups((groupsRes.data || []) as NoteGroup[]);
  const known = new Set(groups.map((g) => g.id));
  const membership = new Map<string, string>();
  for (const row of (membersRes.data || []) as Array<{ note_id: string; group_id: string }>) {
    if (known.has(row.group_id)) membership.set(row.note_id, row.group_id);
  }
  return { groups, membership };
}

export async function createNoteGroup(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  sortOrder = 0
): Promise<NoteGroup> {
  const clean = normalizeGroupName(name);
  if (!clean) throw new Error("分组名称不能为空");
  const { data, error } = await supabase
    .from("note_groups")
    .insert({ user_id: userId, name: clean, sort_order: sortOrder })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message || "创建分组失败");
  return data as NoteGroup;
}

export async function renameNoteGroup(supabase: SupabaseClient, groupId: string, name: string) {
  const clean = normalizeGroupName(name);
  if (!clean) throw new Error("分组名称不能为空");
  const { error } = await supabase.from("note_groups").update({ name: clean }).eq("id", groupId);
  if (error) throw new Error(error.message);
}

/** 删除分组：只删组和归属关系，笔记回到「未分组」 */
export async function deleteNoteGroup(supabase: SupabaseClient, groupId: string) {
  const members = await supabase.from("note_group_members").delete().eq("group_id", groupId);
  if (members.error) throw new Error(members.error.message);
  const { error } = await supabase.from("note_groups").delete().eq("id", groupId);
  if (error) throw new Error(error.message);
}

/** 把笔记移入分组（groupId 为 null = 移出到未分组）；每篇笔记至多属于一个组 */
export async function moveNotesToGroup(
  supabase: SupabaseClient,
  userId: string,
  noteIds: string[],
  groupId: string | null
) {
  if (noteIds.length === 0) return;
  const removed = await supabase.from("note_group_members").delete().in("note_id", noteIds);
  if (removed.error) throw new Error(removed.error.message);
  if (!groupId) return;
  const { error } = await supabase
    .from("note_group_members")
    .insert(noteIds.map((noteId) => ({ note_id: noteId, group_id: groupId, user_id: userId })));
  if (error) throw new Error(error.message);
}
