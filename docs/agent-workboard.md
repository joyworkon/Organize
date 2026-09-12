# Organize Agent Workboard（任务卡唯一状态账本）

> 本文件是任务卡的**唯一状态真相源**，由 [长期计划](long-term-agent-plan-2026-09-11.md) A01 建立（2026-09-11）。
> 规则：每张卡完成后只更新本文件的对应行；旧 `docs/ROADMAP.md` / `PROGRESS.md` / `BLOCKED.md` / `docs/handoff/execution-log.md` 保留为历史正文，顶部已链接到这里，不再作为当前状态入口。
> 状态取值：候选、就绪、进行中、待验证、阻塞、完成、取消。代码已写但真机/真实后端未测，必须标「待验证」。
> 卡片定义（范围/验收/边界）以计划原文为准，本表只维护状态与证据，不复制卡面。

## 全局基线（2026-09-11）

- master = `4667b84`（A03 合并后）；迁移 `001–075`；备份 `BACKUP_VERSION = 5`（`apps/web/lib/backup/schema.ts:2`）。
- Vitest 基线：A03 后 148 文件 / 1,099 用例；A04 后 148 文件 / 1,101 用例（+middleware 豁免 1、+classifyConflict jsonb 键序 1，本地实跑全绿）。以各 PR CI 复核为准。
- 验证门禁：web typecheck / Vitest / 零警告 lint / build；UI 改动跑相关 E2E；数据库改动跑隔离 pgTAP（含越权负例）；协作改动跑 collab-server build/test + 真实协作 E2E。纯文档卡只做链接/内容检查。
- 遗留开放 PR：#210（Chrome 扩展）、#212（plugin 包类型检查修复）——均早于本计划（2026-09-01/02 创建），是否收编或关闭**待用户决定**，接力 Agent 不得擅自合并或关闭。

## 卡片状态

### A 波次：事实基线与发布/协作风险证据

