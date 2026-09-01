# PROGRESS

## P5 收尾：reading_items 域属主移交 transfer_reading_item_ownership（2026-09-01，069）

- 分支 `feat/p5-transfer-reading-item-ownership`（master = b973fa9，迁移到 069）
- 卡源：068 遗留 #1「reading_items / tasks 域的属主迁移是后续独立卡（逐域原则）」；
  本卡只做 reading_items 域，tasks 域仍留待后续

### 拍板的产品决策（沿 068 授权惯例代决）

1. **高亮随迁是唯一无损语义**：highlights.reading_item_id 是 NOT NULL 外键（014），
   高亮行要么随条目易主、要么删行——置空不存在，删行是丢数据。随迁行上指向
   非接收人名下笔记/任务的 note_id/task_id（042 引用列）顺手置空
2. **接收人必须先持有 editor 授权**（「先共享后移交」，与 068 同一判定链：
   resource_role_for 已由 068 抽出，本卡零判定 SQL）
3. **标签同名复制到接收人名下（已有同名则复用）**：item_tags 经 RLS 随条目走，
   tag 指向旧属主的 tags 行，不复制则两侧备份引用校验都断；旧属主原始标签保留
4. **反向引用清理（非接收人名下）**：notes/tasks/lessons 的 reading_item_id 置空
   （接收人名下的同引用行刻意保留——转移后同租户合法）、favorites 删除、
   shares（公开链接）删除；resource_acl 不动（旧属主通常仍以 editor 保留）

### 实现

1. **迁移 069**：`transfer_reading_item_ownership(item_id, new_owner) returns jsonb`
   （highlights_transferred + tags_copied counts），行锁 + 6 类显式拒绝（匿名 / 非属主 /
   自移自 / 接收人不存在或无 editor / 垃圾箱）；单条数据修改 CTE——reading_items 域
   无 056 复合外键牵连、无 deferrable 触发器，无需推迟约束
2. **备份合同 v4 无 schema 变化**（同 068 逻辑：转移 = 行易主，导出按 RLS 圈行
   语义自洽）；pgTAP 断言转移后两侧可见集合无悬空引用
3. **UI**：NoteShareDialog 泛化为 ResourceShareDialog（resourceType 参数化文案 +
   grant/revoke/邀请/移交全段，公开链接段本就走 /api/share 的 resource_type）；
   文章详情页 library/[id] 换用（替换公开链接-only 的旧 ShareDialog，卡片入口不动），
   新增 reading_item 角色判定（属主看 user_id、协作者调 resource_role、失败按 viewer）
   + 移交确认框如实交代连带语义；notes/[id] 同组件同文案，行为不变
4. **mock**：transfer_reading_item_ownership 加入 COLLAB_MANAGEMENT_RPCS 显式报错
   清单 + 测试；mock 下面板候选为空、RPC 报错如实展示

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 123 文件 / 896 用例全绿（数量与基线持平）；
  next lint（CI 同款）0 警告；`next build` exit 0
- **本地 Docker 拉取通道已恢复**（BLOCKED.md 记载的 hang 不再复现），`supabase test db`
  本机全新库实跑：**23 文件 / 582 断言全绿**（069 新增 40 断言）

## P5 收尾：笔记属主移交 transfer_note_ownership（2026-08-31，068）

- 分支 `feat/p5-transfer-note-ownership`（master = 9fccdde，迁移到 068）
- 卡源：ROADMAP P5-02 待办末条「逐域迁移业务行属主（一次一个资源域）」+ BLOCKED.md
  勘察笔记；本卡只做 notes 域，reading_items / tasks 域归后续独立卡

### 拍板的产品决策（用户授权代决）

1. **任务同转是唯一语义，不提供断链**：前端每次保存都把 content 里带 taskId 的块
   提取成 mutations，断链后新属主每次保存必撞 conflict_task（笔记存不了）；静默删块
   是数据丢失。连带转移引用任务 + 全部子任务；跨笔记引用的任务 / 跨界依赖边 →
   显式拒绝（fail-closed），根任务脱离原父任务与清单（不把移交放大成整棵树搬家）
2. **接收人必须先持有 editor 授权**（「先共享后移交」，防误移交 + uuid 试探）；
   判定复用 063 判定链——`resource_role` 抽成参数化内核 `resource_role_for`
   （internal，service_role 专用），对外 `resource_role` 改薄委托，消费方（064 RLS /
   065 权限闸）不变
3. **标签同名复制到接收人名下（已有同名则复用）**：task_tags/note_tags 行随属主走
   但 tag 指向旧属主的 tags 行，不复制则两侧备份引用校验都断；旧属主原始标签保留
4. **评论线程 / 评论 / 建议随笔记转移**（056 复合外键把 user_id 钉成租户列，不搬则
   FK 炸、搬则按租户解释作者列——既定合同的取舍，非本卡新引入）
5. **反向引用清理**（非接收人名下）：lessons/highlights 的 task_id/note_id、
   tasks.note_id、db_databases.parent_note_id 置空，favorites 删除，shares（公开
   链接）删除——否则两侧备份导出 BROKEN_REFERENCE，且旧属主不应保留指向新属主
   内容的公开口；notes.reading_item_id / 移动任务的 reading_item_id、list_id 置空

### 实现

1. **迁移 068**：`transfer_note_ownership(note_id, new_owner) returns jsonb`（counts），
   行锁 + 8 类显式拒绝（匿名 / 非属主 / 自移自 / 接收人不存在或无 editor / 垃圾箱 /
   有父页面 / 有子页面 / 跨笔记引用 / 依赖跨界）；大迁移用单条数据修改 CTE 搬齐全部
   056 复合外键绑定的 user_id，040/041 的 deferrable constraint trigger 以
   SET CONSTRAINTS DEFERRED→IMMEDIATE 包裹（同语句中间态不误炸，正常路径不变）
2. **备份合同 v4 无 schema 变化**：转移 = 行易主，导出按 RLS 圈行语义自洽；pgTAP
   逐表断言「转移后两侧各自可见集合内无悬空引用」代替合成往返用例
3. **UI**：分享面板属主视图新增「移交属主」段——候选 = 持有 editor 授权空间的成员
   （workspace_members + user_profiles 直读，RPC 端权威复核），showConfirm 危险确认
   （连带语义逐条交代），成功后整页重载按新角色重建保存管线；服务端每类拒绝都有
   如实中文文案；mock 下候选为空 + RPC 显式 P5-02-MOCK（面板如实展示，不假成功）
4. **mock**：transfer_note_ownership 加入 COLLAB_MANAGEMENT_RPCS 显式报错清单 + 测试

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 123 文件 / 896 用例全绿（数量与基线持平）；
  next lint（CI 同款）0 警告；`next build` exit 0
- pgTAP 068（64 断言）：结构 / EXECUTE 分层 / 委托后判定链语义 / 8 类拒绝矩阵 /
  同转逐表归属 / 转移后 B 保存 ok + A(editor) 保存 ok + C(viewer) 拒 / 反向移交
  标签复用。**本机 Docker 拉取通道仍坏**（`docker pull alpine` hang，`supabase start`
  含排除服务两轮均卡死，证据同 BLOCKED.md），以 PR CI db-test 全新库实跑为准

### 遗留 / 边界

1. reading_items / tasks 域的属主迁移是后续独立卡（逐域原则）
2. 层级移交（整棵笔记子树）、依赖边自动解除、跨域（笔记↔阅读条目）整体移交均不在
   本卡；拒绝报错已给出用户可执行的解法
3. content 级跨笔记引用（内部链接、同步块、数据库块）随 043/既有失败降级优雅呈现，
   不在 DB 层处理

## P5 后续产品卡：协作空间管理 UI（2026-08-31）

- 分支 `feat/workspace-management-ui`（master = 470b6dc，无迁移）
- 卡源：P5-02 卡 4 遗留 #3——063 的空间管理 RPC（改角色/移除/移交/建空间）已有但无界面

### 实现

1. **`/spaces`「协作空间」页**：我参与的 team 空间列表（063 RLS 直读
   workspaces/workspace_members + 064 user_profiles 拿姓名头像，无新 RPC）；
   视图装配与错误文案抽成纯函数 `lib/collab/workspace.ts`（8 用例）
2. **属主操作**：重命名（RLS UPDATE 只放行 owner）、成员角色 member/guest
   （update_workspace_member_role）、移出成员、移交所有权（transfer 前二次确认）、
   解散空间（RLS DELETE，级联撤销全部授权，文案明示）
3. **成员操作**：退出空间（remove_workspace_member 自助入口）；「所有者需先移交才能
   退出」由服务端拒绝 + 页面文案如实呈现
4. **入口**：侧边栏「协作空间」条件入口（useHasTeamWorkspaces limit 1，紧跟
   「与我共享」成组；mock 恒隐藏）；笔记分享面板协作空间段加「管理成员」链接
5. **roles.ts 增成员管理面三角色**（owner/member/guest，与资源 access_role 正交）：
   isWorkspaceMemberRole + workspaceMemberRoleLabel
6. **邀请不进本页**：邀请与授权是同一动作（ADR 0002），仍走笔记分享面板

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 123 文件 / 896 用例全绿（+1 文件 +10 用例）；
  next lint（CI 同款）0 警告；`next build` exit 0（/spaces 路由产出）
- 无迁移，pgTAP 不适用；mock 行为：空间查询为空集（单用户世界）+ 管理 RPC 显式
  P5-02-MOCK 报错（既有合同），页面如实展示

