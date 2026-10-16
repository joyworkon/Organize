/**
 * 历史版本恢复前的当前稿保全（migration-plan「历史/冲突/评论」族）。
 *
 * 服务端 restore_note_version 基于服务端当前内容建快照版本：客户端若有
 * dirty / 在途保存的编辑，恢复后会被旧版本覆盖且无处找回。因此恢复入口
 * 在 POST 之前必须先排空保存会话；排空失败（离线 / 冲突 / 网络错误）时
 * 放弃恢复、保留草稿，用户处理保存状态后可重试。
 *
 * 编排不访问 DOM / React，副作用经 deps 注入，行为在相邻 test 中独立验证；
 * 恢复本身的数据协议（RPC、revision 顺序、权限）不在本文件职责内。
 */
export interface HistoryRestoreFlushDeps {
  /** 当前草稿是否有未落库改动（含在途保存） */
  hasPendingWork(): boolean;
  /** 立即保存并等待完成；true = 已保存或本无待保存改动 */
  flushSaved(): Promise<boolean>;
}

/**
 * 恢复历史版本前保全当前稿：有待保存改动时先 flush 并 await 完成。
 * 返回是否放行恢复；false 时调用方不得发起恢复，当前稿保持原状（可重试）。
 */
export async function flushDraftBeforeHistoryRestore(
  deps: HistoryRestoreFlushDeps
): Promise<boolean> {
  if (!deps.hasPendingWork()) return true;
  try {
    return await deps.flushSaved();
  } catch {
    return false;
  }
}