| ID | 卡 | 规模 | 状态 | 依赖 | 执行者 | PR/commit | 关键证据 | 未验证项 |
|---|---|---|---|---|---|---|---|---|
| A01 | 唯一状态账本 | S | 完成 | — | engineering-agent | #260 | 本文件；旧文档顶部链接已加 | — |
| A02 | Service Worker 跨版本更新与离线边界 | M | 完成 | A01 | engineering-agent | #261 | 复现证据（2026-09-11，/tmp/sw-repro）：未缓存脚本离线收到 `200 text/html`（sw.js 旧实现回退 `/`）；断网刷新 hydration 失败；sw.js 字节不变致 `update()` 无 waiting；旧构建 chunk 在新构建服务 404。修复：版本化缓存（gen-sw 构建注入时间戳）、类型分流回退（仅导航可回退 HTML，最终到零依赖 `public/offline.html`）、用户确认式安全激活（SKIP_WAITING 消息 + 非阻塞「新版本已就绪」提示，不强制刷新）、保留上一版缓存供旧标签页、`app/error.tsx` 旧 chunk 失败兜底文案。行为证据：`e2e/sw-update.spec.ts` 双构建 6 条全过（本地 SW_E2E=1 实跑）；CI 新增 sw-e2e job 常跑。**A04 追加修复（同缺口实测）**：middleware 307 拦截 `/sw.js` 致未认证页注册永久 SecurityError，且登录为 SPA 导航 registrar 不重试 → 登录会话全程无 SW；已豁免 `/sw.js`/`/offline.html` + registrar 有界重试（见 A04 PR） | 真实生产灰度观察；真实后端双账号切换实机验证；**SW 缓存页离线重开仍不可读笔记（X1-2B 合同，本地草稿读取未接通离线失败路径，A04 实测确认）** |
| A03 | 真实后端和协作 CI | M | 完成 | A01 | engineering-agent | #262 | 修复前证据：ci.yml 无 collab build/test、协作 E2E 依赖 `COLLAB_E2E=1` 从不进 CI、Supabase CLI `version: latest`（漂移）。修复：verify job 加 collab-server build/test；新增 collab-e2e job（完整本地 Supabase + seed 双账号/匿名分享 + collab-server:1420 + 真实后端 web:3100，显式 `COLLAB_E2E=1`，服务启动失败即失败，诊断工件上传，栈密钥不回显）；Supabase CLI 固定 2.116.0（db-test 同步）；master 分支保护补 required checks。验收：PR #262 CI 五 job 全绿（verify/e2e-test/sw-e2e/collab-e2e/db-test 均 SUCCESS，2026-09-12 复核）；登录双账号/匿名协作/刷新持久化由 collab.spec + anon-collab.spec 实跑覆盖 | — |
| A04 | 同步块双浏览器可靠性验收 | M | 完成 | A03 | engineering-agent | 本 PR | 交付：`e2e/synced-block.spec.ts` 7 场景（旧 hydrated 不信任/两页同步/并发分叉/断网重开/响应丢失 409 幂等/配额兜底/撤权等价态）+ `seed-synced-block-e2e.mjs`（幂等 + 清 note_ydocs 残留）+ 接入 CI collab-e2e job（`REAL_DB_E2E=1`）。**实跑发现并修复 4 个真实缺陷**：① 登录路径协作播种从未工作——上游 `@tiptap/extension-unique-id@2.27.2` onCreate 在 provider synced 时给空文档 dispatch 补 id，更新先于 seed-req 到达 → 服务端 markSeeded → 租约 deny → 编辑器停空文档（collab/anon 因不依赖预播种内容/另一套编辑器而未暴露）；协作模式改为抑制该 onCreate，初始回填由手动 effect 接管。② 空文档反向覆盖丢数据——回填等待以 `seedContent` 非空为前提（页面异步加载，可能晚于 synced），且 8s 封顶后给空文档补 id 并 `onUpdate('hydrate')` → 保存链把空文档写回 notes.content（实测种子笔记 3 块被清空、标题丢失）；改为无条件等待 + 封顶仍空不写不存。③ 同步块 409 幂等比较键序敏感——服务端 jsonb 规范化键序 ≠ 客户端插入序，`JSON.stringify` 恒不等 → 重试永远降级 conflict；改 `stableStringify`（递归键排序）比较。④ middleware 307 拦截 `/sw.js`——SW 脚本请求不允许重定向，未认证页注册 SecurityError + 登录 SPA 导航不重试 → 登录会话全程无 SW；豁免 `/sw.js`/`/offline.html` + registrar 有界重试。**测试基建**：三个种子脚本删固定 UUID 笔记的 note_ydocs（重跑同一起点）；collab.spec openNote 等播种完成（≥2 块）。**证据**：本地完整栈（真实 Supabase + collab-server + 真实后端 web 构建）全套 10/10 连续两轮全绿（可重复性）；Vitest 148 文件/1,101 用例；typecheck/lint 零告警 | CI collab-e2e 首跑本 spec（本地两轮绿，CI 时序可能暴露新 flake）；发现「协作会话建立前输入随编辑器重建丢失」窗口（collab.spec 曾因此时序失败，已加等播种守卫，产品修复归 A05）；「SW 缓存页离线重开不可读」记入 A02 未验证项 |
| A05 | 协作会话刷新与撤权（先设计） | L | 候选 | A03 | — | — | 上游限制：`@hocuspocus/provider` 4.6 无 `setToken`（BLOCKED.md P5-03 评估，2026-08-31）；需核实现装版本。**A04 新增设计输入（实测）**：① 编辑器先以非协作实例挂载、协作会话建立后重建，期间的输入随旧实例销毁丢失（用户级丢字窗口，collab.spec 曾因此时序失败，测试侧已加「等播种完成」守卫，产品修复未做）；② 播种租约 deny 后客户端无任何用户可见反馈（编辑器静默空白） | 存量连接撤权窗口未定义未测 |
| A06 | 匿名入口多实例限流 | M | 候选 | A05、扩大公开部署前 | — | — | 现状：HTTP 保存与 WS 握手为进程内 token-bucket（BLOCKED.md Track A/B 声明 3） | 多实例拓扑未定 |

### B 波次：数据恢复、性能、关系完整性、可维护

| ID | 卡 | 规模 | 状态 | 依赖 | 执行者 | PR/commit | 关键证据 | 未验证项 |
|---|---|---|---|---|---|---|---|---|
| B01 | 备份 v5 完整恢复演练 | M | 就绪 | A01 | — | — | `BACKUP_VERSION=5`；075 后含速记关联；Storage 排除声明在 manifest | A/B 账号逐项往返从未完整执行；旧 v2/v3/v4 文件、损坏/超限文件未测 |
| B02 | 完整性能测量 | M | 就绪 | A01 | — | — | R12 报告 `docs/handoff/r12-measurement.md`：savePosts/draftSize 两项仪表未捕获、0/10/30 图片样本与移动 Safari 未测 | 全部缺口即本卡范围 |
| B03 | 精确关系索引 R10b | L | 候选 | B01/B02 | — | — | R10a 已完成（074 RPC 文本 LIKE + 客户端聚合 ≤5,000）；R10b 未开工 | — |
| B04 | 编辑器块交互拆分 | M | 候选 | A03 | — | — | R09 已拆装配与上传；块交互/协作适配遗留（计划 §2-6） | — |
| B05 | 协作适配职责拆分 | M | 候选 | A05/B04 | — | — | 播种与 transaction-source 适配仍在 UI 控制 | — |
| B06 | 有证据的本地存储优化 | L | 候选 | 仅 B02 证实瓶颈后 | — | — | R12 结论：当前无瓶颈证据，默认不实施；B02 无瓶颈则本卡取消并记证据 | — |
| B07 | 附件可携带备份 | L | 候选 | B01（先交设计） | — | — | 现状仅元数据进备份（P0-04 声明 1） | — |

