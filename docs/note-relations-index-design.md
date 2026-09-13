# B03 精确关系索引 R10b——设计文档

编制：2026-09-13。代码基线：master `ead5353`（B02 后）。
计划卡：[long-term-agent-plan-2026-09-11.md §5 B03](long-term-agent-plan-2026-09-11.md)（L 级：先设计，再拆串行 PR）。
旧设计要求：[01-engineering-refactor-plan.md §R10b](handoff/01-engineering-refactor-plan.md)——「文档链接索引；先确认已有表/函数可复用，再新增，避免重复索引体系」。

## 1. 现状核实

### 1.1 R10a（074）现状

`get_note_backlinks`（`supabase/migrations/074_note_backlinks_rpc.sql`）按页返回「链接到目标笔记的来源笔记」元数据：
实现是 `notes.content::text like '%/notes/' || p_note_id || '"%'`（074:47）全表扫描调用者自己的笔记，权限过滤 `n.user_id = v_user`（074:43）。客户端 `fetchAllNoteBacklinks`（`apps/web/lib/notes/backlinks.ts`）按页循环取全，UI 侧 5000 条防御上限（`components/notes/backlinks.tsx:65-66`）。

### 1.2 v1 的精确性缺陷（本设计要修的）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| D1 | 纯文本误报 | LIKE 扫 `content::text` 全文，正文普通文本（含代码块字符串）中出现 `/notes/{id}"` 字样即计入 | 反链多报；「宁多勿漏」是 074 头注明的自觉妥协 |
| D2 | 外站同路径误报 | 同上；客户端 `extractLinksFromContent` 用 `href.includes("/notes/")`（`lib/note-links.ts:44`）同样把 `https://外站/notes/{uuid}` 误判为内链 | 反链/图谱都可能多报 |
| D3 | 带锚点/查询串漏报 | LIKE 要求 id 后**紧跟引号**，`/notes/{id}#h`、`/notes/{id}?p=1` 均不匹配；客户端 regex `[^/?#]+` 能匹配 | 服务端反链漏报，客户端图谱不漏 → 两处计数不一致 |
| D4 | 百分号编码漏报 | 客户端 `decodeURIComponent`（`lib/note-links.ts:19-25`）后能命中；服务端 LIKE 只匹配字面 uuid | 同上，服务端/图谱不一致 |
| D5 | 读放大 | 每次反链查询全表扫自己所有笔记的 content 文本 | 千篇来源规模时查询成本线性增长（验收「千篇来源」项） |

### 1.3 内链存储形态（判定依据）

- 应用内生成的内链一律是 TipTap link mark：`marks: [{ type: "link", attrs: { href: "/notes/{uuid}" } }]`
  （`tiptap-editor.tsx:1505`、`database-block-client.ts:105`）；阅读内链为 `/library/{uuid}`。
- href 可能带锚点/查询串（粘贴）；uuid 段理论上可被百分号编码（uuid 字符集无需编码，仅外部粘贴会出现）。
- 同步块实例不内嵌定义方正文：链接归属定义块所在笔记的内容，与 v1 语义一致，不变。
- 消费方：反链面板（`backlinks.tsx`）、图谱（`lib/graph/build-graph.ts:83` 客户端全量提取）。
  **图谱切到索引属后续项（计划 §2-4 明示），本卡不动图谱。**

### 1.4 `notes.content` 的全部写路径（维护机制必须覆盖的入口）

| 写路径 | 入口 | 索引如何覆盖 |
|---|---|---|
| 保存 | `save_note_with_tasks`（031）/ `_v2`（065）RPC | 触发器 |
| 直更 | `PATCH /api/notes/[id]`（`app/api/notes/[id]/route.ts:64`，含跨笔记移动块对两端 notes 的改写） | 触发器 |
| 创建 | `lib/notes/create-note.ts:69` 直接 insert、`POST /api/notes`、导入（markdown / joyspace）、memo→note（075） | 触发器（INSERT） |
| 恢复版本 | `restore_note_version`（046） | 触发器 |
| 备份恢复 | `restore_backup_v2*` 系列（020/024/027/033/034/041/042/058）——恢复时 `rewriteInternalLinks` 已把 href 重映射到新 id（`lib/backup/restore.ts:299-309`），悬空 href 原样保留（B01 缺陷② 的合法产品态） | 触发器 |
| 软删除 | `deleted_at` 置位（不动 content） | 边保留；读路径过滤软删来源（同 v1） |
| 硬删除 | 垃圾箱清空 DELETE | `source_note_id` FK `on delete cascade` 级联清边；目标硬删后边保留（指向不存在目标 = 合法 missing 态，恢复/重建后自动复联） |
| 移交归属 | `transfer_note_ownership`（068，只改 user_id） | 边是内容派生，不受影响；可见性在查询时按新归属判定 |
| 离线队列 | `lib/offline/note-queue.ts` 重连补写 | 触发器 |