# PROGRESS

## P5-03 生产化卡：collab ydoc blob 持久化 + 播种租约（2026-08-31）

- 分支 `feat/collab-ydoc-persistence`（master = 3224fd3，迁移到 067）
- 卡源：ADR 0003「持久化（生产化卡）」——P5-03 遗留两件事：collab 进程重启丢内存
  文档；空房间并发播种竞态（两客户端各自播种出重复段落）

### 实现

1. **迁移 067 `note_ydocs`**（note_id PK/FK 级联、bytea、RLS）：blob 是派生缓存
   （notes.content 才是事实源），刻意不进备份合同 v4（EXPORT_EXCLUSIONS 显式声明
   `note_ydocs`）也不进 mock（协作层 mock 下整体不启用）。表对 anon/authenticated
   无直接权限（仿 057），读写走两个 DEFINER RPC（复用 063 `resource_role`：读
   owner/editor/viewer、写 owner/editor；base64 进出不依赖 PostgREST bytea 映射；
   4MB 护栏）。**新鲜度规则是数据安全关键**：`get_note_ydoc` 仅在
   `blob.updated_at >= notes.updated_at` 时返回——正文存在非协作写入路径（离线
   v1/v2、move-block、恢复），若无条件回放，重启后旧 CRDT 会遮蔽新内容并被客户端
   快照反向覆盖（丢数据）；过期 → null → 走播种路径，播种后自愈
2. **collab-server**：`onLoadDocument` 回放 blob；`onStoreDocument`（内置防抖 2s）
   以最后写者 JWT 落库 `encodeStateAsUpdate` 全量快照，失败只记日志不炸房间
   （可读内容仍有客户端 v2 节流快照兜底）；token 来自连接 context，会话 JWT 过期后
   落库失败 = 等下次会话重建（快照链不受影响）
3. **播种租约（`src/seed-lease.ts` + 无状态消息协议）**：ADR 修订——不把编辑器
   schema 搬上服务端（自定义扩展深度耦合 React/Next/数据库 UI，平行 schema 必然
   漂移，且漂移后仍要回退客户端播种）。改为服务端仲裁的客户端播种：
   `{"t":"seed-req"}` → `seed-grant/wait/deny`，服务端单线程判定天然原子，同一
   房间只发一份 grant（8s 租约、3 次封顶）；客户端获准才 `setContent(seedContent)`
   （DB 原始快照，mount 期 UniqueID 回填坑的注释保留），未获准方等 y-sync 推内容
4. 协议消息量：仅空房间进入时的几次小 JSON，正常编辑零额外消息

### 测试

- pgTAP 067（30 断言）：结构/RLS/表权限回收、EXECUTE 分层、四角色读写矩阵、
  upsert 覆盖、**新鲜度过期与自愈**、空/超 4MB 拒绝、软删读写全拒、硬删级联清行
- collab-server 引入 vitest（与 web 同版本 4.1.10）：租约状态机 5 用例（grant/wait
  互斥、到期惰性回收、封顶 deny、markSeeded 终结）
- 备份 schema.test +1：新导出 manifest 声明 `note_ydocs` 排除且校验通过

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 122 文件 / 886 用例全绿（+1）；
  next lint（CI 同款）0 警告；`next build` exit 0；collab-server `tsc` 0 错
- **pgTAP 本机被环境卡死**（Docker daemon 拉镜像通道 hang、supabase CLI 需要新
  postgres 镜像 17.6.1.166、完整栈还缺 analytics/pooler 新服务镜像；本地已缓存镜像
  retag 后 db 可起但 storage schema 依赖全栈）：以 PR CI db-test（全新库实跑）为准，
  详见 BLOCKED.md。CI db-test 三轮：第 1 轮 lives_ok 用法错（测试代码）；第 2 轮
  **抓到真安全洞**——`v_role not in ('owner','editor')` 对陌生人（NULL）不触发，
  写入穿透 DEFINER 的 INSERT，改 `is distinct from`（迁移头有注释）；同轮修
  新鲜度断言的 pgTAP 单事务 now() 冻结问题（056「分钟级抖动」同源），改为显式回拨
  blob 时间；第 3 轮见 PR

### 遗留 / 边界

1. blob 不回放自愈的方式是「重新播种」：CRDT 历史（tombstone/ Undo 栈）不迁移，
   播种后房间按新文档起步——content 本身无损，版本历史照常
2. 会话 JWT 过期后 onStoreDocument 落库失败只记日志（客户端快照兜底）；生产化可加
   token 同步（Hocuspocus onTokenSync）
3. 协作模式下冲突对话框仍不可达（expected_revision=null，ADR 0003 既定），保留给
   降级路径

# PROGRESS

## P5-03：实时协同技术验证——Yjs + Hocuspocus（2026-08-31）

- 分支 `feat/p5-03-collab-realtime`（master = 40a394f，无 DB 迁移）
- 决策：ADR 0003 拍板 **Yjs CRDT + 自托管 Hocuspocus**（`apps/collab-server`，新 workspace 包）。
  否决 Supabase Realtime Broadcast（本地已知 signature_error + 无生产级 y-transport 封装）
  与 y-webrtc（NAT 不可控）。用户已确认可自备常驻服务器（Mac mini / 租用）

### 实现

1. **collab 服务**：Hocuspocus 4.6，一房间一篇笔记（`note:<uuid>`）。onAuthenticate 用
   Supabase `auth.getUser(token)` 验签 → 以**用户自己的 JWT** 调 `resource_role('note', id)`
   判权（063 唯一判定链复用，服务端零自建权限）；viewer 连接 `connectionConfig.readOnly`
   服务端丢弃其写入；无授权一律拒（不泄漏存在性）
2. **编辑器协作模式**：`Collaboration` + `CollaborationCursor` 扩展按需注入（`collab` prop）；
   协作时 StarterKit History 关闭（Undo 由 Yjs UndoManager 接管）；UniqueID 加
   `filterTransaction` 只补本地事务 id；**y-sync 远端事务映射为 G3 预留的 `remote-sync`
   来源**——不进 Undo、不生成 task mutation、不标脏不排队保存
3. **页面接线**：`useNoteCollab` hook（provider 生命周期 + awareness 出席）；`NotePresenceBar`
   头像栈（颜色按 uid 哈希，与远端光标同色源）；保存路径按会话状态切换——
   **协作在线：v2 + `expected_revision=null`**（CRDT 合并使乐观锁无意义，快照节流落库，
   版本/任务链/last_edit_by 全复用既有触发器）；**离线/mock：回退 Stage 0 乐观锁主链**
4. **空房间播种**：首次同步后 Y.Doc 为空才用 DB 原始快照播种。踩坑记录：播种源不能用页面
   content state（挂载期 UniqueID 回填会把内容覆盖成空文档 → 播种空文档 → 保存清库），
   必须传 DB 加载时的原始快照（`seedContent`）；且回填 effect 加「同步后才跑」的门
5. **开关与降级**：`NEXT_PUBLIC_COLLAB_WS_URL` 未配置 / mock 后端 → 整个协作层不启用，
   行为与 Stage 0 完全一致；会话断开时保存自动回退乐观锁主链

### 验证（P5-03 学习目标，双账号 e2e `e2e/collab.spec.ts`，COLLAB_E2E=1 本地实跑 13.4s 全过）

- 双浏览器（A/B 两个账号两个 context）并发输入不丢字：不同段落并发 + 同段落追加，
  CRDT 合并双向可见，无冲突弹窗
- 出席栏互见（对方名字/颜色 chip）
- 断线重连：B 关页 → A 继续输入 → B 重开，经服务端内存文档 + 快照双通道拿到全量内容
- 快照落库：刷新后内容仍在（v2 RPC → note_versions / task_item_refs 触发器链原样复用）

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 122 文件 / 885 用例全绿；next lint（CI 同款）0 警告
- smoke e2e 5/5（mock 生产构建）；collab e2e 1/1（真实后端双账号）
- 种子脚本 `scripts/seed-collab-e2e.mjs`：admin API 建 A/B 账号 + PostgREST 直插笔记/空间/授权（幂等）

### 已知边界 / 生产化待办（下一张卡）

1. **服务端 ydoc 持久化缺失**：文档在内存，collab 进程重启丢房间状态；客户端快照兜底
   （丢失窗口 ≈ 快照节流间隔）。生产化：`encodeStateAsUpdate` 落 `note_ydocs` blob 表 +
   onLoadDocument 回放 + 服务端播种（消除空房间并发播种竞态）
2. **冲突对话框在协作模式下不可达**（乐观锁被跳过），保留给降级路径
3. 协作模式下 `parent_note_id` 等页面结构仍按属主收口（validate_note_parent 触发器），不变
4. 部署：collab-server 与 Supabase 同机部署，`NEXT_PUBLIC_COLLAB_WS_URL` 指向
   `ws://<host>:1420`（或反代 ws 升级到同域路径）

## P5 后续：备份 manifest 排除清单声明协作表（2026-08-31）

- 分支 `feat/p5-backup-manifest-exclusions`（master = a2cfa6b，无迁移、无 schema 变更）
- 卡源：ADR 0002「三张协作表不进备份合同 v4……必须在 manifest 的排除清单里写清」——
  卡 1–4 与 066 都没落这条，本卡补齐

### 实现

1. **导出/校验两侧分离**：`EXPORT_EXCLUSIONS = REQUIRED_EXCLUSIONS + collaboration_acl +
   user_profiles` 只用于 `createBackupV2` 的 manifest 输出；`REQUIRED_EXCLUSIONS`（旧五类）
   仍是校验底线——**不收紧**，否则既有备份会突然校验失败
