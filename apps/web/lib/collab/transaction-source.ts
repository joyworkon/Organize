/**
 * 笔记内容变更来源（G0/G2 协议）：
 * - user：用户编辑（走原子 RPC、可生成任务 mutation）
 * - hydrate / remote-sync / version-restore / backup-restore：系统事务，
 *   不标脏排队保存或跳过任务激活——见 docs/g0-protocol.md §4
 */
export type TransactionSource =
  | "user"
  | "hydrate"
  | "remote-sync"
  | "version-restore"
  | "backup-restore";

/** 事务元数据读取的最小形状（TipTap Transaction 满足；测试可传 fake）。 */
export interface TransactionMetaReader {
  getMeta(key: string): unknown;
}

/**
 * 从事务元数据解析变更来源（B05 自 tiptap-editor onUpdate 内联判定隔离，逐字保持）：
 * - y-sync$ meta 存在 → 协作 y-sync 事务（远端协作者的变更推入）= remote-sync，
 *   优先级最高：远端事务绝不能落成 user（否则会触发保存/任务激活等用户副作用）；
 * - 否则读 transactionSource meta（hydrate/version-restore/backup-restore 等系统标记）；
 * - 都没有 → user。
 */
export function resolveTransactionSource(transaction: TransactionMetaReader): TransactionSource {
  if (transaction.getMeta("y-sync$")) return "remote-sync";
  return (transaction.getMeta("transactionSource") as TransactionSource) || "user";
}
