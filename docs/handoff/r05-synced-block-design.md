# R05 同步块重开、离线、并发完整性 — 设计与实施记录

状态：已实施（与代码同 PR）。先写设计后实施，符合高风险卡协议。

## 1. 现状缺口盘点（实施前确认）

| 缺口 | 证据 |
|---|---|
| `hydrated` 是持久化属性，保存为 true 后重开跳过服务端拉取 | `synced-block.tsx` 挂载 effect `if (node.attrs.hydrated) return`；JSON 保存路径不重置该属性（仅 HTML parseHTML 重置） |
| PATCH 无并发检查，last-write-wins 静默覆盖 | 027 迁移无 revision 列；route 直接 update |
| 无离线 pending 持久化，刷新丢未同步内容 | R04 前无 pending 概念；R04 仅有内存 pendingRef |
| 跨设备无更新机制 | 无订阅、无可见性驱动重验证 |
| mock 下 /api/synced-blocks 返回 501 | api-shim ROUTES 无该路由 |
| 备份恢复 insert 无 on conflict | 027 `restore_backup_v2_with_pages` 裸 insert（恢复到非空账户已有同 id 行会失败——既有边界，本卡不改，见 §6） |

## 2. 接口

### DB（迁移 073）
```sql
alter table synced_blocks add column revision integer not null default 1;
```
- 不回填（default 1 即语义）；RLS/GRANT 沿用 027；备份导出为显式列清单，不含 revision，备份合同不变；恢复 insert 不带 revision → default 1。

### PATCH /api/synced-blocks/[id]
- 请求：`{ content, expected_revision }`
- 成功 200：`{ id, content, revision, updated_at }`（revision = expected + 1）
- 冲突 409：`{ error, current: { revision, content } }` —— 服务端原子比较：`update ... where revision = expected`（单条 UPDATE 内完成，非 SELECT 后 UPDATE）
- expected_revision 缺失（旧客户端兜底）：不比较直接覆盖，仍返回新 revision
- 401 / 500 语义不变

### GET /api/synced-blocks?ids=
- 行带 `revision`。

### 幂等与重试
- 重试沿用同一 pending 快照 + 同一 expected_revision；若第一次实际已写入（响应丢失），重试命中 409，且 409.current.content == pending 时判为"已同步"（幂等命中），更新本地 revision。

## 3. 组件状态变化（SyncedBlockView）

- `status`: `loading | saved | saving | error | conflict | stale`
  - `conflict`：PATCH 409 且远端内容 ≠ 本地 pending → 两个显式动作「用本地覆盖远端」（带 409 返回的 current.revision 强制写）/「拉取远端」（丢弃本地）；默认不覆盖远端
  - 409 且远端内容 == pending → 幂等命中：视为已同步（更新 revision）
  - `stale`：本地有 pending 时收到远端更新（GET 刷新 / 挂载拉取）→ 不自动覆盖也不自动补交（补交会以服务端新 revision 成功写入 = 静默覆盖）；显示「远端有更新」+ 同两个显式动作
- `revisionRef`: 服务端确认的最新 revision（不写入文档 JSON）。**保护规则**：pending 与远端分叉时不得用远端 revision 覆盖基准，否则任何后续 flush 都会变成静默覆盖
- pending：内存 + localStorage `organize:synced-pending:{userId}:{syncedId}`（键含 userId，换账号天然隔离；含 content/revision/savedAt）
  - 组件内 pending 唯一写入口 `setPending(content|null)`：编辑（onTransaction）与重试都走它
  - 挂载恢复：读回 pending 后以 stored.revision 为基准拉取远端：
    - 远端与 pending 一致（幂等）→ 直接收敛（不 PATCH，白增 revision）
    - 远端分叉 → stale + 显式动作（不自动补交）
    - 拉取失败 → 保留 pending，可用块内状态补交（基准 = stored.revision，分叉会回 409）
  - flush 成功清除存储；写存储失败不阻塞（保持内存 pending，页面摘要仍显示待同步）

## 4. hydrated 语义变更（兼容）

- 文档 JSON 中 `hydrated` 属性保留读写（不批量改历史 JSON），但组件**忽略其网络可信性**：挂载即视为未注水，一律 GET。
- GET 成功且无 pending：内容 JSON 与本地一致则不 dispatch（避免打断光标），不一致才替换（远端 meta，不进历史）。
- 创建路径（insertSyncedBlock 回填 syncedId）不受影响：新块服务端内容为空段落，与本地一致 → 不 dispatch。

## 5. 跨设备更新

- `visibilitychange → visible` / `window focus` / `online` 触发 `refreshRemote()`（GET），5 秒节流。
- 无 pending：远端新内容替换（用户无未同步改动，安全）；有 pending：置 stale 提示。
- 不使用 BroadcastChannel 冒充跨设备；不新增 realtime 订阅。

## 6. 明确不改（缺口留档）

- 备份恢复 insert 无 on conflict（重复恢复需先清空账户——既有约束，恢复流程已有非空 409 合同校验兜底）。
- 块删除后的 synced_blocks 孤儿行清理（原行为即无清理）。
- 多实例跨设备 CRDT 级合并（超出本卡，协议为"默认不覆盖 + 显式动作"）。

## 7. 页面保存摘要

- 组件在 pending 出现/清除时派发 `window` 事件 `organize:synced-block-status`（detail `{ syncedId, pending: boolean }`）。
- 笔记页顶栏监听聚合并显示「N 个同步块待同步」（琥珀色，与"已保存"并存）——页面不再因自身保存成功而笼统宣称全部同步。

## 8. 回退方案

- revert 本 PR 即回到 R04 行为；`revision` 列留存无害（旧代码不读写）；localStorage pending 键残留不影响（新代码才读）。

## 9. 验证与未覆盖

- 单测：传输层 expected_revision/409/幂等命中、pending 持久化读写与账号隔离、hydrated 忽略后挂载必拉取、api-shim mock 同形状。
- pgTAP（073）：revision 列存在、默认 1、乐观 UPDATE 语义（where revision=expected 影响 1 行；过期 expected 影响 0 行）。
- 未覆盖（如实记录）：两浏览器真实并发编辑的端到端演示依赖真实协作场景安排；本卡协议层（原子 UPDATE 语义 + 409 流程）由 pgTAP 与单测覆盖。
