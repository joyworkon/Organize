# BLOCKED

## P5 收尾：tasks 域属主移交 070（已完成，2026-09-01）
无阻塞。声明归档（违反会重新打开本卡的坑）：
1. **任务+笔记联转是结构强制的**：task_item_refs 同时以 (task_id,user_id)→tasks
   与 (note_id,user_id)→notes 复合外键双锚（056），任务易主但引用它的笔记不易主
   立即悬空 FK；引用行删除 = 笔记里 taskItem 块 id 悬空，新属主每次保存撞
   conflict_task（同 068 论证）。移动集合 = 目标任务 + 全部后代 + 引用集合内
   任务的全部笔记 + 这些笔记再引用的任务的递归闭包，到不动点为止。不要改成
   「只搬任务不动笔记」或「删引用行」，都会以 FK 违反或保存必炸收场。
2. **PG 递归 CTE 限制的处理在本卡留档**：标准 SQL 不允许两个递归 CTE 互引、
   也不允许同一递归 CTE 在递归 term 里多次自引用。任务↔笔记的递归闭包改为
   plpgsql 循环 + 数组累计（每轮扩 1 任务→笔记、扩 2 笔记→任务、扩 3 任务
   后代；集合单调递增必然收敛）。如果未来想改回纯 SQL 递归 CTE，需先验证 PG
   版本支持。
3. **接收人须先持「目标任务 + 每一篇涉及笔记」的 editor 授权**：任一资源缺
   editor 即整体拒绝。不要在 RPC 里顺手给接收人补授权——授权动作有它自己的
   入口（grant_resource），移交 RPC 只管搬运。
4. **挂载点清理**：series_id / source_id 指向集合外任务的置空（重复任务链条
   不跨界）；reading_item_id 一律置空；note_id 指向集合内笔记的保留、集合外的
   置空。这是语义决策不是 FK 强制（033 这两列无 FK）。
5. **任务 UI 入口不在本卡**：任务无详情页、无分享面板入口；给任务加分享/移交
   入口需先扩 ShareResourceType（当前只有 note | reading_item）+ 新建任务维度
   入口组件，归后续产品卡。
6. **本地门禁**：`supabase test db` 全新库 23 文件 / 630 断言中 070 占 55 全绿；
   059 的 7 个失败是已载的本机 postgres 角色权限漂移，非本卡引入；47 个 vitest
   失败是 master 基线既有（presentation-mode / table-direct-controls，已 stash
   复测确认），本卡未引入新增。

## P5 收尾：reading_items 域属主移交 069（已完成，2026-09-01）
无阻塞。声明归档（违反会重新打开本卡的坑）：
1. **高亮随迁是结构强制的**：highlights.reading_item_id NOT NULL（014），置空不存在；
   随迁 = 唯一无损语义。随迁高亮上指向旧属主笔记/任务的 042 引用列已顺手置空，
   不要改回「保留引用列」。
2. **协作者对 reading_items 仍无写路径**（064 合同）：移交后新属主凭行属主直写，
   旧属主即使持 editor 授权也改不了进度/状态——既有合同不是本卡缺口；要放开需独立卡。
3. **协作者打开共享文章页的属主专属副作用静默失败**（如 unread→reading 直更被 RLS
   拒）：064 已知中间态在文章页的体现，非本卡引入。
4. **tasks 域属主迁移仍未做**：task_item_refs 复合外键同时锚定 notes 与 tasks，
   任务转移必须连带决定引用它的笔记块去留（产品语义比 notes/reading_items 复杂），
   独立成卡。
5. **本地 Docker 拉取通道已恢复**（此前记载的 `docker pull` hang 未再复现，
   `supabase start -x supavisor,imgproxy` 正常拉起），pgTAP 本机全新库实跑
   23 文件 / 582 断言全绿；CI 仍以 pin 版本为准。

