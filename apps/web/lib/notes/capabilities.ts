import type { CollabRole } from "@/lib/collab/roles";

/**
 * 笔记页能力集中派生（R08.5）：owner/editor/viewer 的展示与可操作性
 * 从角色一次性推导，页面不再散落 `noteRole === "viewer"` 比较。
 * 语义与抽离前完全一致：null（未判定）不按 viewer 处理（保持加载期可编辑的既有行为）；
 * 权限的真实收口仍在保存 RPC 与 RLS——这里只影响展示与入口可用性。
 */
export interface NotePageCapabilities {
  /** 编辑器可写（viewer 只读） */
  canEdit: boolean;
  /** 是否仅查看身份（顶栏角标等展示用） */
  isViewer: boolean;
  /** 标签等属性行的移除入口 */
  canModifyTags: boolean;
}

export function deriveNotePageCapabilities(role: CollabRole | null): NotePageCapabilities {
  const isViewer = role === "viewer";
  return {
    canEdit: !isViewer,
    isViewer,
    canModifyTags: !isViewer,
  };
}