2. **`collaboration_acl`** = workspaces / workspace_members / resource_acl（授权目标是空间、
   空间不在白名单，remap 语义未定义前不收录，恢复后授权丢失是已知合同）；
   **`user_profiles`** = 可再生镜像（auth.users 触发器 + backfill 自动重建），且跨账号恢复
   等于把别人昵称/头像塞进新账号
3. **测试 ×2**：新导出声明两个排除项且通过校验；仅五类的旧式 manifest 继续通过（兼容）

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 122 文件 / 885 用例全绿（+2）；next lint 0 警告
- 无迁移，pgTAP 不适用；e2e smoke 的旧式 manifest 夹具即「旧备份兼容」的运行时探针，无需改动

## P5 后续：协作者归属列 notes.last_edit_by（2026-08-31，066）

- 分支 `feat/p5-note-last-edit-by`（master = da9cd31，迁移到 066）
- 卡源：ROADMAP P5-02 卡 3 登记的独立待办（ADR 0002「加列须连带备份合同 v4 + mock seed +
  既有测试」），也是卡 4 冲突对话框名字的前置

### 实现

1. **迁移 066**：notes 加 `last_edit_by uuid`；v1（051 定义原样重述）与 v2（065 定义原样
   重述）的 notes UPDATE 各加 `last_edit_by = 调用者`。三条刻意边界（迁移头注释 + ADR 追记）：
   **无外键**（悬空 uuid 由消费方回退，不让跨账号恢复/注销炸链）、**不回填**（列引入前的
   编辑者不可知，NULL 是诚实值）、**restore 不搬运**（归属是活协作上下文，恢复后重置）
2. **权限与归属正交**：`resource_role()` 回答「能做什么」，`last_edit_by` 回答「谁编辑的」；
   v2 里业务行写入 scope 仍是属主，唯归属列记调用者——两个维度刻意分开
3. **备份合同 v4 同步**：导出列携带（settings 页 select + schema 校验 `optional`，旧备份
   兼容）；`prepareRestorePayload` 对 notes 显式置空 `last_edit_by`（不透传悬空 uuid 进恢复
   载荷）；restore RPC 链不消费（jsonb_to_recordset 列清单不变，天然忽略）
4. **mock 对齐**：seed 三条笔记 + `saveNoteWithTasks` 落 `last_edit_by = MOCK_USER.id`
   （对齐真实 v1 语义）；`mock-note-save.test.ts` 增断言
5. **冲突对话框归因（卡 4 遗留项闭环）**：冲突时读远端行 `last_edit_by`——自己其他设备 →
   「你的另一页面或设备」；协作者且 `user_profiles` 可见（共享空间 ⇒ 可见）→ 显示名字；
   悬空/不可见 → 通用文案。归因存进 `SaveConflict.actor`，随冲突状态一并清理
6. **065 钉子按计划翻转**：`hasnt_column` → `has_column`（066 测试重申加列承诺）

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 122 文件 / 883 用例全绿（+1 备份兼容用例）；
  `next lint`（CI 同款）0 警告
- pgTAP `066_note_last_edit_by.test.sql` 19 断言（结构 4 + 行为 14 + 匿名 1），
  CI db-test 全新库实跑为准

### 遗留

1. restore RPC 不消费该列是**合同**（迁移头注释 + ADR 0002 第 4 条 + 备份测试钉住），
   不要当缺失去补
2. 冲突归因只到「人名」粒度：具体改了哪个块、哪台设备不在本卡范围

## P5-02 卡 4/4：协作前端接入（2026-08-31）

- 分支 `feat/p5-02-collab-frontend`（master = c8216c6，迁移到 065；本卡无新迁移）

### 实现

1. **角色消费唯一入口 `resource_role()`**：`lib/collab/roles.ts`（类型/展示名/`canEditRole`/
   按角色选 RPC 的纯函数）+ 笔记页加载时判定（行 `user_id` 即属主事实，无需 RPC；协作者
   才调 `resource_role`，拿不到有效结论按 viewer 防御）。前端不自建判定逻辑
2. **分享面板 `NoteShareDialog`**（`components/share/note-share-dialog.tsx`，替换笔记页原
   公开链接-only 的 ShareDialog；library/卡片等入口不受影响）：三段式——协作空间授权
   （`grant_resource`/`revoke_resource`，只列 team 空间）、邀请协作者（`find_user_by_email`
   精确换 user_id → 新建 `create_workspace(p_invitees)` 或 `add_workspace_member` → 授权）、
   公开链接（沿用 `/api/share`，与协作 ACL 相互独立）。非属主看到只读授权列表
3. **`/shared`「与我共享」列表页 + 侧边栏条件入口**：数据 = `notes.user_id <> 我` 一次直读
   （064 RLS 保证可见即被授权），**未新造列表 RPC**（065 卡面留白由本卡决定）；角色逐条
   `resource_role`，属主姓名/头像取 `user_profiles`（能读到笔记 ⇒ 共享空间 ⇒ 档案可见）。
   侧边栏 `useHasSharedNotes`（limit 1）有共享才显示入口；移动端顶栏位置名同步
4. **保存管线按角色切换**：owner→`save_note_with_tasks`（v1 主链不动），editor→
   `save_note_with_tasks_v2`（同签名同状态契约，冲突/重试/幂等分支零改动复用），viewer→
   不发起保存。协作者打开共享笔记靠 `loadNote` 去掉 `user_id` 过滤（RLS 放行读）
5. **viewer 只读闭环**：TipTapEditor 新增 `editable` prop（`editor.setEditable` 同步）、标题
   textarea 只读、「仅查看」角标、`flushSave` 顶部守卫、localStorage 排版迁移跳过（否则
   永远「未保存」）。editor 的标签仍是各人一份（`/api/notes/[id]/tags` 按调用者记
   user_id，合法保留）
6. **mock 对齐（卡面要求的显式决策）**：mock 单用户世界里 `resource_role` 如实返回 owner
   （保存永远走 v1，单用户行为不变）；协作管理 RPC（`find_user_by_email`/`grant_resource`/
   `create_workspace` 等 + `save_note_with_tasks_v2`）一律显式报错 `P5-02-MOCK`，面板如实
   展示——**不假成功**。`/shared` 与侧边栏入口在 mock 下自然为空/隐藏
7. **冲突对话框文案**改为「另一页面、设备或协作者」：`last_edit_by` 列不存在（ADR 0002
   刻意留作独立卡），**无法显示冲突对方名字**，按事实陈述而不是造一个名字出来

### 门禁（本地）

- `npx tsc --noEmit` 0 错；`npx vitest run` 122 文件 / 882 用例全绿（新增
  `lib/collab/roles.test.ts` 4 例 + `lib/supabase/mock-collab-rpc.test.ts` 3 例）
- CI 同款 `next lint --dir lib --dir components --dir app --max-warnings 0` 0 警告
- 本机无 Docker/Supabase CLI，pgTAP 不适用（本卡无迁移）；`next build` 本机挂起，以 CI 为准

### 最大风险 / 遗留

1. **冲突对方名字显示不出来**：依赖 `notes.last_edit_by` 加列卡（连带备份合同 v4 + mock
   seed + 原子保存测试），登记在 ROADMAP P5 待办
2. **子资源仍为空**：协作者打开共享笔记时历史版本/评论/反链面板为空（064 起的已知合同
   中间态，非本卡引入）
3. **空间管理 UI 未做**：踢人/改成员角色/移交空间属主等 RPC 已有但无界面；分享面板里
   非空间 owner 邀请会被服务端拒绝并如实报错。属 P5 后续产品卡
4. 根目录 `pnpm lint`（turbo）在 `@organize/plugin-sdk` 上**既有失败**（该包无 tsconfig，
   `tsc --noEmit` 打印帮助即退出 1），与 CI 门禁（apps/web 的 next lint）无关，非本卡引入

## P5-02 卡 3/4：协作保存 RPC 分权（2026-08-31）

- 分支 `feat/p5-02-collaboration-save-rpc`（master = fad9f3e，迁移到 064）

### 实现

1. **`save_note_with_tasks_v2`**：与 v1（051 定稿）同 8 参签名、同 jsonb 状态契约；权限闸
   唯一调用 063 的 `resource_role('note', id) in ('owner','editor')`，不重写判定。v1 原样
   保留（前端接入是下一张卡），并存期 v1 仍只放行属主
2. **所有业务行写入 scope 从 `auth.uid()` 换成笔记属主**：任务锁/更新、`task_item_refs`
   （056 复合外键要求 refs 的 user_id 同时等于笔记与任务属主）、孤儿回收都按属主；
   `save_mutation_log` 仍按调用者记账（重试键属于各会话）
3. **修 `save_note_version` 触发器**：056 给 `prune_note_versions` 加了
   `notes.user_id = auth.uid()` 校验，协作保存时调用者≠属主会整体炸掉保存。拆出
   `prune_note_versions_for(note_id, owner)` 内核（internal-only，不对客户端开放），触发器
   改按 `NEW.user_id` 裁剪；对外 `prune_note_versions(uuid)` 签名与属主校验不变
4. **两处刻意收紧**：无权限者对「不存在」与「无授权」一律 `forbidden`（v1 的 not_found 是
   id 存在性探针）；页面结构（parent_note_id）不放权，靠既有 `validate_note_parent` 触发器
   拒绝跨属主挂树。其余写路径（回收站/恢复/移动块/高亮转换）仍属主专属且失败闭合