## P5 收尾：笔记属主移交 068（已完成，2026-08-31）
无阻塞。声明归档（违反会重新打开本卡的坑）：
1. **评论线程 / 评论 / 建议的 user_id 在 056 复合外键合同里是租户列**：转移后这三类
   行的作者列变为新属主，历史评论在界面上会显示为新属主名下——这是 056「同租户」
   设计的既定取舍，不是 068 引入的归因缺陷，不要改成删评论来保作者名。
2. **旧属主的访问由既有空间授权决定**：移交后 A 通常仍以 editor 保留（resource_acl
   未动），想彻底退出自行 revoke_resource；不要在移交 RPC 里顺手改授权。
3. **content 级引用不在 DB 层处理**：内部链接走 043 链接状态装饰（显示「链接失效」），
   同步块 / 数据库块走既有失败降级。若未来做「层级整体移交」，先补这些域的映射。
4. **本地 pgTAP 已恢复可跑（附代价）**：Docker 拉取通道仍坏（`docker pull alpine`
   hang，supabase start 卡在拉 gotrue v2.195.0 / postgrest v14.5）。绕法 = 把本地缓存
   的 gotrue v2.196.0 / postgrest v16.1 retag 成 `.temp` 钉住的旧 tag + `-x supavisor,
   imgproxy` 启动——本地这两个服务比 pin 版本新（pgTAP 只依赖 postgres 17.6.1.166，
   该镜像版本正确），CI 仍以真实 pin 版本为准。pgTAP 068 本机全新库 64 断言全过，
   22 文件 / 542 断言全绿。

## P5-03 协作生产化遗留评估（2026-08-31，勘察结论）
两条 PROGRESS 登记的「生产化可加」项，经源码勘察**当前不可落地**，根因同源：
1. **token 同步（onTokenSync）**：`@hocuspocus/server` 4.6 有 `onTokenSync` 钩子，
   但 `@hocuspocus/provider` 4.6 **没有 `setToken` API、也不发送任何 token 刷新
   消息**（provider d.ts 的 token 只是构造选项）。服务端钩子等不到消息 = 死代码。
   生成化前置：上游 provider 支持连接内 token 刷新，或客户端在 Supabase 会话刷新
   （`onAuthStateChange TOKEN_REFRESHED`）时销毁重建 provider（重连即重新
   onAuthenticate，拿新 token + 新角色）。后者改动 `use-note-collab`，需真实后端
   e2e 验证编辑态重建（本机 Docker 坏，做不了），需独立卡。
2. **存量连接角色周期复核**：依赖 1——token 过期（默认 1h）后复核失败，无法区分
   「被撤权」与「token 过期」，安全复核必须先有新 token。现状合同不变：角色变更
   在下次连接时生效（重连即复核）。

## 逐域迁移业务行属主——下一张独立卡的勘察笔记（2026-08-31）
ROADMAP P5 最后一条登记待办（一次一个资源域，建议首域 = notes）。规模证据，
防止低估：
1. **`task_item_refs` 复合外键同时锚定 notes 与 tasks 的 (id, user_id)**（056）：
   改 `notes.user_id` 会让旧引用行失配（FK 限制 UPDATE），而把引用行改到新属主
   又要求任务同属新属主——**转移笔记必须连带决定任务去留**（同转 / 断链），
   这是产品语义决策，开工前先拍板。
2. **子资源各自的 user_id**：highlights（014 自带 user_id + RLS）、note_versions
   （RLS 经 notes join 判属主，010）、评论/建议作者（004）、note_ydocs（067 FK，
   新鲜度规则用 notes.updated_at）。转移后这些行的可见性与归属要逐表对齐。
3. **备份合同 v4**：导出按 user_id 圈行，转移即「旧属主导出不含该笔记、新属主
   含」——语义自洽但 restore/校验测试要补转移后往返用例。
4. **UI 入口未定**：分享面板加「移交属主」段（仅 owner 可见）是最自然位置。
结论：一张完整卡（迁移 + pgTAP 双用户 + 备份往返 + mock + UI），不塞进本会话。