**结论：单一 DB 触发器即可全覆盖，逐路径改造反而会漏。** 这也满足卡面「保存/导入/恢复/移动/删除都覆盖」。

## 2. 「有效内链」定义（本设计的核心合同）

笔记 A 的**最新 canonical content**（`notes.content` jsonb）中存在 ≥1 个 link mark，
其 `attrs.href`（取文本值）满足：

1. **站点相对**：整体匹配 `^/notes/[^/?#]+([?#].*)?$`（必须以 `/` 开头 → 外站绝对 URL 天然排除，修 D2）；
2. **段可解码为 uuid**：`/notes/` 与首个 `?`/`#` 之间的段做 ASCII 百分号解码后匹配
   `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`（修 D4；锚点/查询串不参与匹配，修 D3）。

满足则存在一条边 `(source=A.id, target_type='note', target_id=该 uuid)`。补充语义：

- **同型支持 `/library/`**：target_type `'reading'`，判定规则相同。本卡只暴露 note 目标的反链 RPC；
  reading 边进表备用（图谱统一是后续项），无 UI 消费者（候选决策 §9-a）。
- **目标不必存在**：边是内容派生事实，目标被硬删后边保留（missing 态）；这保证「恢复后正确」无需写者补边。
- **去重**：唯一键 `(source_note_id, target_type, target_id)`；同目标的锚点/查询串变体折叠为一条（与客户端按 `type:id` 去重一致）。
- **自链**：A 链接到 A 允许入表（内容事实），读路径排除（同 v1 `n.id <> p_note_id`）。
- **非边**：纯文本/代码块中的路径字样（无 link mark）、外站 URL（修 D1/D2）。

与 v1/客户端的语义差异汇总：v2 相对 v1 **收紧**两类误报（D1/D2）、**补齐**两类漏报（D3/D4）；
相对客户端提取**一致化**（服务端也解码、也接受锚点），消除「服务端反链 ≠ 图谱边」的现状分歧。

## 3. 共享来源可见性

- **来源可见谓词**：`public.resource_role('note', s.id) is not null`（063，own→`'owner'`，workspace 协作者→editor/viewer；
  ADR 0002「必须复用 063，不重写等价 SQL」）。即：来源笔记 = 我自己的 **或** 通过共享授予我读权的。
  v1 只取自己的来源；v2 扩到「授权共享来源」——这是卡面「共享来源可见性」的定义落点。
- **查询时判定**：`resource_role` 每次查询现算，撤权/移交给下一查询即生效 → **撤权不泄露标题/计数**（验收项），
  不存在快照过期窗口。
- **目标门槛（对 v1 的收紧）**：调用者必须能读目标笔记（`resource_role('note', p_note_id) is not null`，否则 42501）。
  v1 无此门。收紧无行为回归：反链面板只在可读笔记页挂载（`backlinks.tsx:37-42` 未登录即返回）；匿名公开分享页不渲染反链。
- **标题暴露面**：协作者（含 viewer）本就持有来源笔记 SELECT 权（064 policy），返回来源标题无新增泄露。

## 4. 存储与维护机制

### 4.1 表 `note_links`（迁移 078）

```sql
create table public.note_links (
  id uuid primary key default gen_random_uuid(),
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_type text not null check (target_type in ('note', 'reading')),
  target_id uuid not null,
  href text not null,                      -- 首次捕获的原始 href（调试/排障用，不参与判定）
  created_at timestamptz not null default now(),
  unique (source_note_id, target_type, target_id)
);
create index note_links_backlink_idx on public.note_links (target_type, target_id, source_note_id);
alter table public.note_links enable row level security;
-- 刻意不加任何 policy：客户端一律经 security definer RPC 读写，表对 anon/authenticated 无直查权
-- （循 067 note_ydocs 先例：RPC 收口 + service_role 直写）
grant all on public.note_links to service_role;
```

- **派生数据合同**（写入表头注释与账本合同区）：`note_links` 是 content 的派生索引，
  **不进备份导出、不进 mock**（循 067 模式）；恢复后由触发器从重映射后的内容重建，丢表不丢数据。
