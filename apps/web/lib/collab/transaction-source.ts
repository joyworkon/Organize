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
