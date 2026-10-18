# 执行进度：稍后读状态分段计数加载诚实处理（fix/reading-stats-load-honesty）

## 步骤 1：同步 master + 建分支 ✅

- `git checkout master && git pull origin master`：Already up to date，HEAD = `80218b7`（与任务基线一致）。
- `git checkout -b fix/reading-stats-load-honesty` 完成。

## 步骤 2：核对背景 1–4（基线 80218b7，apps/web/components/library/reading-view.tsx）✅ 全部属实

1. **计数查询吞错**：`fetchStats`（reading-view.tsx:314-330）`const { data } = await supabase.from("reading_items").select("reading_status").eq("user_id", user.id);` 只取 `data` 丢 `error`，`const all = data || [];` 后直接 `setStats(...)`——查询失败时四个计数全被覆盖成 0，伪装成「一篇都没有」。
2. **初始 state 是假 0**：reading-view.tsx:187 `useState({ total: 0, unread: 0, reading: 0, read: 0 })`，首次加载失败时 0 同样是假数字。
3. **计数显示位置**：reading-view.tsx:626-634，四个分段按钮内 `<span className="ml-1.5 text-xs text-muted-foreground">` 按 tab.value 显示 stats.total/unread/reading/read。
4. **fetchStats 调用点**（不改）：reading-view.tsx:359（refreshTick effect）、399（updateStatus）、408/424（deleteItem/撤销恢复）、512（batchUpdateStatus）、543（batchDelete）。

结论：问题存在且未被修过，按任务继续。

## 步骤 3：新增 lib/reading/stats-load.ts + 单测，接线 reading-view.tsx ✅

- `apps/web/lib/reading/stats-load.ts` 新增（与 list-load.ts 同构风格）：
  - `READING_STATS_LOAD_ERROR_MESSAGE = "计数加载失败"`；
  - `ReadingStats { total; unread; reading; read }`；
  - `countReadingStats(rows)`：单遍计数，未知/null 状态只计入 total（与旧 filter 语义一致）；
  - `nextReadingStatsAfterLoad({ previous, data, error })`：成功 → 重新计数 + 清错；失败 → stats 保留 previous 同引用（null 表示从未成功）、statsError 用 error.message 去空白非空值否则常量。
- `apps/web/lib/reading/stats-load.test.ts` 新增 8 个用例（countReadingStats 3 个：空数组全 0 / 各状态计数 / 未知与 null 只计 total；nextReadingStatsAfterLoad 5 个：成功重数清错 / 失败保留 previous 同引用 + 错误文案 / 失败且 previous=null → stats=null + 常量 / error.message 空白用常量 / data 为 null 无 error 也按失败）。任务要求至少 4 个，超额覆盖。
- `reading-view.tsx` 薄改 4 处（调用点 359/399/408/424/512/543 未动）：
  1. 新增 import（stats-load 的纯函数 + type）；
  2. `stats` state 改 `ReadingStats | null` 初值 null + 新增 `statsError` state（原 187 行处）；
  3. 新增 `statsRef`（镜像 itemsRef 模式：fetchStats 闭包取 previous，避免把 stats 加进 deps 造成 effect 重复拉取）；
  4. `fetchStats` 解构 `{ data, error }` 走 `nextReadingStatsAfterLoad` 落状态；
  5. 分段计数 span：`stats === null` 显示 `"—"`；span 加 `title={statsError ?? undefined}`；工具行后新增一行 `text-xs text-muted-foreground` 的 statsError 小字提示（role="status"，无 toast 无重试按钮，纯 Tailwind 不动 globals.css）。
- e2e 依赖核查：e2e 目录无任何对状态分段按钮（role=button, aria-pressed）计数文字的断言；`getByRole("tab", { name: "全部" })` 命中的是页级 tab（role=tab），与本改动无关；a11y 门是 axe 规则型（button-name/color-contrast），分段按钮有文字标签、span 类不变，不受「—」影响。未改任何 e2e 文件。

## 步骤 4：本地验证（仓库根目录）✅

- `corepack pnpm -C apps/web exec tsc --noEmit`：exit 0。
- `corepack pnpm -C apps/web lint`：No ESLint warnings or errors。
- `corepack pnpm -C apps/web exec vitest run`：exit 0，**Test Files 266 passed | 1 skipped (267)，Tests 2024 passed | 2 skipped (2026)**——基线 2016 passed / 2 skipped，+8 恰为本任务新增用例数。
  - 输出中 `Error: Not implemented: window.focus` 来自 lib/platform/notifications-click.test.ts 的既有 jsdom 噪音，非失败（该文件 passed）。
- e2e 未在本地跑（按任务约束）；未发现 e2e 对分段计数初始为 0 的依赖（见步骤 3 核查）。

## 步骤 5：提交 → push → PR → CI → 合并

（进行中）


