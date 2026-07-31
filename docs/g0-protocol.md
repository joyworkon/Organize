# G0 协议冻结 — 任务 ↔ 笔记待办双向链接

> 阶段 G0 仅产出本文档 + ADR 0001。清单不完整不得进 G1。本文档是 G1–G4 的唯一协议依据。

## 1. 术语

| 术语 | 含义 |
|---|---|
| **canonical task** | `tasks` 表的一行，是某个待办的唯一事实源 |
| **TaskItem 节点** | 笔记 `notes.content` 里的 `taskItem` 块，新增 `taskId` 属性后成为引用 |
| **绑定块** | 有 `taskId` 的 TaskItem(指向 canonical task) |
| **legacy 项** | 历史无 `taskId` 的 TaskItem(尚未激活成任务) |
| **reference_managed** | tasks.reference_managed=true 的任务，生命周期由引用托管(末引用消失→垃圾箱) |
| **独立任务** | reference_managed=false，允许零引用(用户在任务页直接建的) |

## 2. 写入口清单(notes.content 的全部写入路径)

> 来源:任务 0 调研。共 6 条应用路径 + 2 条 DB 侧路径。**G1 原子保存 RPC 必须覆盖所有路径或显式声明降级。**

| # | 路径 | 写法 | 全量/部分 | 触发 | 同步策略 |
|---|---|---|---|---|---|
| 1 | 编辑器 autosave (`page.tsx` flushSave L225-252) | 直连 Supabase `.update(snapshot)` | 全量快照 | TipTap onUpdate，900ms 防抖 | **改为走 RPC**(G1)：snapshot 内含 taskItem 块，RPC 在事务内对齐引用 |
| 2 | `POST /api/notes`(建笔记) | API insert | 全量 | convertBlockToPage / database-page(默认空) | 新笔记默认空，无 taskItem；RPC 兼容(若传 content 含 taskItem 则处理) |
| 3 | 复制笔记 (`duplicateNote` L414-461) | 直连 Supabase insert | 全量 | 用户复制 | **复制绑定块=同任务新引用**：RPC/客户端在复制时为绑定块新增 task_item_refs 行(同 taskId) |
| 4 | 版本恢复 (`POST /api/notes/[id]/versions/[versionId]`) | API update content | 全量覆盖 | 历史对话框 | **系统事务**：只恢复"引用了哪个 taskId 的布局"，不回滚 canonical task 状态；系统不得激活 legacy |
| 5 | 备份恢复 (`restore_backup_v2_with_pages` RPC) | DB RPC insert | 全量 | restore-to-empty | **系统事务**：备份里的 taskId 在 id remap 后重建 task_item_refs；不覆盖 canonical task |
| 6 | `PATCH /api/notes/[id]` | API partial | 部分(若有 content) | 暂无明显调用方(vestigial) | RPC 兼容：若走此路且含 content，同样对齐引用 |
| A | `move_note_block` RPC (migration 004) | DB jsonb_set 两个笔记 | 全量重写 | 块右键菜单"移到页面" | **系统事务**：移动绑定块=同任务引用换 note_id/block_id；RPC 拦截或 trigger 捕获 |
| B | `save_note_version` trigger (migration 010) | 读 content 写 note_versions | 只读 content | 每次 notes update | 不改 content；版本快照里保留 taskId 属性(随块一起存) |

## 3. TaskItem 状态机

TaskItem 节点本身两态(checked/unchecked)，但"是否绑定任务"决定其行为：

```
                ┌─────────────────────────────────────────────┐
                │           legacy 项(无 taskId)              │
                │   attrs: { checked, id(block id) }          │
                └─────────────────────────────────────────────┘
                       │ 用户真实改字 或 勾选(user-edit)
                       ▼  激活: 建 canonical task + 写 taskId
                ┌─────────────────────────────────────────────┐
                │           绑定块(有 taskId)                 │
                │   attrs: { checked, id, taskId }            │
                │   task_item_refs: (note_id, block_id)→task  │
                └─────────────────────────────────────────────┘
                       │ ↑↓ 双向同步(仅标题+完成状态)
                       ▼
                ┌─────────────────────────────────────────────┐
                │      canonical task(tasks 表，事实源)        │
                │   status: todo/in_progress/done/cancelled   │
                └─────────────────────────────────────────────┘
```