- 迁移头注释声明与 074 的关系：v1 RPC 保留为回退读路径，不删除、不回滚。

### 4.2 提取核心（SQL 已在本地栈验证，见附录 A）

- `note_links_pct_decode_ascii(s text)`：ASCII 百分号解码（`%XX` → 字节；uuid 段只可能含 ASCII，多字节序列不在目标域）。
- `note_links_extract(content jsonb) returns table(target_type text, target_id uuid, href text)`：
  `jsonb_path_query(content, 'lax $.**.marks[*].attrs.href')` → 文本化 → §2 判定 → DISTINCT
  （lax 模式同一 href 可能经两条结构路径命中，DISTINCT 消化）。
  **同时返回 note 与 reading 两类**；类型由前缀段决定。
- 两个函数：`revoke all from public, anon, authenticated`（仅触发器/回填/RPC 内部使用）。
- security definer 函数一律 `set search_path = pg_catalog, public`（同 074 惯例）。

### 4.3 维护触发器（新写维护）

```sql
create function public.sync_note_links() returns trigger   -- security definer, search_path 收口
create trigger note_links_sync
  after insert or update of content on public.notes
  for each row execute function public.sync_note_links();
```

- 只挂 INSERT / UPDATE OF content（改名/设置变更/软删除不触发）；硬删除走 FK cascade。
- **diff 维护**：对 NEW.content 算期望集 → 删除该来源下不在期望集的边 → `insert ... on conflict do nothing`。
  无变化的保存（期望集 = 现存集）零写入；重复保存幂等，且**不重置已存边的 created_at**（稳定首见时间）。
- 内容为 null → 期望集为空，该来源边清空。
- DELETE 不需要行级清理（cascade）；无需语句级触发器。
- 回退手段：`drop trigger`（forward-fix，符合「不回滚旧迁移」约定）。

### 4.4 读接口 `get_note_backlinks_v2`

```sql
get_note_backlinks_v2(p_note_id uuid, p_page_size int default 100, p_cursor jsonb default null)
returns jsonb  -- { total, rows: [{ id, title, created_at }], next_cursor }
```

- 行形状与 v1 相同（`{id,title,created_at}`）→ 客户端切读只换 RPC 名与游标推进，UI 零改动（行形状见 `backlinks.tsx:11-15`）。
- **稳定游标**：`(s.updated_at desc, s.id desc)` keyset；`p_cursor` 编码为 `{u: updated_at, i: id}`。
  新反链出现插在首页，已翻页结果不受插入/删除影响（OFFSET 在此场景会漂移）。`next_cursor` 为 null 表示取尽。
- `total` 每页返回（同可见性谓词一次 count；索引扫描，千级边成本可忽略）。
- 来源过滤：`join note_links` → `s.deleted_at is null` → `s.id <> p_note_id` → 可见谓词（§3）。
- 参数防御同 v1（page_size 1..200，越界回落 100）。
- v1 保留不删（回退读路径 + 基准对照），头注释标注 deprecated 指向 v2。

## 5. 回填与对账

- **回填**：`rebuild_note_links_batch(p_batch_size int default 500, p_after uuid default null) returns jsonb`
  （service_role 专用：revoke from public/anon/authenticated）。按 `notes.id` keyset 取一批，
  对每行跑与触发器同一套 diff 逻辑（共用提取核心），返回 `{ processed, last_id, remaining_hint }`。
  幂等：重跑零变化；可与线上写入并存（触发器已维护的行 diff 结果不变）。
- **驱动脚本**：`apps/web/scripts/backfill-note-links.mts`（tsx 直跑，循 `backup-restore-drill.mts` 模式，
  service key 从环境变量读、不落日志）。循环批次直至取尽，打印进度，可中断续跑。
- **对账**：`reconcile_note_links(p_batch_size, p_after) returns jsonb`（service_role，只读不写）：
  逐行重算期望集与现存集对比，报告 `{ checked, mismatched, sample: [{ note_id, missing, extra }] }`。
- **切读门槛**：本地全量对账（含千篇来源种子工作负载）连续两轮 `mismatched = 0` 才允许 B03-4 合并。
- **基准比较**（验收「pgTAP + 基准比较」）：`apps/web/scripts/perf/backlinks-bench.mts`（非 CI）——
  种子 1 千来源 × 数千边，同负载下 v1 vs v2 延迟对照，≥3 轮取中位数与范围（循 B02 口径），结果记入账本证据。

