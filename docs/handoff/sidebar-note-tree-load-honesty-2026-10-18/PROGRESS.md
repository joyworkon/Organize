# 执行进度：侧边栏笔记树加载诚实化（fix/sidebar-note-tree-load-honesty）

## 步骤 1：同步 master + 建分支 ✅
- `git pull origin master` → Already up to date，HEAD = `f5f8020`（与任务基线一致）。
- `git checkout -b fix/sidebar-note-tree-load-honesty`。

## 步骤 2：核对背景 1–3 ✅（全部属实，基线 f5f8020）
1. **加载函数吞错**（`apps/web/components/layout/sidebar.tsx:171-199`）：`const { data } = await supabase.from("notes").select("id, title, icon, parent_note_id, updated_at, is_pinned")...` 只解构 `data` 丢 `error`；失败时 `data` 为 null → `buildNoteTree((data || []).map(...))` → `setNoteTree([])`，树被覆盖为空。属实。
2. **渲染撒谎**（`sidebar.tsx:650-664`）：仅 `notesLoading && noteTree.length === 0` 显示「加载笔记...」，否则渲染 `SidebarGroupedNotes nodes={noteTree}`；空树最终落到 `SidebarNoteTree` 的 `emptyText = "还没有笔记"`（默认值在 872 行，空态渲染在 968-969 行）。失败时用户看到「还没有笔记」。属实。
3. **调用点**（`sidebar.tsx:201-212`）：`notesExpanded` effect（含 pathname 依赖）与 `organize:notes-changed` 事件监听调用 `loadNoteTree`。这些调用点保持不改。属实。
- e2e 检查：`apps/web/e2e` 下 grep「还没有笔记 / 加载笔记」无匹配，无 e2e 断言依赖侧边栏空态文案；且成功路径的空态文案不变，不受影响。

## 步骤 3：新增纯函数 + 单测，改 sidebar.tsx 接线 ✅
- 新增 `apps/web/lib/layout/sidebar-note-tree-load.ts`（目录新建）：
  - `SidebarNoteRow`（行形状，`is_pinned?: boolean | null`）、`SidebarNoteItem`（映射后喂 buildNoteTree）；
  - `nextSidebarNoteTreeAfterLoad({ previous, data, error })` → `{ rows, loadError }`：成功 → `(data ?? [])` 行内映射完全一致（含 `is_pinned: !!is_pinned`）、清错；失败 → `rows = previous`（同引用；null=从未成功）+ `SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE`（"笔记加载失败"）。
- 新增 `apps/web/lib/layout/sidebar-note-tree-load.test.ts`：5 个用例（成功映射含空串/null 标题与 is_pinned 缺省、data null→空数组、失败有 previous→同引用+文案、失败 previous null→rows null、失败后再成功恢复）。
- `apps/web/components/layout/sidebar.tsx` 薄改（仅 loadNoteTree 内部 + 笔记树区域渲染）：
  - 新增 `noteTreeError` state 与 `lastNoteRowsRef`（记住上次成功 rows）；`loadNoteTree` 解构 `{ data, error }` 走纯函数：成功才 `setNoteTree(buildNoteTree(rows))` 并记 ref、清错；失败不覆盖 noteTree，只 `setNoteTreeError`。
  - 渲染三分支：加载中且树空 → 「加载笔记...」（不变）；`noteTreeError` 且树空 → 错误行（`text-sm text-muted-foreground` + `role="alert"`）+「重试」按钮（调 `loadNoteTree()`）；否则旧树（若有）+ 树下方同一错误行。调用点/事件监听/其它侧栏区块未动，`globals.css` 未动。

## 步骤 4：本地验证 ✅
- `corepack pnpm -C apps/web exec tsc --noEmit` → 退出码 0。
- `corepack pnpm -C apps/web lint` → 退出码 0，No ESLint warnings or errors。
- `corepack pnpm -C apps/web exec vitest run` → 退出码 0，**2029 passed / 2 skipped**（基线 2024/2 → +5，与新增 5 用例一致）。未跑 e2e（按约束）。