### checked ↔ status 映射(笔记侧)
| TaskItem.checked | canonical status | 说明 |
|---|---|---|
| `true` | `done` | 勾选→任务完成 |
| `false` + 显式取消 | `todo` | **只有显式取消才回 todo** |
| `false` | `in_progress`/`cancelled` | 显示未勾选 + 徽标(不自动改 status) |

**关键**：笔记侧勾选=done；但取消勾选**不**自动回 todo(因为 in_progress/cancelled 不该被一次误点清空)。只有用户在任务页显式改回 todo 才回 todo。

## 4. 事务分类(决定是否激活/sync/进 Undo)

| 事务类型 | 来源 | 激活 legacy? | 生成 task mutation? | 进 Undo? | 同步 canonical? |
|---|---|---|---|---|---|
| **user-edit** | 用户在编辑器改字/勾选/新建 taskItem | ✅ 是 | ✅ 是(建/改 task) | ✅ 是 | ✅ 双向 |
| **hydrate** | 打开笔记、Realtime 远端推入 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 只更新本地显示 |
| **remote-sync** | 另一标签页/设备改了同一笔记 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 只更新本地显示 |
| **version-restore** | 版本恢复(路径4) | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 只恢复引用布局，不动 canonical |
| **backup-restore** | 备份恢复(路径5) | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 只重建 task_item_refs(remap 后) |
| **move-block** | 移动块到另一笔记(路径A) | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 只换 ref 的 note_id/block_id |

**判定原则**：只有"用户当前在本标签页主动操作编辑器"才是 user-edit。其余全是系统事务，不得激活、不得 mutation、不得 Undo。区分手段(G2)：事务携带 `source` 标记，或比较 mutation_id/revision。

## 5. 操作矩阵(复制/移动/Undo/版本恢复/分享/备份/删除/并发)

| 操作 | 绑定块行为 | legacy 项行为 | canonical task 行为 | task_item_refs |
|---|---|---|---|---|
| **复制笔记** | 复制为同任务新引用(同 taskId) | 复制为 legacy(无 taskId) | 不变 | 新增 (new_note_id, new_block_id)→同 taskId |
| **复制单块到同笔记** | 同任务新引用 | 新 legacy | 不变 | 新增 (note_id, new_block_id)→同 taskId |
| **纯文本/外部粘贴** | **新任务**(不复用 taskId) | 新 legacy | 新建 task | 新增 ref 指向新 task |
| **移动块到他笔记** | ref 换 note_id/block_id | 随块移动(仍 legacy) | 不变 | 更新 ref 的 note_id/block_id |
| **删除块** | 解除该 ref | 删除 legacy | reference_managed 且末引用消失→垃圾箱；独立任务不变 | 删该 ref 行 |
| **删除整笔记** | 解除该笔记所有 ref | 随笔记软删 | reference_managed 任务若末引用消失→垃圾箱 | 删该 note 全部 ref |
| **Undo 删块** | 恢复块+恢复 ref | 恢复 legacy | **若已进垃圾箱则不复活**(tombstone 永久)；末引用回来了则恢复 ref | 重建 ref |
| **版本恢复** | 恢复"块引用了哪个 taskId"的布局 | 恢复 legacy(不激活) | **不回滚** canonical 状态 | 按快照重建 refs(只增不覆盖 canonical) |
| **备份恢复** | remap taskId 后重建 ref | 恢复 legacy | 按备份重建(空账号场景) | remap 后重建 |
| **分享/导出** | **移除 taskId** + 私有能力 | 保留(无 taskId 可移) | 不含 | 不导出 refs |
| **并发新增同任务** | 后到者 winning-write，前者 ref 仍在 | — | 标题/状态以 mutation_id+revision 仲裁 | 两条 ref 都保留(同 task 多引用合法) |
| **跨用户伪造** | 拒绝(RPC 校验 auth.uid) | — | 拒绝 | RLS 拦截 |

