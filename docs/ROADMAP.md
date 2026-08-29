# Organize 产品路线图

> 2026-08 制定。六项规划的执行顺序按「依赖可行性」排列（无外部阻塞的先做），
> 与提出顺序无关。每项包含：目标与范围 / 方案 / 分期 / 依赖 / 风险 / 验收。
> 状态随进展更新；完成一项勾一项。

## 执行顺序与状态

| # | 规划项 | 状态 | 说明 |
|---|--------|------|------|
| 0 | 速记（flomo 式） | ✅ M1 已完成 | M1 全部落地（迁移 055 / API / UI / mock shim / 测试）；M2（全局弹窗、移动分享接入、每日回顾）待后续 |
| 1 | 笔记内置浏览器（嵌入块） | 📋 已规划 | 编辑器扩展，自包含 |
| 2 | 多端提醒（App/桌面/浏览器/Chrome） | 📋 已规划 | 扩展现有 Web Push 体系；桌面/App 部分依赖对应端外壳 |
| 3 | 线上版部署 | 📋 已规划（部分阻塞） | 功能侧可自动化；实际上线需用户提供云账号 |
| 4 | App 版（Capacitor 补全） | 📋 已规划 | 依赖线上版后端 + 用户本机 iOS/Android 工具链 |
| 5 | 多人协作（飞书式） | 📋 已规划（打地基） | 最大工程，先做共享/权限地基，实时协同分期 |

---

## 0. 速记（flomo 式）

**目标**：随处捕捉碎片想法，#标签 组织，可一键转为正式笔记。定位是「输入压最低的收件箱」，与笔记（成品）区分。

**方案**
- 新表 `memos`（迁移 055）：`id / user_id / content / tags text[] / deleted_at / created_at / updated_at`，RLS 行级隔离 + GRANT，`tags` 上建 GIN 索引
- 标签语法：内容中 `#标签`（正则提取，存 `tags` 数组，渲染时高亮回链筛选）；解析逻辑放 `lib/memos/tags.ts` 供 API 与 mock 共用
- API：`/api/memos`（GET 列表支持 `?tag=`、POST 创建）、`/api/memos/[id]`（PATCH 编辑、DELETE 软删）
- UI：`/memos` 页面——顶部大输入框（默认聚焦，Enter 保存 / Shift+Enter 换行，输入中实时预览标签）、按月分组的时间流、标签云筛选、删除（确认）、每条「转为笔记」（复用 `createNewNote` 写入正文并跳转）
- 入口：侧边栏一级「速记」、命令面板（G M）、移动端顶栏「新建」菜单项
- mock：`mockDb.memos` 种子 + api-shim 路由（与真实路由同形）

**分期**：M1（本轮）= 上述全部；M2（后续）= 全局快捷键速记弹窗（任意页面 Cmd+Shift+K 唤起）、移动端分享面板接入速记、每日回顾（随机回看）

**风险**：与「笔记」心智混淆 → 输入框文案与页面命名强调「随手记」；垃圾箱体系未接入 memos（软删字段已留，后续接 `mutateTrash`）

**验收**：mock 模式下从输入到标签筛选、转笔记全链路可用；真实后端迁移可应用；测试覆盖标签解析与全部路由

---

## 1. 笔记内置浏览器（HTML 嵌套 / 嵌入块）

**目标**：在笔记内直接嵌入网页 / 服务，不离开编辑器查看内容。

**方案**：新 TipTap 扩展 `embed.tsx`（`components/editor/extensions/`），对齐现有 `resizable-image` 的模式：
- 节点 `organizeEmbed`：属性 `src`、`sandbox 等级`、`高度`（拖拽手柄或预设 S/M/L）、`缩放`
- 渲染为 `<iframe sandbox="allow-scripts allow-same-origin allow-popups">` + 顶部工具条（刷新 / 新窗口打开 / 复制链接 / 删除）
- 插入方式：斜杠菜单「嵌入网页」+ 粘贴 URL 时若非图片询问嵌入
- **现实约束（关键）**：大量站点通过 `X-Frame-Options: DENY/SAMEORIGIN` 或 CSP `frame-ancestors` 拒绝被 iframe 嵌入。对策分两层：
  - M1：通用嵌入块 + 被拒时的友好引导（提示「目标站拒绝嵌入」+ 原链接跳转按钮）。对允许嵌入的服务（YouTube / Bilibili / CodePen / Figma / 音频等）做 URL 识别转官方 embed 形态（这些永远可用）
  - M2：桌面端（Tauri）利用 webview 能力做「真·内置浏览器」面板；Web 端可评估服务端代理抓取只读快照（成本与合规需评估）