### C 波次：界面可持续修改与多端闭环

| ID | 卡 | 规模 | 状态 | 依赖 | 执行者 | PR/commit | 关键证据 | 未验证项 |
|---|---|---|---|---|---|---|---|---|
| C01 | 可持续改版界面地图 | S | 就绪 | A01 | — | — | D00–D06 已完成（`docs/handoff/execution-log.md`）；PR #257 后导航已变，旧图不代表现状 | 交付 `docs/ui-change-guide.md` |
| C02 | 键盘与可访问性改进 | M | 候选 | C01 | — | — | — | 未审计 |
| C03 | 手机真机工作流 | M | 候选 | C01 + 真机 | — | — | 手机 **Web 布局**已完成（PR #257 底部五模块）；**原生 App 发布**是另一回事（见下方分流） | 中文输入法/软键盘/安全区/横竖屏全部待真机 |
| C04 | macOS 刘海与多屏矩阵 | M | 候选 | A01 + 真机 | — | — | `docs/macos-notch-compatibility-review-2026-09-06.md` + 后续修复（`07b51d6` 等）；不能重复修已合并项 | 混合缩放/热插拔/睡眠唤醒待矩阵 |
| C05 | 通知端到端闭环 | L | 候选 | A02/A03 | — | — | 双响防线三道锁已存在（BLOCKED.md W1–W6 声明 5） | Cron 重试/夏令时/点击跳转未端到端 |
| C06 | 功能入口整合提案 | S | 候选 | C01/C03 | — | — | 候选：任务/经验复盘、笔记/图谱、速记/快速记录 | 产品方向待用户定 |

### D 波次：可控部署与多端内部发布（外部凭据依赖）

| ID | 卡 | 规模 | 状态 | 依赖 | 执行者 | PR/commit | 关键证据 | 未验证项 |
|---|---|---|---|---|---|---|---|---|
| D01 | 部署差距清单与 staging 恢复 | M | 阻塞（外部凭据） | A02–A05/B01 + 云凭据 | — | — | 有效阻塞：云库停在 062（BLOCKED.md P2-03 复核，2026-08-31，时值 master 067，现已 075 更落后）；本机无 Supabase access token / Vercel 登录态 | 实际部署 commit/域名归属需重新只读核实，不信任旧版本号 |
| D02 | 桌面受控内部发布 | L | 候选 | D01/C04 | — | — | `frontendDist` 曾指向被第三方占用的 `organize-web.vercel.app`（P4-01 警告），现归属需重验 | 安装→更新→深链全链路 |
| D03 | Android 内测版 | L | 候选 | D01/C03 | — | — | `mobile/` Capacitor 骨架未完整实现（AGENTS.md） | 真机核心路径 |
| D04 | iOS TestFlight 准备 | L | 候选 | D03 | — | — | 开发者账号/证书为外部依赖 | — |
| D05 | 正式发布与日常运维 | M | 候选 | D01 | — | — | — | — |

### E 波次：按使用反馈候选（须用户选定方向后才开工）

E01 导入迁移工作台、E02 阅读→行动闭环、E03 每日回顾、E04 AI 体验整理、E05 插件兼容合同、E06 数据模型长期演进——全部**候选**，无执行者。

## 易混淆项分流（A01 验收要求）

以下三组最容易把「部分完成」误读为「全部完成」，任何 Agent 领卡前先对照：