### 删除/垃圾箱规则(细化)
- 删除一个绑定块 = 删一条 task_item_refs 行 + 块从 content 移除。
- reference_managed 任务：当其**最后一个活动 ref** 消失 → 任务进**可撤销垃圾箱**(soft delete, deleted_reason='orphaned')，UI 可恢复。
- 独立任务(reference_managed=false)：零引用也保留，用户手动删才进垃圾箱。
- **手动删除的任务显示 tombstone**，Undo/版本恢复/备份恢复**不得**复活已 tombstone 的任务(防幽灵)。
- 有活动引用的任务**禁止永久删除**(hard delete)。

## 6. 数据模型变更(G1 实现，此处仅冻结 schema)

```sql
-- task_item_refs: 引用关系
create table task_item_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  task_id uuid references tasks on delete cascade not null,
  note_id uuid references notes on delete cascade not null,
  block_id text not null,                 -- content 里 taskItem 的 attrs.id
  created_at timestamptz default now() not null,
  unique (note_id, block_id)              -- 一个块最多引一个任务
);

-- tasks 新增列
alter table tasks add column reference_managed boolean default false not null;
alter table tasks add column sync_version integer default 0 not null;
alter table tasks add column deleted_reason text;   -- 'orphaned' | 'manual' | null

-- notes 新增乐观锁列
alter table notes add column content_revision integer default 0 not null;
```

- 旧 `tasks.note_id` **暂留**但不计块引用(向后兼容，不删数据)。
- `task_item_refs.block_id` 对应 TaskItem 节点的 `attrs.id`(已有 UniqueID 扩展生成)。

## 7. 原子保存 RPC 契约(G1 实现)

```
save_note_with_tasks(
  p_note_id uuid,
  p_content jsonb,               -- 笔记全量快照(含 taskItem 块)
  p_expected_note_revision int,  -- 乐观锁
  p_title text default null,
  p_task_mutations jsonb default null,  -- [{task_id, title?, status?, expected_sync_version?}]
  p_expected_task_revisions jsonb default null,  -- {task_id: rev} 乐观锁
  p_mutation_id uuid default null        -- 幂等键
) returns { note_revision, task_revisions }
```

事务内:
1. `select ... for update` 锁 note 行 + 涉及的 task 行。
2. 校验 `auth.uid() = note.user_id` 及各 task.user_id。
3. 幂等:若 mutation_id 已处理过则直接返回上次结果。
4. 校验 expected revisions，不匹配→返回冲突(不覆盖)。
5. 保存 note.content + content_revision+1。
6. 应用 task_mutations(只标题+status)，tasks.sync_version+1。
7. **对齐 task_item_refs**：从 p_content 里解析所有有 taskId 的 taskItem 块→重建该 note 的 refs(upsert by block_id)；删除该 note 不再出现的 ref。
8. **回收 orphaned**：reference_managed 任务若活动 ref 数=0 → soft delete(deleted_reason='orphaned')。
9. 快照 p_content **禁止覆盖** canonical task(只解析引用，不写回 task 内容)。

## 8. G0 完成标准(自查)
- [x] ADR 0001 已写
- [x] 写入口清单(8 条)完整
- [x] TaskItem 状态机(legacy→绑定→canonical)
- [x] 事务分类(user-edit vs 5 类系统事务)
- [x] 操作矩阵(11 列操作 × 4 维度)
- [x] 数据模型 schema 冻结
- [x] 原子保存 RPC 契约

**清单完整，可进 G1。**
