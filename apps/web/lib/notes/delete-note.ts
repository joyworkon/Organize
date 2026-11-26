import { mutateTrash } from "@/lib/trash/client";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { findNoteCreate, removeNoteCreate } from "@/lib/offline/note-queue";
import { enqueueNoteDelete } from "@/lib/offline/note-delete-queue";

/**
 * 单篇笔记移入垃圾箱的统一入口（X1 离线语义）：notes 列表页与侧栏笔记树共用。
 *
 * - 在线：`mutate_trash` RPC（直写 deleted_at 被 RLS 拒绝）；成功后若该笔记仍在离线创建
 *   队列（服务端还没有它），丢弃草稿，否则联网回放会把它插回服务端。
 *   `mutateTrash` 成功时已自行广播 organize:notes-changed。
 * - 离线 / 网络错误：入删除队列（organize:offline:note-deletes，联网回放幂等）并返回
 *   "queued"；仍在创建队列里的草稿直接丢弃。
 * - 其它错误原样抛出，调用方负责提示；调用方仍需自行做本地列表移除与计数刷新。
 *
 * userId 是当前登录的用户：两个离线队列都按它隔离存储 key，所以这里只看、只动
 * 本人名下的队列——同一台设备换号后，不会把上一位的离线草稿丢掉或替他排一次删除。
 */
export type MoveNoteToTrashResult = "deleted" | "queued";

export async function moveNoteToTrash(userId: string, noteId: string): Promise<MoveNoteToTrashResult> {
  const queueOffline = (): MoveNoteToTrashResult => {
    if (findNoteCreate(localStorage, userId, noteId)) removeNoteCreate(localStorage, userId, noteId);
    else enqueueNoteDelete(localStorage, userId, noteId);
    return "queued";
  };
  if (!isOnline()) return queueOffline();
  try {
    await mutateTrash("note", [noteId], "soft_delete");
    if (findNoteCreate(localStorage, userId, noteId)) removeNoteCreate(localStorage, userId, noteId);
    return "deleted";
  } catch (error) {
    // 网络错误按离线删除处理——入队待回放，调用方不回滚本地移除
    if (isNetworkSaveError(error)) return queueOffline();
    throw error;
  }
}