## P5 后续产品卡：协作空间管理 UI（已完成，2026-08-31）
无阻塞。四点合同声明归档：
1. **邀请成员不在空间页**：邀请与授权是同一动作（ADR 0002），仍走笔记分享面板；
   空间页只做存量成员管理（改角色/移除/移交/退出）+ 建空空间 + 重命名 + 解散。
   空空间在分享面板的「加入 <空间名>」下拉里即可作为邀请目标。
2. **解散空间是 RLS DELETE 直更**（063 "Owner can delete team workspace"），
   级联撤掉 workspace_members 与 resource_acl——授权立即消失是语义而非 bug；
   确认框文案已明示。属主重命名同理走直更（RLS UPDATE 只放行 owner）。
3. **个人空间（kind=personal）不进管理页**：单成员、无可管理关系；063 RLS 的
   「成员可见自己参与的空间」在页面上等价于 team 空间集合。
4. mock 后端：空间表查询为空集 → 空态；新建/管理 RPC 显式 P5-02-MOCK 报错并
   如实展示（P5-02 卡 4 既有合同），不假成功。侧边栏入口与「与我共享」同约定恒隐藏。

## P2-03 收尾缺口（2026-08-31 复核）
**staging 落后 master**：云库（ref sgkviverpercklxsjbcv）停在 062，master 已到 067
（063–067 协作/协作 blob 迁移未上 staging）；collab-server 也尚未部署到常驻主机。
本机当前无 Supabase access token / Vercel CLI 登录态，需用户重新提供云凭证后才能
继续：`supabase link` → `db push` → 云库 pgTAP、Auth 回调与邮件验证、collab-server
部署 + `NEXT_PUBLIC_COLLAB_WS_URL` 配置、第 6 步人工验收清单（见 deploy-runbook.md）。

## P5-03 生产化卡（ydoc 持久化 + 播种租约，2026-08-31）
无功能阻塞。三点声明归档：
1. **pgTAP 本机未跑成，以 PR CI db-test 为准（环境故障，非本卡 SQL 问题）**：
   证据链——`docker pull` 对任意镜像（含 alpine）hang 但 `docker ps/exec` 正常、
   到 public.ecr.aws 的 HTTPS 连通正常（curl 0.6s 返回 401）→ Docker daemon 拉取
   通道坏；supabase CLI 2.116.0 需要 postgres 镜像 17.6.1.166（本地只有 .165，
   `db reset/start/test db` 全部在 pull 阶段静默挂起）；把本地 .165 retag 成 .166
   后 db 容器可起，但 002 起的迁移依赖 `storage.buckets`，其 schema 由 storage-api
   容器初始化，完整 start 又需要拉 analytics/pooler 等新服务镜像 → 死循环。
   修复方向：重启 Docker Desktop / 手动 `docker pull` 恢复后跑 `supabase test db`。
2. **blob 与快照的分工是合同**：notes.content 由客户端 v2 节流快照维护（事实源，
   进备份/版本链）；note_ydocs 只由 collab-server 读写（回放缓存，不进备份）。
   不要给 blob 开客户端直写路径，也不要把它加进 BACKUP_TABLES。
3. **播种仲裁走无状态消息协议**（`seed-req/grant/wait/deny`，见 seed-lease.ts）：
   协议变更必须同时改 collab-server 与 tiptap-editor 的 seed effect；客户端只有在
   `seed-grant` 且 `editor.isEmpty` 且有 `seedContent` 时才播种。

## P5-03 实时协同（已完成，2026-08-31）
无阻塞。四点声明归档：
1. **服务端文档不持久化是本期刻意边界**：Y.Doc 在 collab 进程内存中，进程重启丢房间；
   兜底是客户端节流快照（丢失窗口 ≈ 快照间隔，正常编辑 1~3s）。服务端 ydoc blob
   持久化 + 服务端播种是下一张生产化卡（ADR 0003「持久化（生产化卡）」）。