1. **R10a 完成 ≠ R10b 完成**：反链已有过渡方案（迁移 `074_note_backlinks_rpc.sql` RPC 文本匹配 + `lib/notes/backlinks.ts` 客户端聚合 ≤5,000 条）；精确关系索引（服务端维护 canonical 关系、授权可见性、稳定分页）是 B03，**未开工**。
2. **R12 已测 ≠ 性能已全面测量**：`docs/handoff/r12-measurement.md` 只有无图片文字样本；savePosts 计数与 draftSize 仪表当时**未捕获到数据**，10/30 张图片、复杂表格、大列表、图谱样本、移动 Safari 均未测——补齐是 B02。
3. **手机 Web 布局完成 ≠ 原生 App 发布完成**：PR #257 完成的是手机浏览器/PWA 布局（底部五模块+顶部工具）；原生 Android（D03）/iOS（D04）连内测构建都未开始，真机工作流（C03）未验收。

## 已完成能力基线（勿再从零开发）

| 能力 | 实现证据 |
|---|---|
| 稍后读统一收集（含失败降级） | `apps/web/lib/reading/collect.ts`（P1-01，PR #180）；五入口均为薄壳 |
| Markdown 导出与本地快照 | `lib/export/tiptap-to-md.ts`、`note-export.ts`（R01/R02） |
| 笔记保存会话与草稿错误可见 | `lib/notes/note-save-session.ts`、`hooks/use-note-session.ts`（R03/R07） |
| 同步块 revision 与冲突处理 | 迁移 073、`components/editor/extensions/synced-block.tsx`（R04/R05） |
| 反链过渡方案（R10a） | 迁移 074、`lib/notes/backlinks.ts` |
| 速记转笔记事务与关联 | 迁移 075 `memo_notes`（R11）；备份 v5 |
| 界面主题/主页面重排/辅助面板 | `docs/handoff/execution-log.md` D00–D06；移动导航 PR #257 |
| 登录与匿名笔记协作 | collab-server（ADR 0003）、`use-note-collab.ts`、071/072 |
| macOS 壳/刘海激发器/Windows 发布管线 | `desktop/`、`docs/notch-trigger-plan.md`、desktop workflows（W1–W6） |
| AI 安全边界 | `lib/ai/safe-request.ts`、`user_ai_settings` 走 `/api/ai/settings`（P0-03） |

## 历史 BLOCKED 三分类

`BLOCKED.md` 保留全部声明正文；此处只维护分流感见（2026-09-11）：

- **有效阻塞**（仍真实挡着，需外部条件或专门卡）：
  1. 云部署落后：staging 云库停在 062（master 已 075）+ 无云凭据 → D01 领卡时先重新只读核实（旧版本号只作参考）。
  2. 协作连接内 token 刷新：上游 `@hocuspocus/provider` 4.6 无 `setToken` → 不是立即可解的阻塞，是 **A05 的设计输入**（候选方案：会话刷新时销毁重建 provider，需真实后端 E2E）。
  3. 真机验收（C03/C04/D02–D04）：需硬件与人工，验收 Agent 出步骤包。
- **已解除**（历史记录，现状已恢复，勿再当阻塞引用）：
  1. Docker 拉取通道 hang（069 卡记录已恢复，`supabase start -x supavisor,imgproxy` 正常）。
  2. Rust 工具链缺失（P4-01 已经 rustup 装好；注意 cargo 不在默认 shell PATH，见交接）。
  3. 本机 postgres 角色权限漂移致 059 恒红（CI 全新库绿，属本机环境非代码缺陷）。
- **合同说明**（不是阻塞；违反会重开坑，改动相关域前先读 `BLOCKED.md` 对应声明）：
  匿名无归属/匿名不可改任务勾选/单实例限流/撤销下次连接生效/播种前空文档不落库/SMTP 未配不发信（Track A/B）；task_item_refs 复合 FK 移交语义与 PG 递归 CTE 限制（069/070）；评论作者列租户取舍（068）；blob 与快照分工、播种租约协议（P5-03 生产化）；备份排除清单是声明不是枚举；`last_edit_by` 四处口径（066）；051 复选框精确语义（065）；Windows 发布三条件硬门/私钥永不入库/双响防线（W1–W6）。

## 账本维护规则

1. 一张卡一个 PR；PR 内同步更新本表对应行（状态、PR/commit、证据、未验证项）。
2. 状态只能取：候选、就绪、进行中、待验证、阻塞、完成、取消；因不值得实施而取消也是有效结果（如 B06 无瓶颈证据时）。
3. 完成定义与验证层次见计划 §6；不得靠 skip、删测试、放宽断言、空实现或假成功交付。
4. 同一 checkout 同一时间只有一个写入 Agent；只读审查/设计/验收 Agent 的产出放仓库外（`/tmp/...`），由工程 Agent 核实后收编进本表。
5. 全局基线数字只在实测后更新（注明命令与 commit），不照抄历史。
