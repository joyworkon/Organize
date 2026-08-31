# ADR 0002: 协作权限模型 = workspace + membership + resource ACL

- 状态: 已接受（P5-01 最小原型 + 064 只读接入均已落地并验证；写权与生产化留给 065 / P5-02）
- 日期: 2026-08-31
- 阶段: P5-01 原型（063，不改业务表 RLS）→ Stage 0 第二张卡（064，只加协作者 SELECT）
- 相关: `supabase/migrations/063_collaboration_acl_prototype.sql`、`supabase/tests/063_collaboration_acl.test.sql`、`supabase/migrations/064_collaboration_read_rls.sql`、`supabase/tests/064_collaboration_read_rls.test.sql`、`docs/ROADMAP.md` P5-01/P5-02、`docs/collaboration-plan.md` 分叉 1

## 背景

多人协作需要先冻结权限模型。仓库里有两份口径冲突的文档：

1. `docs/collaboration-plan.md` 分叉 1-A 主张在 `shares` 上做点对点成员表（`share_members`：一条分享 token 挂若干 user_id + role）。
2. `docs/ROADMAP.md` P5-01 明确要求：**禁止「`visible_user_ids` 让某用户的资源整体可见」**，改用 `workspace_id + membership + resource ACL` 建最小原型，只提交 ADR、最小迁移和双用户/双空间 pgTAP。

`docs/ROADMAP.md` 是本仓库的执行合同（排序原则、每卡验收、完成定义），而
`docs/collaboration-plan.md` 自称「草稿 / 待确认关键分叉点」——草稿让位于合同，且该基线经
用户确认。因此按 P5-01 的 workspace 口径实施：`shares` 上的点对点成员表被 `resource_acl`
取代，公开链接只是「一条特殊的授权」而非权限事实源。

同时仓库已有一批约束不能被协作功能破坏：056 把七处父子关系升级为 `(parent_id, user_id)` 复合外键（同租户）；031/059 的原子保存以 `user_id` + 乐观锁为合同；P0-04 的备份合同 v4 按 `user_id` 白名单收录表。

## 决策

三层结构，判定链只有一个事实源。

| 层 | 表 | 表达什么 |
|---|---|---|
| 身份容器 | `workspaces`（`kind in ('personal','team')`，`owner_id` 唯一权威属主） | 一组人；每账号恰好一个个人空间（partial unique 索引兜底） |
| 成员关系 | `workspace_members(workspace_id, user_id, role)`，`role in ('owner','member','guest')` | 谁在这个空间里、能管不管这个空间 |
| 资源授权 | `resource_acl(workspace_id, resource_type, resource_id, access_role)`，`access_role in ('viewer','editor','owner')` | 某个资源开放给某个空间到什么程度；`owner` 表示控制面（可再授权/可回收） |

判定唯一入口 `public.resource_role(type, id)`（SECURITY DEFINER + 固定 `search_path`）：

```
'owner'  我拥有这条业务行
否则     取「资源已授权的空间 ∩ 我是成员的空间」里最高的 access_role
都没有   NULL（拒读拒写，且不存在/未知类型同样返回 NULL，不泄漏存在性）
```

064 的业务表 RLS 与 065 的保存 RPC **必须调用这个函数**，不得各自重写一份等价 SQL —— 否则三处判定会随迭代漂移成不同的答案。

四条不可妥协的边界（每条都有 pgTAP 负例）：

1. **成员身份本身不给读权**。进了空间不等于看得到空间里的资源；必须是「这条资源被授权给了这个空间」。
2. **`resource_acl` 对客户端只读**。写一律走 `grant_resource` / `revoke_resource` / `transfer_resource_acl` / `reclaim_resource`。表级 UPDATE 策略无法表达「只有资源控制者能动这条授权」：若放开，空间 owner 就能把别人授权进来的资源自升为 `owner`。迁移里用显式 `revoke insert, update, delete` 而不是「不建写策略」，因为 Supabase 全新实例的平台默认权限会给出全 DML，结论会随环境漂移。
3. **空间控制面与资源控制面互不隶属**。移交空间属主不会把成员的资源授权变成新属主可搬运；空间 owner 也不能转授别人资源的授权。反之，资源侧 `access_role='owner'` 才能再授权。
4. **单一 owner 不变量**。`workspace_members.role='owner'` 只允许对应 `workspaces.owner_id` 那一行，造第二个 owner 必须走 `transfer_workspace_ownership`；属主未被摘除（想退出先移交）。

