# PROGRESS — memos-secondary-load-honesty-2026-10-18

## 步骤 1：分支准备 ✅
- `git checkout master && git pull origin master` → Already up to date，HEAD `76dee59`（#396 已合并，与任务基线一致）。
- 建分支 `fix/memos-secondary-load-honesty`。

## 步骤 2：核对背景 1–3 ✅（基线 76dee59，apps/web/components/library/memos-view.tsx）
1. **属实**（L268–285）：标签计数 effect 里 `fetch("/api/memos/tags")` 后 `if (!res.ok) return;`，非 2xx 时 `tagCounts` 保持 `[]`，L482 `tagCounts.length > 0 &&` 使标签筛选条整条消失，用户会误以为没有标签。
2. **属实**（L284 依赖 `[]`，L275–282 catch）：catch 里的本地统计遍历的 `memos` 是挂载时闭包捕获的初始 `[]`，兜底统计恒为空数组，形同虚设。
3. **属实**（L244–262 深链补取）：404 有 toast（L247–250）；但 L251 `if (!res.ok) return;`（其它非 2xx）与 L259–261 `catch {}`（网络异常）都无任何反馈，深链点了没反应。
- 附带核对：`/api/memos/tags` 路由排序为 `b.count - a.count || a.tag.localeCompare(b.tag)`（数量降序、同数按名称升序），本地兜底函数需与之一致。

## 步骤 3：实现 ✅
- 新增 `apps/web/lib/memos/tag-counts.ts`：`countMemoTagsLocally()`（数量降序、同数 `localeCompare` 升序，与 `/api/memos/tags` 路由一致）+ `MEMO_TAG_COUNTS_FALLBACK_HINT` 常量（"标签统计暂不可用，以下按已加载速记计数"）。
- 新增 `apps/web/lib/memos/tag-counts.test.ts`：6 个用例（空数组 / 计数与降序 / 同数按名称 / 中文标签 / null·undefined 跳过 / 常量非空）。
  - 首轮 2 个断言失败：一是我漏数一个 c（期望值写错）；二是中英混排同数标签的 `localeCompare` 顺序依赖宿主默认 locale（macOS 与 CI Linux 可能不同），改为跨环境稳定断言（ASCII 同数比较、中文用数量区分），函数本身不动。
- `apps/web/components/library/memos-view.tsx` 薄改：
  - 标签计数：原 `tagCounts` state 拆为 `serverTagCounts` + `tagCountsFallback`；`!res.ok` 与 `catch` 都置降级；派生 `tagCounts = useMemo(fallback ? countMemoTagsLocally(memos) : serverTagCounts)`（依赖 memos，修掉旧 catch 闭包捕获初始 `[]` 的问题）；删掉不再需要的 `eslint-disable`。降级且计数非空时标签条首行显示提示小字（`w-full text-xs text-muted-foreground`），本地为空时维持不显示标签条。
  - 深链补取：非 404 非 2xx 与网络异常都 `toast({ title: "无法定位该速记", description: "加载失败，请稍后重试", variant: "destructive" })`；404 分支不变。
- 未动：`/api/memos*` 路由、`lib/memos/tags.ts`、主列表/加载更多/保存·编辑·删除·转笔记逻辑、e2e、`globals.css`。

## 步骤 4：本地验证 ✅
- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → **2016 passed / 2 skipped**（基线 2010 passed / 2 skipped，+6）

## 步骤 5：提交 / PR / CI
（进行中）