2. **空房间并发播种竞态已知**：两客户端同时首次进入空房间会各自播种出重复段落；
   日常「先开后开」不触发，生产化卡的服务端播种根除。
3. **协作在线时乐观锁被跳过**（expected_revision=null）：这是 CRDT 模式的定义而非漏洞；
   冲突对话框仅存在于降级路径（会话断开回退乐观锁主链）。
4. **鉴权/授权口径**：collab 服务只验 Supabase JWT + 调 `resource_role()`，不缓存角色、
   不自建判定；角色变更（如被移出空间）在下次连接时生效，存量连接不强制踢出（生产化
   卡可加周期复核）。

## P5 后续：备份 manifest 排除清单声明协作表（已完成，2026-08-31）
无阻塞。两点声明归档：
1. **`REQUIRED_EXCLUSIONS` 只代表校验底线（旧五类），刻意不随本次扩张**：新备份多声明
   `collaboration_acl` / `user_profiles` 能过校验，旧备份只声明五类也能过——manifest 的
   排除项是「声明」不是「枚举」，收紧即破坏所有既有备份文件。
2. **排除 ≠ 永不备份**：若未来定义出空间/授权的 remap 语义（授权目标与空间都在备份
   白名单内），把协作表收进备份合同时应同步从 `EXPORT_EXCLUSIONS` 移除并更新 ADR 0002。

## P5 后续：协作者归属列 notes.last_edit_by（已完成，2026-08-31，066）
无阻塞。五点合同声明归档（违反任何一条都会重新打开本卡的坑）：
1. **无外键是刻意的**：跨账号恢复、协作者注销都会让 uuid 悬空；带 FK 会让 restore /
   账号删除连锁失败。消费方按「user_profiles 查不到名字 → 回退通用文案」处理。
2. **不回填是刻意的**：列引入前的编辑者不可知；NULL = 「该行最后编辑早于 066」，
   不要用 `user_id` 假装归属。
3. **restore 不搬运是刻意的**：导出携带（供检视）、校验 optional（旧备份兼容）、
   prepareRestorePayload 置空、restore RPC 列清单不收——四处口径一致，见备份测试。
4. **只由保存 RPC 写**：mutate_trash / 直接表更新不改它。它回答「谁最后编辑了内容」，
   不是「谁最后碰了这行」。若未来加编辑器外写路径（如协同 CRDT 落库），必须同步写归属。
5. **发现的既有雷（066 已拆）**：031 的 `save_note_with_tasks` 7 参老重载与 8 参现役
   版本并存，≤7 个命名参数的调用会因重载歧义直接解析失败（本卡 pgTAP 在 CI 上实测
   撞过）。**066 迁移第 2 节已顺手 drop 该老重载**（仅留 8 参唯一候选，默认参数正常
   解析），无需再立卫生卡。

## P5-02 卡 4/4 协作前端接入（已完成，2026-08-31）
无阻塞。四点声明归档：
1. **冲突对话框不显示协作者名字**：ROADMAP 卡 4 原文含「冲突对话框里的协作者名字」，但
   `notes.last_edit_by` 列不存在（ADR 0002 刻意不加，需连带备份合同 v4 + mock seed +
   原子保存测试独立成卡）。在列落地前任何「名字」都是编造，文案改为如实的
   「另一页面、设备或协作者已修改这篇笔记」。
2. **mock 对齐决策（卡面要求显式决定）**：不做 api-shim 条目、不 seed 协作表——
   `resource_role` 在 mock 如实返回 owner（mock 单用户世界真实成立，保存永远走 v1），
   协作管理 RPC 显式报错 `P5-02-MOCK`，分享面板展示错误而不是假装分享成功；`/shared`
   与侧边栏入口 mock 下为空/隐藏。前端卡无 `/api/*` 新路由，故 api-shim 无需覆盖。