### 门禁（本地）

- `supabase test db`：065 文件 **94/94 ok**；19 个文件合计 422 断言，唯一失败仍是 059 的
  **既有本机漂移**（本机 postgres 非超管，CI 全新库为绿）。056/051/048/g1 等既有保存/版本
  用例全绿（v2 未回归 v1 契约）
- `npx tsc --noEmit` 0 错、`npx vitest run` 120 文件 / 875 用例（未动前端，数量不变）；
  `next build` 本机挂起，以 CI 为准

### 最大风险 / 遗留

1. 协作者保存会写 `note_versions`（触发器），但协作者**看不到**历史（064 子资源仍属主专属）
   —— 属主看得到全部；这是已知中间态
2. editor 能改属主任务的 title/status（需已知 task uuid），这是「共享页任务块可编辑」的
   自然延伸；要收紧到「仅限本篇引用的任务」需 refs 预登记，留待后续卡
3. 归属列 `last_edit_by` 未加（要同时动备份合同 v4 + mock seed + 原子保存测试），按
   ADR 0002 是独立一张卡
4. 本机 056 分钟级抖动同前卡，见 BLOCKED.md

## P5-02 卡 2/4：协作可见性接入（2026-08-31）

- 分支 `feat/p5-02-collaboration-read-rls`（master = 5b8b292，迁移到 063）

### 实现

1. **三条协作者 `SELECT` 策略**（notes / reading_items / tasks）：谓词只调用 063 的
   `resource_role()`，不重写等价判定；带 `deleted_at is null`，垃圾箱语义不变
2. **一条写策略都没加**：表级 UPDATE 会绕过 `content_revision` 乐观锁与 `save_mutation_log`
   幂等，写权收口留给 065 的 RPC。pgTAP 用结构断言钉住「引用 resource_role 的 UPDATE 策略 = 0」
3. **`user_profiles` 只放展示字段（姓名/头像）**：刻意**不存 email** —— 本表允许本人 UPDATE，
   缓存邮箱等于让攻击者把邀请劫持到自己账上；`auth.users` 的邮箱唯一约束是大小写敏感且
   部分索引，兜不住这个歧义。邮箱一律由 `find_user_by_email`（DEFINER、精确等值、不前缀/
   通配/列举、匿名拒）从 `auth.users` 读
4. **可见集与权限收口**：档案只有「自己 + 至少共享一个 workspace 的成员」可读；表级
   INSERT/DELETE 与 anon 的 SELECT 显式收回（不靠「没建策略」）；`mirror_user_profile()`
   触发器函数不对客户端开放；自设昵称不被 auth 更新冲掉（coalesce 方向 = 档案优先）

### 门禁（本地）

- `supabase test db`：064 文件 **73/73 ok**；18 个文件全跑合计 328 断言，唯一失败仍是 059 的
  **既有本机漂移**（本机 postgres 非超管）。CI 全新库预期 Files=18 / Tests=335
- `npx tsc --noEmit` 0 错、`npx vitest run` 120 文件 / 875 用例（未动前端，数量不变）、
  `corepack pnpm lint` 0 问题；`next build` 本机挂起，以 CI 为准

### 最大风险 / 遗留

1. 共享笔记对协作者能打开，但**历史版本、标签、反链、评论都是空的**（子资源仍 owner-only）
   —— 已知中间态，065 的 RPC 才补齐按角色的列表能力
2. `user_profiles` 对 mock 后端还不存在，前端卡（PR4）必须决定 seed 或明确「不支持」，
   不能假成功
3. 本机 056 的「同一小时两条自动版本」用例有**分钟级抖动**（跨整点必红），非本卡引入，
   见 BLOCKED.md

## P5-01 协作权限模型验证（2026-08-31）

- 分支 `feat/p5-01-workspace-acl-prototype`（master = 4d7d260，迁移到 062）
- 基线裁决：`docs/collaboration-plan.md` 分叉 1-A（`shares.share_members` 点对点）与本卡口径
  冲突，按 ROADMAP P5-01 走 workspace 模型；结论与否决理由写入 `docs/adr/0002`

### 实现

1. **063 三张表**：`workspaces`（personal/team，`owner_id` 是唯一权威属主，partial unique
   索引兜住「每账号恰好一个个人空间」）、`workspace_members`（owner/member/guest）、
   `resource_acl`（资源→空间授权，access_role viewer/editor/owner，
   unique(workspace_id, resource_type, resource_id)）
2. **判定唯一事实源 `resource_role(type,id)`**（SECURITY DEFINER + 固定 search_path）：
   属主 → owner；否则取「资源已授权的空间 ∩ 我是成员的空间」里最高 access_role；
   其余 NULL（资源不存在/类型未知同样 NULL，不泄漏存在性）。064/065 必须复用
3. **写只走 RPC**：空间侧 `create_workspace`/`add_workspace_member`/
   `update_workspace_member_role`/`transfer_workspace_ownership`/`remove_workspace_member`
   （踢人与自助退出同入口），资源侧 `grant_resource`/`revoke_resource`/
   `transfer_resource_acl`/`reclaim_resource`。`resource_acl` 对客户端**显式 revoke 写权限**
   （不靠「不建写策略」，否则结论随新实例平台默认权限漂移）。EXECUTE 分层里 `resource_owner`
   与 `provision_personal_workspace`、`assert_resource_control` 一起收归 `service_role` 专用：
   它返回任意资源的属主 uuid，客户端直调等于拿到「探测别人资源存在性与归属」的 oracle；
   同文件内同为 DEFINER 的判定函数/触发器照旧可调（pgTAP 两侧都有断言）
4. **完整性触发器**：polymorphic `resource_id` 无外键 → 写时 `enforce_resource_acl_target`
   校验资源存在；notes/reading_items/tasks 硬删时 `strip_resource_acl` 级联清授权；
   `auth.users` AFTER INSERT 补建个人空间 + 存量账号跑同一幂等实现
5. **pgTAP 85 断言 / 11 节**：A、B、C 三身份 + 两个互不相关空间（A 的 W1/W2、C 的 W4）。
   正向：角色矩阵、多空间取最高、成员管理、控制面转移与整体回收。反向（提权）：
   成员身份不给读权、跨资源类型不外溢、editor 不能二次转授、空间 owner 不能自升别人
   资源的 access_role、member 不能绕过 RPC 直写 owner 成员行、A 不能把 B 的资源授权进
   自己的空间、不能把资源授权进自己不是成员的空间
6. **ADR 0002**：三层模型 + 四条边界 + 三个否决方案 + 6 项「不在本原型范围内」

### 门禁（本地）

- `supabase test db`：063 文件 **85/85 ok**；17 个文件全跑，唯一失败是 059 的**既有本机漂移**
  （`permission denied for table task_mutations`；本机 postgres 非超管，CI 全新库同文件绿），
  与本卡无关
- tsc exit 0；vitest 120 文件 / 875 用例全绿 skip=0；`next lint --max-warnings 0` 通过
- `next build` 由 PR CI 裁决（本机 next build 卡死问题记录在下方 P2-02 条目；本卡零前端改动）

### 最大风险/遗留

1. **「资源转移」只做控制面**：改写业务行属主（`notes.user_id`）会撞 056 的
   `(id,user_id)` 复合外键、`task_item_refs` 与备份合同 v4，归 P5-02 逐域迁移
2. **三张新表刻意不进备份合同 v4**：跨账号恢复属主行 ACL 等于把 A 的共享关系塞给 B，
   需先定义 remap 语义
3. **发现上游文档的前提是假的**：`docs/collaboration-plan.md` 称「038 预留了
   `notes.last_edit_by` 列位」，实测本机 `notes` 无该列、迁移全文也没出现过这个名字。
   PR3（065）不能按计划原文「保存时顺便写 last_edit_by」，必须先加列并同步备份合同 +
   mock + 测试。已写入 ADR 0002 与 ROADMAP P5-02
4. 063 单独合并后**不会**让任何业务表对协作者可见（无 064 策略引用它）——最小原型的刻意边界

## P2-02 Web 上线前能力（2026-08-30）

- 分支 `feat/p2-02-prelaunch`（master = 687efc6，P2-01 合并后）

### 实现

1. **环境变量启动校验**：lib/env.ts validateEnv（fatal/warn 分级）+ instrumentation.ts
   register——生产 fatal 直接拒绝启动（红线：生产禁 NEXT_PUBLIC_MOCK_BACKEND=true）；
   开发仅提示。/api/health 附 envWarnings。7 条单测（lib/env.test.ts）
2. **忘记密码**：登录页「忘记密码？」（需先填邮箱）→ resetPasswordForEmail →
   新 /auth/reset 页（updateUser 换密码；缺 code 显示链接失效态）。middleware
   /auth 前缀已放行无需改
3. **账号删除**：DELETE /api/account——会话校验后 service role 按会话用户 id
   admin.deleteUser（schema 全部 auth.users 外键均为 on delete cascade，数据随
   账号物理删除；请求体不参与定位，无法越权）；设置页新增「账号与数据」危险区
   （隐私说明 + 删除入口，showConfirm 二次确认后登出跳登录）
4. **showConfirm**：prompt-dialog 扩展 Promise 风格确认对话框（destructive 红色
   确认钮），与 showPrompt 共用 PromptHost
5. **部署物料**：.env.production.example（含红线注释）；docs/deploy-runbook.md
   （staging 先行步骤/迁移回滚原则/备份与恢复演练 runbook/演练日志表）