## 6. 上线顺序（串行子 PR，每步可独立合并与回退）

| 子 PR | 内容 | 读路径状态 |
|---|---|---|
| B03-1（本 PR） | 本设计文档 + 账本更新 | v1 |
| B03-2 | 迁移 078（表/提取核心/触发器/v2 RPC）+ pgTAP（含越权负例）+ 触发器开销基准 | 仍 v1；新写维护生效，v2 可用但数据未回填 |
| B03-3 | 回填 batch RPC + 驱动脚本 + 对账 RPC + 对账脚本 + 基准对照（v1 vs v2） | 仍 v1；索引数据完整 |
| B03-4 | 客户端切读：`fetchAllNoteBacklinks` 改走 v2 游标循环，**RPC 报错自动回退 v1**（守门窗口）；单测更新；反链面板 E2E 冒烟 | v2 优先，v1 回退 |

- 守门窗口的回退路径在真实环境验证（D01 领卡时登记复核）后由清理 PR 收编（届时才允许 v1 标记删除候选，本计划内不删）。
- 全程：不回滚旧迁移、不改正文存储格式、不改备份 schema（note_links 派生不进导出）。

## 7. 验收对照（卡面原文 → 设计落点）

| 卡面验收 | 落点 |
|---|---|
| 纯文本/外站同路径不误判 | §2 判定 1（站点相对）+ link-mark-only；pgTAP 正/负例 |
| 合法带锚点引用不漏 | §2 判定 2（段提取不含 `?#`）+ 解码；pgTAP 覆盖 `#`/`?`/编码三变体 |
| 千篇来源和大量边分页正确 | pgTAP 种子 1k 来源全量翻页（无重无漏）+ keyset 稳定性用例（翻页中插入新反链不漂移） |
| 撤权不泄露标题/计数 | §3 查询时 `resource_role` 判定；pgTAP：撤成员后 total/rows 同步消失 |
| 归属移交/恢复后正确 | 边内容派生不随移交变；pgTAP：068 移交后可见性切换、restore 路径触发器重建 |
| pgTAP + 基准比较 | `078_note_links_index.test.sql` + `backlinks-bench.mts`（§5） |
| 上线顺序：新写维护→回填→对账→切读；保留临时回退读路径 | §6 串行子 PR 表 |

## 8. 候选决策（需用户拍板，不阻塞 B03-2/3/4 实施）

- **(a) 阅读反链 UI**：表维护 `/library/` 边（服务图谱统一），但本卡不提供「哪些笔记链到这篇文章」的 UI。
  若要，另立小卡（消费 v2 同款 RPC 的 reading 变体）。
- **(b) 图谱切读索引**：`build-graph.ts` 仍客户端全量扫描；统一到索引是独立后续卡。
- **(c) 反链上下文摘要**：现按「元数据而非全文」返回最小集；若产品要锚点上下文摘录，需扩 RPC 返回（涉及来源正文片段的可见性复核，另议）。

## 9. 边界（不做）

- 不删除/不回滚 074 与旧 RPC；不改 `notes.content` 存储格式；不改正文任何写入路径的代码（触发器统一收口）。
- `note_links` 不进备份导出、不进 mock（派生数据；mock 下反链面板维持现状——v1 RPC 本就未实现，面板隐藏）。
- 不给 anon/authenticated 表级权限（RPC 收口）；不做通知/前台行为变化；不动图谱。

## 附录 A：提取核心验证记录（2026-09-13，本地栈 PG17 实测）

正/负例（单条合成文档同时含全部情形）：

| 输入 | 期望 | 实测 |
|---|---|---|
| link mark href=`/notes/{uuid}#sec` | 边（锚点折叠） | ✅ |
| link mark href=`/notes/{uuid}?p=1` | 边（与上同目标去重） | ✅ 合并为 1 条 |
| link mark href=`/notes/{编码段}` | 解码后为合法 uuid 才成边 | ✅（非法形状拒） |
| 纯文本节点含 `/notes/{uuid}` 字样 | 非边 | ✅ |
| code_block 文本含 `/notes/{uuid}` | 非边 | ✅ |
| link mark href=`https://evil.example.com/notes/{uuid}` | 非边 | ✅ |

开销：598KB content（500 段 × 40 汉字 ≈ 20 万字，500 条边）单次提取 **34–36ms**（三轮）；
B02 实测 5 万字保存 88–140ms，触发器增量在最坏样本下 +~20%（常规笔记亚毫秒）。B03-2 基准将以真实样本复核并记录。