3. **邀请流程的服务端约束如实透传**：`add_workspace_member` 只允许空间 owner 操作，
   非 owner 在既有团队空间邀请会得到明确报错（面板展示「只有空间所有者能这样做」）；
   新建空间邀请不受此限。`grant_resource` 要求调用者是目标空间成员（063 设计）。
4. 根目录 turbo `pnpm lint` 在 `@organize/plugin-sdk` 既有失败（缺 tsconfig.json，非本卡
   引入）；CI 门禁是 apps/web 的 `next lint`，本卡 0 警告。

## P5-02 卡 3/4 协作保存 RPC 分权（已完成，2026-08-31）
无阻塞。三点声明归档：
1. **056 埋了一个会让协作保存整体失败的雷（本卡修掉）**：056 给 `prune_note_versions` 加了
   `notes.user_id = auth.uid()` 校验，而 `save_note_version` 触发器在协作者保存时
   `auth.uid()`=协作者、`NEW.user_id`=属主 → 校验不成立直接 raise，B 的第一次内容变更保存
   必炸。065 拆出 `prune_note_versions_for(note_id, owner)`（internal-only）让触发器按
   `NEW.user_id` 裁剪；对外 `prune_note_versions(uuid)` 签名与属主校验原样保留，056 的越权
   负例仍红。单用户路径不受影响（属主保存时两者本就相等）。
2. **051 复选框语义的精确口径（测试里钉住，防误读）**：勾选（done）= 从非 done 真实完成，
   所以**勾选会把 in_progress / cancelled 也完成**；只有「取消勾选」受保护（不把
   in_progress / cancelled 抹回 todo）。`docs` 里 051 头注释「cancelled 不受复选框影响」只对
   取消勾选成立，065 的 pgTAP 按真实实现断言。
3. 本机 059 / 056 的既有漂移同前卡（见下），非本卡引入；065 文件本机 94/94 绿，CI 全新库
   预期 19 文件 / 429 断言。

## P5-02 卡 2/4 协作可见性接入（已完成，2026-08-31）
无阻塞。两点声明归档：
1. **既有门禁抖动（非本卡引入）**：`056_db_authorization` 第 4 条断言用 `now()` 与
   `now() + interval '1 minute'` 播两条自动版本，跨整点时两条落在不同小时桶，裁剪后
   剩 3 条而不是 2 条 → 必红。本机 10:59Z 复现一次，几分钟后同一条绿。修法是把两条
   版本播到显式截断到整点的同一小时内，但那属于 056 的卡，不在本卡顺手改。CI 若撞上
   同一个分钟窗口会假红，重跑即可（不改断言、不放宽）。
2. **协作者此刻只能读，且读到的共享笔记「历史/标签/反链为空」**：064 刻意没加任何写策略，
   子资源仍 owner-only。合并后到 065 落地前，产品可见行为就是「协作者打得开、改不动、
   版本列表为空」。这是合同，不是 bug，不要用它当理由去开一条热修 RLS 写策略。

## P5-01（已完成，2026-08-31）
无阻塞。三点声明归档：
1. 本机 `supabase test db` 里 **059_task_atomic_update 恒定失败**
   （`permission denied for table task_mutations`）是既有环境漂移：本机 `postgres` 角色非
   超管，而 059 只 GRANT 了 `select, insert`。CI 全新库同文件绿，故 063 的断言刻意不依赖
   表级 GRANT 的错误文案，改断「数据有没有变」。
2. **上游文档前提为假**：`docs/collaboration-plan.md` 称「038 预留 `notes.last_edit_by`
   列位」，实测 `notes` 无该列、迁移全文无此名。Stage 0 的 PR3（065 保存 RPC v2）因此
   多出「加列 + 备份合同 v4 字段清单 + mock seed + 回归测试」一整块工作，不能按计划原文
   「顺便写一下」。
3. 三张新表不进备份合同 v4、业务行属主不转移（只做控制面转移），均为本原型刻意的最小
   边界，已登记 P5-02。