其余取舍：

- 管理与授权 RPC 全是 SECURITY DEFINER：按设计绕过这三张表的 RLS，所以**每个函数必须自带
  `auth.uid()` 校验与显式鉴权守卫**（P0-02 的教训：DEFINER 函数缺属主校验等于开一条提权
  路径）。这里 RLS 只约束「只读可见性」，不承载写授权。
- `resource_acl.resource_id` 是 polymorphic、**不带外键**（三类资源一张表才能表达统一判定）。存在性由 `enforce_resource_acl_target` 触发器在写时校验，业务行硬删时由 `strip_resource_acl` 触发器级联清理，不留幽灵授权。代价是三类资源共用一条判定路径，新增资源类型必须同时改两处映射。
- 个人空间由 `auth.users` AFTER INSERT 触发器补建，并对存量账号跑同一段幂等实现（`provision_personal_workspace`）。该函数接受任意 `user_id`，因此 EXECUTE 只给 `service_role`，客户端仅可用 `ensure_personal_workspace()`。同理 `resource_owner(type,id)` 也只给 `service_role`：它会返回任意资源 id 的属主 uuid，直调等于把「探测别人资源存在性与归属」做成一个 oracle；它只被同为 DEFINER 的判定函数与触发器内部调用，不受影响。
- 软删除（`deleted_at`）不进 `resource_role()` 判定：垃圾箱可见性仍由各业务表自己的策略收口，避免在这里复制一份删除语义。
- `guest` 与 `access_role` 正交：guest 继承所在空间的资源授权，不额外降权。空间内更细的 guest 限制属于产品决定，留待 P5-02。

## 064 落地时追加的三条边界

064 把「授权」变成「看得见」，落地时新增三条本 ADR 未写、但必须冻结的边界。

1. **协作者的写不进 RLS**。三张主表只加协作者 `SELECT` 策略，一条 `UPDATE`/`DELETE` 都没加。
   理由：表级 UPDATE 会绕过 `notes.content_revision` 乐观锁与 `save_mutation_log` 幂等
   （031/059 的合同），等于给协作者开一条「无冲突检测裸写」的路。写权收口在 065 的
   SECURITY DEFINER RPC 里，由它调用同一个 `resource_role()` 判 editor/owner。
   pgTAP 用一条结构断言守这里：三张主表里**引用 `resource_role` 的 UPDATE 策略数为 0**。
2. **`user_profiles` 不存 email**。该表允许本人 UPDATE 自己的行，RLS 不能按列收口，所以
   缓存一份邮箱等于把「邀请落到谁的账上」交给被邀请人自填 —— 攻击者填成受害者地址即可
   劫持邀请。`auth.users` 的邮箱唯一约束是大小写敏感且部分索引
   （`UNIQUE(email) WHERE is_sso_user = false`），本表无法用唯一索引兜住歧义，所以结论是
   邮箱只从 `auth.users` 读：`find_user_by_email` 是唯一查人入口，SECURITY DEFINER、
   btrim+lower 后**精确等值**、不前缀、不通配、不列举、返回不超过一行、匿名直接拒。
   档案可见集只有「自己 + 至少共享一个 workspace 的成员」，表级 `INSERT`/`DELETE` 与
   anon 的 `SELECT` 一律显式收回（同 063 的教训：不靠「没建策略」，否则会随新实例的
   平台默认权限漂移）。
3. **子资源不随共享外溢**。`note_versions` / `task_item_refs` / `note_tags` / `highlights` /
   评论仍按各自 owner-only 策略求值，协作者读到 0 行 —— 共享笔记能正常打开，但历史版本与
   反链为空。这是 Stage 0 已知且刻意的中间态；版本列表与评论留给 065 的 RPC 按角色收口，
   不在这里复制第二套判定。

## 已否决的替代方案