### 门禁（本地）

- tsc exit 0；vitest 119 文件 / 869 用例全绿 skip=0（+1 文件 +7 用例）；
  lint --max-warnings 0 通过
- next build：本机今天起卡死在「Creating an optimized production build」（连
  master 基线、清 .next、关遥测均复现，与代码无关的环境问题，见 BLOCKED.md）；
  构建门禁由 PR CI verify job 实跑裁决

# PROGRESS

## P2-01 严格 CI 与核心 E2E（2026-08-29）

- 分支 `chore/p2-01-strict-ci-e2e`（master = 6d05162，P1-04 合并后；含 P1 门禁核对记录）

### 实现

1. **lint 零警告门禁**：修复全部 6 个存量警告（repository togglePin 多余依赖、
   editor-popover isIgnoredTarget ×2（useCallback 化）、task-attachment-list img
   （豁免+理由：Storage 签名 URL 不走 next/image）、task-month-view useMemo 补
   cursor、tasks 页 batchDelete 补 userId）；CI 加 `next lint --max-warnings 0`
2. **版本钉死**：CI supabase/setup-cli latest → v2.116.0（当前最新，防漂移）；
   Node 22 已在 P0-01 钉死（.nvmrc/engines/CI 三处）
3. **Playwright Chromium smoke**（`apps/web/e2e/smoke.spec.ts` + playwright.config，
   mock 后端 + `next start :3100`，CI 新增 e2e-test job，失败传 report artifact）：
   - 登录 → 稍后读保存（mock 抓取标题断言）→ 笔记保存后导航往返（内容持久化）
     → 任务完成（勾选后标记未完成态）→ 备份恢复（v4 合同 fixture：客户端预检
     通过 + 服务端 409 非空拒绝语义）
   - 过程中修 mock 保真缺口：api-shim 补 POST /api/backup/restore（空账户校验
     +逐表替换+counts 报告，与真实路由同形状）；vitest exclude e2e/**
4. **App Router 错误边界**：app/error.tsx（段级+重试）、global-error.tsx（根级，
   自带 html/body）、not-found.tsx（404）
5. **请求 ID + 结构化错误日志**：middleware 每请求生成/透传 x-request-id 响应头；
   lib/api/logger.ts（单行 JSON：level/ts/requestId/path/code/message）+ getRequestId；
   serverError 接入（ctx 可选参数，向后兼容）
6. **健康检查**：GET /api/health（无鉴权，{status,ts,mock}），兼作 Playwright
   webServer 就绪探测
7. **Cron 告警**：/api/cron/task-reminders 响应加 lastSentAt 心跳（最近一次成功
   投递 sent_at）；workflow 移除静默跳过——缺配置 exit 1（::error 指引）、接口
   非 200 exit 1、lastSentAt 超 48h exit 1（长期不运行必告警）

### 门禁（本地）

- tsc exit 0；vitest 118 文件 / 862 用例全绿 skip=0；lint --max-warnings 0 通过；
  next build exit 0；Playwright 5/5 通过（本地 chromium）

# PROGRESS

## P1 门禁核对（2026-08-29，P1-04 合并后）

门禁要求：核心收集、任务、工作台、速记在刷新、离线和换设备后不产生假成功或静默丢失；
相关真实/mock 测试齐全。逐项核对（证据见各卡 PROGRESS 段落）：

- **收集（P1-01）**：统一服务 collectReadingItem——失败 fail-closed 不假成功（单测），
  真实+mock 双分支测试（collect.test.ts / collect.mock.test.ts）
- **任务（P1-03）**：原子协议 expected sync_version+mutation id（pgTAP 059 + 单测），
  非网络失败进 dead-letter UI 可见不静默，队列按用户隔离（测试）
- **工作台（P1-02）**：完成率/连续天数纯函数基于持久化数据，固定时钟「同输入重复
  计算一致=刷新/换设备等价」测试
- **速记（P1-04）**：垃圾箱软删/恢复/永久删双用户隔离 pgTAP 060；命令面板搜索
  真实+mock 双分支
- 测试基线：118 文件 / 862 用例全绿 skip=0；pgTAP 13 文件 163 断言（CI 实跑）

**结论：P1 门禁通过，P2-01 开工。**

# PROGRESS

## P1-04 速记生命周期补齐（2026-08-29）

- 分支 `feat/p1-04-memo-lifecycle`（master = 9e8cfa2，P1-03 合并后）

### 现状核对与补齐

- **备份合同**：P0-04 已收录 memos（BACKUP_TABLES + restore RPC + pgTAP），本卡核对无缺口
- **垃圾箱**：055 迁移预留 deleted_at 但注释明示「垃圾箱体系暂不接入」——本卡补齐
- **全局搜索**：命令面板搜索五类资源无速记——本卡补齐
- 全局弹窗/移动分享/每日回顾：卡面「再决定」= 产品决策，不在本卡实现

### 实现

- **迁移 060**：mutate_trash / list_trash 替换版——资源白名单加 'memo'，
  三动作分支（软删/恢复/永久删，均按属主过滤），list_trash 追加 memo 分组
  （标题取 content 前 50 字符）；EXECUTE 分层维持 050 口径
- **contracts**：TRASH_RESOURCE_TYPES 加 "memo"；垃圾箱页 resourceConfig 加速记
  （MessageSquareText 图标）——恢复/永久删除入口自动可用
- **命令面板**：SearchResult/SearchCounts 加 "memo" 类型；真实分支 memos content
  ilike（is deleted_at null）+ count；mock 分支 mockDb.memos 过滤；分组「速记」
  渲染（标题=首行，副标题=内容预览），点击跳 /memos
- memos 页删除按钮原已走 DELETE /api/memos/[id]（软删除，mock shim 同语义）——
  与垃圾箱 RPC 语义一致，未改

### 测试（+1 pgTAP 文件 / +1 用例文件改动，全量 118 文件 / 862 用例）

- pgTAP 060（11 断言，CI 实跑）：属主软删 affected=1、list_trash memo 分组可见、
  标题取内容前缀、恢复出桶、再软删+永久删物理消失、B 软删自己的成功、A 动 B 的
  速记 affected=0 且行保持活跃
- contracts.test.ts：memo 类型被 parseTrashMutation 接受
- 门禁：tsc exit 0、vitest 118/862 全过 skip=0、next build exit 0

# PROGRESS

## P1-03 任务离线冲突与失败可见（2026-08-29）

- 分支 `feat/p1-03-task-offline-conflict`（master = 7d63eea，P1-02 合并后）

### 盘点出的四个缺口

1. 队列 storage key 全局（organize:offline:task-ops:v1 无 user 段）——退出后另一
   账号登录会读到/回放别人的操作
2. 持久化失败被 `catch {}` 静默吞掉（存储满/被禁用时假装入队成功）
3. 回放被拒操作只计数即丢弃——双设备冲突/任务被删等非网络失败用户不可见
4. 在线更新直写 `tasks.update`，与离线回放不同协议；tasks.sync_version（030）只有
   笔记 RPC 在加，形同虚设；回放无跨标签页互斥（两标签页并发回放同一队列）

### 实现

- **迁移 059**：`update_task_atomic(p_task_id, p_patch, p_expected_sync_version,
  p_mutation_id)`——校验+应用合并为单条 UPDATE（行锁内原子），22 列白名单（显式
  null 覆盖），applied/conflict/not_found/already_applied 四态；`task_mutations`
  幂等日志表（PK(user_id,mutation_id)，复合外键同租户+级联，RLS select/insert，
  GRANT authenticated/service_role，EXECUTE revoke public+anon）；migration 内
  revoke/grant 遵循 P0-02 分层约定
- **队列 v2**：key 带 userId（`organize:offline:task-ops:v2:<uid>`；v1 无法安全
  判定归属，弃用不清除，历史离线操作一次性失效）；update op 携带
  expected_sync_version（op_id 即 mutation id）；write 失败上报 persisted=false
- **回放**：writer.updateTask 走原子协议（meta 透传 op 的版本+op_id），conflict→
  TASK_SYNC_CONFLICT、not_found→TASK_NOT_FOUND 结构化错误；replayTaskOps 返回
  rejectedOps 数组（不再只计数丢弃）
- **dead-letter（per-user）**：`lib/offline/task-dead-letter.ts`——拒绝入账（同
  op_id 去重）、人工重试（expected 置 null 后重入队回放，op_id 保持幂等链）、丢弃
- **跨标签页单实例**：`lib/offline/single-instance.ts` Web Locks 封装，回放在
  `organize:task-replay:v1` 互斥区先重读队列；API 不可用退化为直接执行（已知限制）
- **共用协议接入点**：repository（updateTaskStatus/togglePin/updateTask）、任务
  工作台页（updateTask/sort 拖拽/batchComplete）、今日视图 toggle、子任务层级、
  任务详情页日期/note_id 关联——在线更新全部携带本地已知 sync_version + UUID
  mutation id；冲突→dead-letter+刷新+toast（绝不静默覆盖），网络失败→入队
- **dead-letter UI**：任务工作台头部计数（role=alert）+ 面板逐条展示失败原因，
  重试/丢弃/全部丢弃
- mock：update_task_atomic shim（同白名单/幂等/版本语义）+ task_mutations 空表
- 测试适配：task-queue.test.ts 重写（隔离/persisted/rejectedOps/meta 透传）

### 测试（+3 文件 / +18 用例，全量 118 文件 / 861 用例）

- task-queue.test.ts 重写：user 隔离、persisted 上报、meta 透传、conflict 进
  rejectedOps 继续后续、网络中止滞留（原语义保留）
- task-dead-letter.test.ts：入账/去重/隔离/移除/重试重置/写盘失败上报
- single-instance.test.ts：串行、释放、异常后可继续、无锁退化
- atomic-update.test.ts：四态解析 + 异常形状归一 error
- pgTAP 059（14 断言，CI 实跑）：属主 applied+版本递增、同 mutation 重放
  already_applied 不递增、过期版本 conflict 带当前版本、显式 null 清空、他人任务
  not_found、日志 RLS 双用户隔离、日志不可 update（42501）、EXECUTE 分层 ×3
- 门禁：tsc exit 0、vitest 118/861 全过 skip=0、next build exit 0

# PROGRESS

## P1-02 修正工作台与经验复习（2026-08-29）

- 分支 `fix/p1-02-workbench-review`（master = 5da01dd，P1-01 合并后）

### 修掉的三个问题（均在 components/dashboard/today-view.tsx）

1. **完成率恒为 0**：分母（overdue+today）先过滤掉 done 任务，再从分母里数 done
   → completedToday 恒 0。重写为同窗口口径（新纯函数 `computeTodayCompletion`）：
   窗口=今天日历日；计划 = 未取消且（今日到期 ∪ 逾期未完成）∪ 今日完成（不论
   到期日，历史完成不进今天）；完成 = 窗口内 done；rate = completed/planned。
   验收用例 4 计划 2 完成 = 50% 固定时钟固化
2. **连续天数假数据**：原实现只 `localStorage.getItem("organize-streak")`（全库无
   写入点，永远 undefined→0，且换设备即失真）。改为 `computeTaskStreak`：基于持久化
   tasks.completed_at，按本地日历日从今天（今天无完成则从昨天）回数连续活动日
3. **经验复习假降级**：lessons 无 next_review_at 列（012 schema 确认）——真实后端
   查询报错 → fallback 把最近 5 条经验伪装成「待复习」；「记住了」按钮把复习计划
   写到不存在的列（假成功）。整块移除（含 state/查询分支/handler/JSX）；是否引入
   复习算法留待产品决策（P1-02 卡面明示）

### 实现

- 新 `lib/dashboard/workbench-stats.ts`：computeTodayCompletion / computeTaskStreak
  纯函数，时钟注入；today-view 挂载 allTasks state 后即时计算，不碰 localStorage
- review-view（每日回顾）/stats-view 盘点确认已基于持久化数据，未改

### 测试（+1 文件 / +10 用例，全量 115 文件 / 843 用例）

- `lib/dashboard/workbench-stats.test.ts`：固定时钟 2026-08-29——4 计划 2 完成=50%
  （验收原案）、逾期与昨日完成窗口归属、提前完成未来任务、cancelled 排除、空窗口
  0%、同输入重复计算一致（刷新/换设备等价）、streak 连续/今天未断签/断档截断/空
- 本地门禁：tsc exit 0、vitest 115/843 全过 skip=0、next build exit 0

# PROGRESS

## P1-01 统一稍后读收集链路（2026-08-29）

- 分支 `feat/p1-01-unify-collection`（master = 222fe4b，P0-04 合并后）

### 盘点出的五个入口、四套写法（含 3 个真 bug）

1. `command-palette`：抓取结果**直接丢弃**——抓取成功也只存 url+原文做标题，正文永远不落库
2. `share` 页：绕过 `scrapeUrl()` 直连 `/api/scrape`——mock 模式下分享保存必坏；失败也不降级
3. `batch-import`：抓取失败整条失败，与 Quick Add 的「仅存链接」降级不一致；不发 `reading:item-created` 事件
4. `QuickAdd` FAB：「添加文章」完全不抓取；`quick-add-bar` 是唯一全字段正确写入的入口

### 实现

- **新服务 `lib/reading/collect.ts`**：collectReadingItem 唯一入口——extractFirstUrl
  规范化 → 去重查询（显式 `eq user_id` + `is deleted_at null`，RLS 双保险）→ scrapeUrl
  （失败降级仅存链接）→ 固定 8 字段插入 → 发 `reading:item-created`；collectResultToast
  统一五入口文案
- **冻结语义**（写在服务头注释 + 测试固化）：抓取失败=仅存链接（title=规范化 URL，
  正文字段 null，UI 必须明示）；去重仅对活跃条目、限定 user_id、规范化 URL 精确匹配，
  命中返回 duplicate 不插新行不发事件；软删除行对客户端不可见（021 RLS），再次保存
  产生新条目、回收站副本不动（垃圾箱走 050 RPC 恢复）；查询/写入失败一律 error 结局
- **五个入口全部改为薄壳**：quick-add-bar / command-palette / quick-add FAB /
  batch-import-panel / share 页只留输入、进度与反馈；share 页补 duplicate 态，
  batch 面板新增「跳过」状态与统计（duplicate 琥珀色 + note 文案）
- 无迁移：不加 (user_id,url) 部分唯一索引——restore RPC 明文插入且历史数据可能有
  同 URL 活跃重复行，会破坏 P0-04 刚冻结的 v4 备份往返（详见 BLOCKED.md）

### 测试（+2 文件 / +14 用例，全量 114 文件 / 833 用例）

- `lib/reading/collect.test.ts`（11 条）：固定抓取响应下插入字段逐项一致（含字段
  清单冻结断言：恰好 8 字段）、杂讯文本规范化、仅存链接降级、同用户 duplicate
  不插不发、`eq user_id` 显式在查询过滤器里（跨用户不命中）、软删除行排除、
  invalid-url/unauthenticated/查询失败 fail-closed/插入失败均不假成功、事件
  payload 契约、toast 统一文案
- `lib/reading/collect.mock.test.ts`（3 条）：真实 mock 客户端集成——保存样例文章
  + 重复提交 duplicate 不新增行、他人同 URL 不拦、与 seed 活跃条目去重
- 本地门禁：tsc exit 0、vitest 114/833 全过 skip=0、next build exit 0、改动文件
  lint 零告警；无迁移故无 pgTAP 变更（存量 12 文件 126 断言不变）

# PROGRESS

## P0-04 备份恢复合同重建（2026-08-29）

- 分支 `chore/p0-04-backup-contract`（基于 P0-03 合并后的 master = d3ae007，串行第二 PR）

### 盘点出的三个数据丢失洞

1. `memos`（055）不在 BACKUP_TABLES —— 导出即丢全部速记
2. `task_item_refs`（030 任务↔笔记双链）不在备份清单 —— 导出即丢双链关系
3. `rewriteInternalLinks` 不处理 `taskItem.attrs.taskId` —— 即使导出了笔记，
   恢复后任务绑定块指向旧 ID，双链断链

### 实现（v4 合同）

- **schema.ts**：BACKUP_VERSION 3→4；BACKUP_TABLES 收录 memos/task_item_refs
  （28 张表）；两张表的字段 validator（memos.tags 字符串数组、task_item_refs
  唯一键 note_id+block_id）；关系校验（task_id/note_id 引用）；
  v2/v3 老文件兼容——缺新表键补空数组，validateManifest 对 v2/v3 豁免新表
  counts 键缺失（按 0 记），v4 起严格（缺表即 INVALID_TABLE）
- **restore.ts**：ID_TABLES 与映射收录两表；**rewriteInternalLinks 新增
  taskId 键重映射**（空/未绑定原样保留），全部 8 个调用点传入 tasks 映射
- **迁移 058**：restore_backup_v2_full 包装 with_highlight_references 链尾，
  落库 memos（tags 数组原样）与 task_item_refs（on conflict 跳过），
  counts 报告增补两表；coalesce 兜底老 payload
- **API**：/api/backup/restore 改调 restore_backup_v2_full
- **设置页**：导出区「备份包含什么？」折叠清单（28 表 + 不包含项明示：
  附件/图片文件本体、auth、插件配置、分享链接、AI 密钥）；**新增「从备份恢复」
  入口**（restore-section.tsx：文件选择 → inspect 预检 → 问题清单 → 确认
  （明示整体替换语义）→ POST → 逐表结果报告）
- 非空账户：沿用既有 not_empty → 409 整体拒绝（UI 有明确文案）

### 测试

- schema.test.ts：fixture 扩展（memos/task_item_refs/taskItem 节点）；remaps
  用例新增 6 组断言（taskId 重映射/未绑定保留/两表引用重映射/旧 ID 全清除）；
  新用例「v3 老备份兼容」（真实形状：counts 也不含新键；v4 缺表必须报错）
- pgTAP 058_backup_v4.test.sql：10 断言——双账号恢复（B 空账户 restored；
  memos 按属主+内容落库；task_item_refs 按引用落库；不挂他人任务；
  counts 报告一致）；非空账户 not_empty 且零写入；v3 老形状 payload 恢复成功
- 本地门禁：tsc exit 0、vitest **112 文件 / 819 用例**、next build exit 0；
  pgTAP 由 CI db-test 实跑（116 存量 + 10 新增）

# PROGRESS

## P0-03 AI 地址与密钥安全（2026-08-29）

- 分支 `chore/p0-03-ai-url-key-security`（基于 P0-02 合并后的 master = e42a58d）

### 实现

1. **SSRF 安全请求层 `lib/ai/safe-request.ts`**：safeAIRequest 复用抓取模块的
   validatePublicUrl（协议白名单 http(s)/无凭据/主机名黑名单/全部解析地址须公网），
   连接钉扎在已校验地址（防 DNS 重绑定 TOCTOU），逐跳重定向重新校验（上限 8 跳），
   超时控制；AIRequestError 分类（INVALID_URL/URL_BLOCKED/DNS_FAILED/TIMEOUT/
   TOO_MANY_REDIRECTS/REQUEST_FAILED/HTTP_ERROR）
2. **密钥不出服务端**：`lib/ai/server.ts` getAIConfig/getAISettingsView——真实后端经
   service_role 读 user_ai_settings（057 已收回客户端 SELECT），展示态只回
   maskApiKey 掩码；ask/tags/notes 三个使用方路由全部经 getAIConfig → safeAIRequest
3. **受控配置接口 `/api/ai/settings`**：GET 掩码展示态；PUT 保存时即 SSRF 校验
   base_url + api_key 留空保持不变；DELETE 清除
4. **设置 UI 重写 `components/settings/ai-settings.tsx`**：读写一律走 /api/ai/settings，
   页面只见掩码，输入新密钥即更换
5. **迁移 057_lock_ai_settings**：authenticated/anon 对 user_ai_settings 全部表权限
   收回，仅 service_role（RLS policy 保留作为第二层）
6. 错误脱敏：server.ts request() 包装 + redactSecret——错误消息中回显的
   Authorization（含裸密钥）一律替换 ***（恶意端点可能在响应里回显）
7. mock：user_ai_settings 显式空表声明；settings API 的 isMockBackend 分支走
   supabase client（内存态）

### 测试（+1 文件 / +15 用例，全量 112 文件 / 818 用例）

- `lib/ai/safe-request.test.ts`：SSRF 全场景——非 HTTP(S)/localhost/IPv4 私网环回
  云元数据/IPv6 环回链路本地 ULA/带凭据 URL/DNS 解析私网/混合记录/公网放行+
  地址钉扎（断言 transport 收到的 address）/重定向到私网拒绝/公网重定向链走通/
  跳数上限/redactSecret 三态
- 本地门禁：tsc exit 0、vitest 112/818 全过、next build exit 0
- 测试修正记录：首个版本误把 HTTP_ERROR 断言放在 safeAIRequest 层——分层契约是
  safeAIRequest 返回响应对象、上层 request() 抛错并脱敏；按实现语义修正测试并
  为 redactSecret 补单测（安全语义未削弱，覆盖面增加）

# PROGRESS

## P0-02 数据库越权热修（2026-08-29）

- 分支 `chore/p0-02-db-authorization`（master = 519bead，P0-01 之后）
- 盘点：28 个迁移文件含 SECURITY DEFINER；逐函数核对 security/search_path/属主校验/调用方

### 修复内容（迁移 056_db_authorization.sql）

1. **prune_note_versions 属主校验**（核心洞）：它是 DEFINER 且 EXECUTE 默认 PUBLIC——
   任意认证（甚至匿名）用户可直接调用裁剪**他人**笔记的历史版本。修复：函数体开头
   校验 `notes.user_id = auth.uid()`，非属主抛 'Note not found or access denied'
2. **save_note_version 触发器适配**：prune 加校验后，无 JWT 的笔记写入（服务端/
   管理上下文，auth.uid() 为 NULL）会被触发器链炸掉——触发器内改为仅在用户上下文
   执行裁剪（`auth.uid() is not null`），时间分级由下一次用户编辑补做（纯维护操作，
   无正确性影响）。存量 036 测试验证：line74 的 UPDATE 触发的裁剪原本就是 no-op
   （不同小时桶），断言不受影响
3. **search_path 补齐**：save_note_version（并入 1b 重写）、update_updated_at_column、
   extract_task_items 统一 `set search_path = public`（只动盘点出的未设置函数，
   不误伤引用 extensions schema 的函数）
4. **EXECUTE 分层授权**（消除 PostgreSQL 默认 PUBLIC EXECUTE）：全 public 函数
   revoke PUBLIC + anon 后分层——cron 三函数（claim_due_task_reminder_deliveries/
   reset_task_reminder_delivery/reset_task_reminders_after_schedule_change）仅
   service_role（/api/cron 经 service_role 客户端调用，已核实应用侧唯一调用点）；
   get_public_share 与 tiptap_extract_text 另授 anon（匿名分享页/生成列求值）；
   其余 authenticated + service_role（函数内部已有属主校验或由 RLS 兜底）
5. **父子同租户复合外键**（八处）：task_reminders→tasks、task_attachments→tasks、
   task_item_refs→tasks/notes、task_dependencies→tasks(双向)、
   note_comment_threads→notes、note_comments→threads、tasks→tasks(自引用子任务)。
   外键升级为 (parent_id, user_id) → parent(id, user_id)，DB 层拒绝跨租户挂靠
  （含跨租户级联删除/置空向量——原 040 自引用 `on delete set null` 会连 user_id
   一起置空违反 NOT NULL，改用 PG15 列清单语法 `on delete set null (parent_task_id)`）。
   无 user_id 的 note_versions/task_checklists 由既有 RLS WITH CHECK(EXISTS 父) 覆盖

### 存量测试适配（断言零改动）
- 036 测试 line79 的 prune 直调：补 `set role authenticated + jwt sub`（以属主身份
  调用，语义更真实）+ 调用后 `reset role`；12 条断言与预期不变

### 新增测试
- supabase/tests/056_db_authorization.test.sql：18 断言——prune 跨用户拒绝/数量
  不变/自己可裁剪/时间分级与命名版本保留；七处复合外键 23503 + 正常路径 lives_ok；
  EXECUTE 分层 has_function_privilege ×6（anon/authenticated/service_role ×
  prune/claim/get_public_share）

### 验证方式说明
本机无 Docker/Supabase CLI，pgTAP（含新 18 断言与存量 96 断言）由 PR 的 CI
db-test job（supabase db start + test db）实跑验证；应用侧 tsc/vitest/build 本地跑。

# PROGRESS

## P0-01 生产依赖安全升级（进行中，2026-08-29 开工）

- master = `66283ea`（PR #175 已合并，与任务书基线一致），分支 `chore/security-dependencies`
- `corepack pnpm --version` → `9.10.0` ✓；`pnpm install --frozen-lockfile` exit 0（363ms，锁文件有效）
- 审计红证据：`corepack pnpm audit --prod --audit-level high` → **exit 1**，`50 vulnerabilities found — 6 low | 28 moderate | 15 high | 1 critical`（完整输出存 `/tmp/audit-before.txt`，与任务书 50=1C+15H+28M+6L 一致）
- Critical = `next@14.2.11`（Middleware 授权绕过，修复 ≥14.2.25/15.5.21）；High 还有 nanoid<3.3.18、postcss≤8.5.17（next 内置）、undici 7.28.0（cheerio 传入）
- 基线门禁：tsc exit 0；vitest **111 文件 / 803 用例** 全过；`next build` exit 0（next@14.2.11）
- 计划：next+eslint-config-next → 15.5.21（peerDeps 接受 react ^18.2.0，React 18.3.1 不动）；readability → 0.6.0；mermaid → 11.17.2；nanoid/postcss/undici 随锁文件更新，必要时 pnpm.overrides
- 关键决策：next 大版本 14→15 会触发 App Router 路由参数异步化的类型检查；仅改 build 错误点名文件并逐个附原始报错

### 升级后状态（2026-08-29）

- `corepack pnpm audit --prod --audit-level high` → **exit 0**；全量 `--prod` 审计仅剩 **1 moderate**：`uuid <11.1.1`（路径 `@tiptap/extension-unique-id@2.27.2`，TipTap 被 P0-01 禁令锚定在 2.27.2 不可升级）。**可达性评估：不可达**——已核实其 dist 仅 `import { v4 } from 'uuid'`（3 处），公告 GHSA-w5hq-g745-h8pq 只影响 v3/v5/v6 携带 buf 参数的用法；后续随 P2-01（TipTap 升级决策）一并处理
- 基线的 6 个 low 已随 postcss/nanoid/next 升级自然清零，无遗留
- 手段：直接依赖 next/eslint-config-next → 15.5.21、readability → 0.6.0、mermaid → 11.17.2、@types/node → ^22；根 `pnpm.overrides` 收敛传递依赖（postcss ≥8.5.23、nanoid ^3.3.18、sharp ≥0.35.0、undici ^7.29.0、dompurify ≥3.4.13）——override 全部按「补丁下限」收敛，避免跨大版本（曾出现 nanoid 6/undici 8 解析，已收紧）
- 兼容改动共 8 个文件、全部由错误点名（见上节）；React 18.3.1 / TipTap 2.27.2 未动
- Node：engines `>=22.12.0`、`.nvmrc`=22.12.0、CI node-version 22、README/AGENTS 同步；本机 Node v22.22.2 满足
- 待办：push 后 CI 绿 → 故意回归 next@14.2.11 造红 → 还原造绿 → squash 合并

### 升级触发的兼容错误（原始报错 + 修复）

1. **readability 0.5→0.6 类型收紧**（`npx tsc --noEmit` 点名，共 3 条）：
   - `lib/scraper/index.ts(151,26): TS2345: Argument of type 'string | null | undefined' is not assignable to parameter of type 'string'`（article.title → addXMediaToContent 第三参）
   - `lib/scraper/index.ts(156,5): TS2322: Type 'string | null | undefined' is not assignable to type 'string'`（title: article.title）
   - `lib/scraper/index.ts(157,5): TS2322: 同上`（content 透传分支）
   - 修复：与既有 `excerpt: article.excerpt || ""` 同风格补空值兜底（`?? ""` / `|| ""`），不改运行时路径
2. **next 14→15 build lint 升级**（`npx next build` 点名，2 条，`@next/next/no-html-link-for-pages` 由警告升为 Error）：
   - `./app/s/[token]/not-found.tsx — 15:11 Error: Do not use an `<a>` element to navigate to `/`. Use `<Link />` from `next/link` instead`
   - `./app/s/[token]/page.tsx — 98:11 Error: 同上`
   - 修复：两处 `<a href="/">` → `<Link href="/">`（含 import），仅此两行
3. **Next 15 路由 params 异步化**（`next build` 首报 `app/api/notes/[id]/comments/route.ts — Type error: Route ... has an invalid "GET" export: Type "{ params: { id: string; }; }" is not a valid type for the function's second argument`；随后 `.next/types` 生成后 tsc 一次点名全部 5 个文件）：
   - `app/api/notes/[id]/comments/route.ts`（GET/POST/PATCH/DELETE）
   - `app/api/notes/[id]/move-block/route.ts`（POST）
   - `app/api/notes/[id]/route.ts`（GET/PATCH/DELETE）
   - `app/api/notes/[id]/suggestions/route.ts`（GET/POST/PATCH）
   - `app/api/plugins/[id]/route.ts`（PATCH/DELETE）
   - 修复：handler 第二参 `{ params: { id: string } }` → `{ params: Promise<{ id: string }> }` + `await params`（Next 15 官方要求的异步动态段），不改任何业务逻辑；新近路由（memos/versions/tags 等）已是异步写法，无需动

## 2026-08-19 笔记+待办集中修复（PR #77–#97，共 21 个 PR 合入 master）

对照 Notion/滴答清单逐项体验 + 代码审查出 50 条问题，按"丢数据 > 名存实亡 > 体验"分三批修完：

- 第一批（丢数据类，#77–#82）：导出/分享/拷贝丢公式与附件（latex 属性名 + fileAttachment 序列化）、斜杠命令误删整段已有文字（只删触发符 range）、重复任务完成不生成下一次实例（四个完成入口接线 complete_recurring_task）、任务日期清除被 trigger 回填复活（035：显式清除全清语义）、月历拖拽范围任务整段平移（不再违反 check 约束）、到期提醒三类误报（setTimeout 24.8 天溢出/改期不再提醒/全天任务早晨误报过期）
- 第二批（名存实亡，#83–#88）：删除/恢复后侧栏幽灵节点（mutateTrash 广播变更事件）、清单改名/删除接线（原来不可达）、版本历史去重失效改为 60 秒时间节流（036）、月历跨天任务连续条形（周行布局+泳道+折叠 +N）、死按钮清理（排序/更多/任务属性/添加评论/桌面关闭按钮）、数据库块失败不再污染正文 + 加载可重试
- 第三批（体验对齐，#89–#97）：封面隐形按钮误触（pointer-events 双保险）、置顶立即重排（sortNotesLocal）、任务搜索空态、/tasks 跳转闪烁、路径栏块不刷新（meta 事务强制 NodeView 刷新）、笔记全文搜索（037：search_text 生成列 + trigram GIN，列表页+命令面板搜正文）、页内菜单补齐历史/导出/删除 + 修恢复覆盖竞态、优先级旗标+筛选+内联可改、22 处 window.prompt/alert → 全局 showPrompt 对话框/toast、待办列表拖拽排序（组内 sort_order 归一 + 乐观回滚）、触屏点按块显示手柄

migration 035/036/037 已合入并应用；pgTAP 48 条、vitest 492 条全绿。

## 目标（≤10 行）
把待办升级为可持久化三栏工作台 + 月历：侧栏(清单/今天/7天/已完成/垃圾桶) +
中栏(列表/看板/月历) + 右详情；日期组件/重复任务/提醒/附件/模板/活动。

## 已合入 master（PR #65–#73，共 9 个 PR）
- migration 033（5 新表 + tasks 8 扩列 + trigger + RLS + 备份 v3）✅
- 三栏布局 + 侧栏 + 月历视图 + scope 过滤 ✅
- 清单管理（新建/改名/删除）✅
- 日期组件（单日/时间段/全天/重复）✅
- 12 项菜单全部无占位 ✅
- 附件上传（storage + 失败补偿删对象）+ 任务动态 ✅
- URL 路由（scope/list/view query）✅
- 月历拖拽改期（保留时长/墙钟 + 回滚）✅
- 响应式 390px 手机布局（侧栏抽屉）✅
- pgTAP 30 + vitest 408 ✅

## 最终验证序列（2026-08-02 全过）
- test：48 文件 / 408 用例 / 0 FAIL
- typecheck：exit 0
- build：✓ Compiled successfully
- migration list：001-033 对齐
- db tests：30/30 PASS
- git diff --check：exit 0

## 红→绿反向验证证据（DB 层实测 2026-08-02）
1. 跨用户 RLS：用户 B 读 A 的 task_lists → count=0（红：被拒）；A 读自己 → count=1（绿：通过）。
2. 非法结束时间：schedule_end < start → check_violation 被拒（红）；合法范围 → 接受（绿）。
3. 重复任务幂等：同一 task done 后调 complete_recurring_task 两次 → 第二次返回 null（pgTAP #65 断言覆盖）。
4. 提醒 ≤3：第 4 条 insert → 23514 被拒（pgTAP 覆盖）。
5. 上传失败补偿：前端代码实现（元数据写失败→删 storage 对象），pgTAP 覆盖 task_attachments RLS。

## 触屏日期面板
触屏设备：拖拽不可用（HTML5 DnD 不支持触屏），改为点任务→打开 TaskDialog 选日期（onTaskClick 路径已实现）。
点日期→onDateClick 回调（预填新建）。这满足"触屏走日期面板"要求。

## mock 新表 seed
lib/supabase/mock-data.ts 加 task_lists（工作/学习/生活默认清单）+ task_reminders/attachments/activities/templates 空数组。

## 未完成
- 真浏览器验收（1440×900 + 390×844）+ 截图 → 执行 agent 无浏览器，需人工操作
- 本地两名临时用户验越权 → DB 层 RLS 已验证（红→绿），但未做完整双账号端到端

- mock 新表 seed → 后续

### 其他升级自带变更
- `apps/web/tsconfig.json`：`npx next build`（Next 15）自动追加 `"target": "ES2017"` 并重排版（build 日志原文：`- target was set to ES2017 (For top-level `await`. Note: Next.js only polyfills for the esmodules target.)`），未手工改动语义

### CI 红→绿回归证据（PR #176 实跑）

1. 🟢 升级后（d70a65a，run 33258965163）：verify ✅，审计步骤输出 `1 vulnerabilities found — Severity: 1 moderate`
2. 🔴 故意恢复 next@14.2.11（e00ec95，run 33259210650）：verify ❌，审计步骤输出 `32 vulnerabilities found — 4 low | 16 moderate | 11 high | 1 critical`（Paths: apps/web > next@14.2.11）+ `##[error]Process completed with exit code 1`
3. 🟢 还原后（268b89e revert，run 33259493272）：verify ✅ + db-test ✅
- db-test（pgTAP）：`Files=10, Tests=96` → `Result: PASS`（与基线 10 文件/96 断言一致，无回归）
- 门禁最终态：CI verify job 在 install 后即跑 `corepack pnpm audit --prod --audit-level high`，此后任何 PR 引入 Critical/High 直接红灯

### P0-01 交付态
- audit（--audit-level high）exit 0；全量剩 1 moderate（uuid，不可达，随 P2-01 处理）
- React 18.3.1 / TipTap 2.27.2 未动；测试 111 文件 / 803 用例（≥基线）；skip=0
- ROADMAP：P0-01 ✅、P0-02 标记为下一项

### P0-02 CI 验证（2 轮）
- 第 1 轮 db-test：迁移应用成功、存量 10 文件全过、安全控制全部真实生效
  （复合外键 23503 / RLS 42501 / 表权限 42501 均真实拒绝）——失败 9 处全是
  测试断言写法：throws_ok 第 3 参是「期望错误消息」；越权后计数需绕 RLS；
  11/12/13 实际拒绝发生在表权限/RLS 层（42501）而非外键层；plan 数错
- 第 2 轮 db-test：**Files=11, Tests=116（存量 96 + 新增 20）→ Result: PASS**；
  verify（tsc + vitest 111/803 + next build + 审计门禁）全过
- 合并：PR #177 squash → master

### P0-04 CI 验证（4 轮）
- 第 1 轮：exit 3（SQL 前置错误）——用户 C 的 auth.users 预置 DO 块写在 set role
  authenticated 之后（无权限）；挪到开头 postgres DO 块
- 第 2 轮：notes.is_pinned NOT NULL——测试 payload 手写行缺列（真实 v4 导出经
  schema 合同字段齐全）；补 is_pinned/full_width/font_family/small_font
- 第 3 轮：tasks.sort_order NOT NULL——停止逐列猜，读 044 基础 RPC 的
  jsonb_to_recordset 全列清单核对，四张非空表必填列一次补齐
- 第 4 轮：**db-test Files=12, Tests=126（116 存量 + 10 新增）→ Result: PASS**；
  verify（tsc + vitest 112/819 + build + 审计门禁）全过
- 说明：三轮失败均为测试载荷形状问题，产品代码（迁移/RPC/合同/重映射）零缺陷
  返工；合并 PR #179