## P1-01（已完成，2026-08-29，PR #180）
无阻塞。已知限制归档：
1. 去重两步（查询→插入）非原子，极端并发窗口可能重复；未加部分唯一索引的原因是
   020 恢复 RPC 明文插入 + 历史重复行会破坏 v4 备份往返，DB 收口须连恢复 RPC 一起改
2. mock 分支 delete 为硬删，软删除语义由真实分支 RLS 推导 + stub 单测覆盖

## P1-02（待合并）
无阻塞。一点声明：**经验复习功能整体移除而非修复**——lessons 表无 next_review_at
列（012），原「待复习」数据源不存在；是否引入复习算法是产品决策（P1-02 卡面原文），
未来若引入需先加正式 schema（迁移 + RLS + GRANT + 备份合同 + mock 同步）。

# BLOCKED — 任务工作台与月历（历史）

## P0-04（已完成，2026-08-29，PR #179）
无阻塞。遗留声明归档：
1. 附件/图片文件本体不在备份内（仅元数据）——UI 清单已明示，文件级打包属后续增强
2. mock 后端：restore-section 的恢复走 /api/backup/restore（服务端路由，mock 下不可用）；
   预检（inspect）为纯客户端逻辑两种模式均可用
3. 继承：1 个 moderate（uuid，TipTap 锚定不可达，随 P2-01）
# BLOCKED

## P0-03（已完成，见 PROGRESS）
无阻塞。两点设计记录（非阻塞）：
1. mock 后端模式下 user_ai_settings 走浏览器内存 client（RLS/表权限收回只在真实
   后端有意义），SSRF 校验在应用层对两种模式一致生效
2. AI 功能本体（实际调 OpenAI 兼容端点）在 mock 下依旧不可用——P0-03 的验收是
   安防层单测覆盖，不依赖真实 AI 调用

# BLOCKED — 任务工作台与月历（历史）

## P0-02（已完成，2026-08-29，见下）
无阻塞。两点环境说明（非阻塞）：
1. 本机无 Docker/Supabase CLI，pgTAP 验证由 PR 的 CI db-test job 实跑（迁移 001–056 + 全部测试文件）
2. 继承自 P0-01 的 1 个 moderate（uuid，TipTap 锚定、不可达）不变，随 P2-01 处理

# BLOCKED — 任务工作台与月历（历史）

## P0-01（已完成，2026-08-29）
无阻塞。基线数字与任务书完全一致并全部达成。遗留（非阻塞）：1 个 moderate（uuid，TipTap 锚定不可升级，实测仅 v4 用法、公告影响 v3/v5/v6——不可达），登记随 P2-01 TipTap 升级决策一并处理。

# BLOCKED — 任务工作台与月历（历史）

## 已合入 master（#65–#74）
全部功能 + 测试 + 文档。详见 PROGRESS.md。

## 最终验证序列全过（2026-08-02）
test 48/408、typecheck 0、build ✓、db test 30/30、migration 001-033、git diff --check 0。

## 红→绿反向验证证据（DB 层实测）
1. 跨用户 RLS：B→A 的清单 count=0（红），A→自己 count=1（绿）。
2. 非法结束时间：check_violation 拒绝（红），合法接受（绿）。
3. 重复任务幂等：二次调 RPC 返回 null（pgTAP 覆盖）。
4. 提醒≤3：第 4 条被拒 23514（pgTAP 覆盖）。
5. 上传补偿：前端实现元数据失败删 storage 对象。

## 本分支补的缺口
- mock 新表 seed（task_lists 等）✅
- 触屏日期面板说明（点任务→Dialog 选日期）✅
- 红→绿证据写入 PROGRESS.md ✅

## 未完成（执行 agent 固有限制）
- 真浏览器验收截图：无浏览器，需人工。代码已就绪，功能经自动测试验证。
- 双账号端到端越权：DB 层 RLS 红→绿已验证，但未做完整浏览器双账号。

## 无（越界项）
无。