- **`visible_user_ids`（整体可见）**：无法按资源表达差异，无法逐资源回收，一次写错就是全部资源泄漏。ROADMAP 直接禁止。
- **`share_members` 挂在 `shares.token` 上（分叉 1-A）**：权限事实源变成「每条分享链接一份成员名单」，没有身份容器，成员关系随分享重复存 N 份，回收一条链接不能同时回收这个人看到的其他资源；后续 workspace 级语义（空间模板、统一目录、计费）无处安放。`shares` 保留为公开链接的载体；把它原本的 `access_mode` 收敛成「指向一条 workspace 授权」的表现层语法糖是后续工作，**064 刻意未动 `shares`**（`access_mode`/`can_comment` 在 Stage 0 没有消费者，`public_comment` 还需要先有匿名身份机制）。
- **直接给业务表加 `workspace_id` 列**：一次性要改 notes/reading_items/tasks 及其全部子表 RLS、056 复合外键、备份合同 v4 与 `task_item_refs` 的字段清单，违反「一张卡只做一个 PR」且不可回滚。改为先用 ACL 附加关系，逐域迁移留给 P5-02。

## 不在本原型范围内（P5-02 待办）

1. **业务行属主转移（`notes.user_id` 改写）不做**。056 的 `(id, user_id)` 复合外键、`task_item_refs` 的同租户约束与备份合同 v4 都以 `user_id` 为键，改属主等于跨租户搬迁，必须逐资源域设计并配套测试。当前只支持**控制面转移**（`transfer_resource_acl`）。
2. **三张协作表与 `user_profiles` 都不进备份合同 v4**。跨账号恢复属主行的 ACL 等于把 A 的共享关系塞给 B，得先定义 remap 语义（授权目标是空间，而空间不在备份白名单里）。恢复后授权丢失是**已知且刻意**的行为，必须在 manifest 的排除清单里写清。`user_profiles`（064）另有一层理由：它是**可再生的镜像** —— `auth.users` 触发器 + 幂等 backfill 会为每个账号重建，导出它只会带上展示字段，而跨账号恢复等于把别人的昵称/头像塞进新账号；并且它以 `id`（= user id）为键而非 `user_id` 列，与 v4 的「按 `user_id` 白名单收录」形状不符。账号删除时它通过 `references auth.users on delete cascade` 一并级联。
3. **业务表 RLS 接入协作（064）已落地**：三张主表各一条协作者 `SELECT` 策略 + `user_profiles`
   与 `find_user_by_email`（见上文「064 落地时追加的三条边界」）。063 单独合并时没有任何业务
   数据对协作者可见；064 合并后，**被显式授权的那一条**才对空间成员可读，写权仍未放开。
   **保存 RPC 按角色分权（065）、前端分享面板与「共享」页** 属 Stage 0 后续 PR。前端卡不带
   `/api/*` 路由决定之前，mock 后端无需 `api-shim` 条目；「真实与 mock 对齐」的决定留到那张卡做。
4. **协作者归属列不存在，必须先建再写**。`docs/collaboration-plan.md` 的前提「038 预留了
   `notes.last_edit_by` 列位」经实测为假：本机 `notes` 有
   `id / user_id / title / content / reading_item_id / created_at / updated_at / is_pinned /
   deleted_at / icon / cover_url / cover_position / parent_note_id / full_width / font_family /
   small_font / content_revision / search_text`，没有 `last_edit_by`，且 `supabase/migrations/`
   全文未出现过这个名字。因此 065 不能「保存时顺便写一下谁改的」——加列要同时动迁移、
   备份合同 v4 字段清单、mock seed 与既有原子保存测试，是一张独立的卡。
5. **实时协同（presence / CRDT）不依赖本 ADR 的写权限模型**：`resource_role()` 只回答「能不能写」，不回答「谁在写」。Stage 1/2 复用同一判定，不引入第二套权限事实源。
6. **账号删除级联**：`workspaces.owner_id`、`workspace_members.user_id`、`resource_acl.created_by` 均 `references auth.users on delete cascade`，P2-02 的账号删除 API 无需改动即覆盖这三张表 —— 该结论来自读迁移定义，未额外写测试。