- mock：编辑器功能纯前端，无需 shim

**分期**：M1 = 嵌入块 + 常见服务识别 + 被拒引导；M2 = 桌面端 webview 面板、代理快照

**风险**：iframe 安全（坚持 sandbox 白名单，不给 `allow-same-origin`+`allow-scripts` 同时作用于第三方源）；目标站拒绝嵌入是平台限制无法绕过，UI 必须把降级路径做好

**验收**：嵌入 YouTube / Bilibili / 任意允许站点可在笔记内浏览；拒绝嵌入的站点有清晰降级；内容随笔记保存 / 恢复 / 备份正常

---

## 2. 多端提醒（App / 电脑端 / 浏览器 / Chrome）

**目标**：任务到期提醒在所有端可达，用户在任何一端都能收到。

**现状盘点**：服务端 Web Push 已可用——GitHub Actions 每 15 分钟调 `/api/cron/task-reminders`（`TASK_REMINDER_BASE_URL` + `CRON_SECRET`），`public/sw.js` 负责展示通知；浏览器内还有前端 `useNotifications`（Notification API）即时提醒。**缺口**：桌面端（Tauri）与 App（Capacitor）的触达，以及 Chrome 安装为应用（PWA）后的推送一致性。

**方案**
- M1（Web/PWA，纯现有栈）：补齐 PWA 安装体验（manifest 图标/启动页核对）；推送订阅状态可视化（设置页显示「浏览器通知：已开启/被拒绝」与重新授权入口）；提醒去重（同一任务同一到期点只推一次，`task_reminder_deliveries` 已有表，核对覆盖浏览器内通知路径）
- M2（桌面 Tauri）：Tauri 通知插件（`tauri-plugin-notification`）；桌面端后台常驻拉取到期任务（复用同一 `/api/cron/task-reminders` 语义，改为客户端拉取 + 本地通知）；与浏览器 Push 互斥去重（同一账号同一任务只在一端响铃，用 deliveries 表记录端标识）
- M3（App Capacitor）：`@capacitor/local-notifications` 定时本地通知（App 活跃期）+ `@capacitor/push-notifications`（FCM/APNs，需要后端补 APNs/FCM 凭据写入 `web_push_subscriptions` 的适配）
- 服务端：`/api/cron/task-reminders` 扩展多目标投递（web push / fcm / apns 按订阅类型分发），保持 15 分钟粒度

**依赖**：M2 依赖桌面端外壳有基本可用形态；M3 依赖线上版后端（推送服务需要公网可达）

**风险**：iOS 上 Web Push 仅支持安装后的 PWA；FCM/APNs 需要开发者账号与证书（用户提供）；多端去重逻辑复杂度——先做「都提醒，靠 deliveries 表限频」再优化智能分发

**验收**：同一任务到期，浏览器（前台/后台）、桌面端、App 至少各收到一次且不重复轰炸；通知点击跳转到对应任务

---

## 3. 线上版部署

**目标**：公网可访问的正式环境，数据在云端 Supabase。

**方案（推荐组合：Vercel + Supabase Cloud）**
- 阶段 A（可自动化，本轮先做）：生产构建验证（`next build` 全量过）；`.env.example` 模板；`docs/DEPLOY.md` 部署手册（Supabase Cloud 建项目 → 推迁移 `supabase db push` → Vercel 连仓库配环境变量 → 配置 `TASK_REMINDER_BASE_URL`/`CRON_SECRET` → 验证清单）
- 阶段 B（需用户操作，一次性）：注册 Supabase Cloud 与 Vercel 账号，按手册执行；绑定自定义域名（可选）
- 阶段 C（上线后加固）：`middleware.ts` 鉴权在生产模式自动生效（mock 开关关闭即走真实鉴权）；错误监控（Sentry 可选）；数据库备份策略（Supabase PITR）

**依赖**：阶段 B 必须由用户提供账号与授权（我无法也不应代替注册付费服务）

**风险**：mock 开关绝不能带入生产（环境变量模板中显式注释）；爬虫/公开性——默认全站登录后可见，分享页 `/s/[token]` 除外

**验收**：公网域名可注册登录，数据落云 Supabase，提醒 cron 生效，HTTPS 正常

---

## 4. App 版（Capacitor 补全）

**目标**：iOS / Android 应用，与线上版共用后端与 Web 代码。

**现状**：`mobile/` 已有 Capacitor 骨架与部分功能（系统分享直达保存、Notion 式移动框架、底部快捷钮）。

**方案**
- M1：对齐线上版——App 指向云端后端、登录流程走 Capacitor 深链接（Supabase OAuth/邮箱回调适配）、图标与启动屏
- M2：系统能力——分享面板扩展（网页/文本/图片均可入）、本地通知（见多端提醒 M3）、安全区与手势打磨
- M3：发布链路——Android APK/AAB 构建（用户本机工具链）、iOS TestFlight（需 Apple 开发者账号，用户提供）

**依赖**：线上版后端（App 必须连云）；用户本机 Android/iOS 工具链与开发者账号

**风险**：Capacitor WebView 与 Next.js SSR 的适配（App 内跑静态导出或直连线上站，二选一，倾向直连线上站省一套构建）；iOS 上架审核对「工具类 + 账号体系」一般友好但需隐私政策页

**验收**：真机上核心链路（保存/阅读/笔记/速记/提醒）可用且与线上数据实时一致

---

## 5. 多人协作（飞书式）

**目标**：多个用户共享空间，协作编辑笔记 / 任务，权限可控，接近飞书文档的协作体验。

**这是六项中最大的工程，必须分期，且 M1 只做「共享」，不做「实时协同」。**

**方案（分期）**
- M1 共享与权限（打地基）：
  - 引入「空间/团队」概念的最小形态：`workspace_members`（user_id, role: owner/editor/viewer）+ 资源属主模型扩展。**关键决策：从「单用户 RLS（auth.uid() = user_id）」演进为「user_id ∈ 可见集合」，涉及全部核心表的政策改写，工作量最大的就是这一步**
  - 分享升级：现有 `/s/[token]` 只读分享 → 可选「邀请编辑」（对单篇笔记授权指定用户），通知入口
  - 操作审计的最小版：`updated_by` 字段进核心表
- M2 实时协同编辑：
  - 技术选型：Yjs（CRDT）+ Supabase Realtime（postgres_changes 或 channel 广播）+ 服务端持久化。TipTap 官方有 `y-prosemirror` 集成路径，编辑器侧改造可控
  - 存量笔记迁移：现有 jsonb 内容 → Yjs 文档的一次性导入脚本；旧版本快照只读保留
  - 在线状态 / 光标Presence / 评论已是现成的（004 体系），挂到实时层
- M3 任务协同：任务的指派 / 订阅 / 动态流；看板视图下的多人操作冲突（任务粒度用乐观锁即可，无需 CRDT）

**依赖**：M1 可在任何时候开始；M2/M3 强烈建议在**线上版部署之后**（实时服务需要公网与稳定的后端）

**风险**：RLS 全量改写是最高风险项（牵一发动全身）——对策：引入 `visible_user_ids(uid)` 辅助函数统一判断，逐表灰度；Yjs 文档与现有「内容乐观锁（content_revision）」冲突——协同模式下改用 Yjs 版本向量，单用户模式保留现有机制，两套并存按笔记开关；成本——Realtime 与存储用量上云后产生费用

**验收**：M1 = 两账号间完成一次「邀请编辑 → 对方修改 → 属主看到变更」闭环，且单用户既有功能零回归；M2 = 两浏览器同编辑一篇笔记无丢字；M3 = 任务指派流转闭环

---

## 执行节奏

按上表 0 → 1 → 2 → 3 → 4 → 5 推进；每项完成后更新本文件状态并回顾下一项规划是否需要根据实际情况修订。3（线上版）的阶段 A 可与 0/1 并行穿插，阶段 B 到位后 4 与 5 的后续分期解锁。
