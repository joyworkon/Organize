# 任务：构思画布列表空态/失败态对齐共享 EmptyState

> 执行 Agent：Codex（ChatGPT App CLI 0.163，模型 gpt-6-luna）
> 难度：小（列表页视觉统一 + 既有 EmptyState 复用）；不要扩到 API/加载诚实性逻辑，也不要改画布编辑器。

仓库：`/Users/k/Documents/ZCode/Organize`，基线 master（刚合并 notes-page-comments-empty-state `#457` / `2cc66e1`，以 `git pull` 后的最新 master 为准）。

## 当前问题（用户可感知）

`/canvas` 构思画布列表在**成功加载且列表为空**时，用自定义 `.canvas-list-empty` 只显示两行字 + 按钮，没有与其它主列表页一致的图标空态。

同产品里笔记列表、待办、收藏、倒数日、标签等已统一用 `EmptyState`（大图标 + h2 标题 + 描述 + CTA）。画布列表看起来像「半成品缺省页」，和其它入口不一致。

加载失败且无快照时，画布页也是自制 `flex` 错误块，而收藏/笔记/倒数日已是 `EmptyState` +「重试」。

## 目标行为

1. **成功空列表**（`items.length === 0` 且无 `loadError`）：改用共享 `EmptyState`：
   - `icon`：`LayoutTemplate`（或仓库 icons 中等价的画布/版式图标）
   - `title`：保持 **「还没有画布」**
   - `description`：保留现有引导文案（或等价一句）：把想法写下来 / 双击空白开始等
   - `action`：`新建构思画布` 按钮（调用现有 `create`，creating 时 disabled + 可保留 Loader2）
2. **加载失败且无可用快照**（`items === null && loadError`，或 `items.length === 0 && loadError`）：改用 `EmptyState`，title 可用 `CANVAS_LIST_LOAD_ERROR_MESSAGE`（「画布列表加载失败」），description 可省略或简短说明，action 为「重试」（现有 `retry`）。
3. **有列表快照时的行内失败条**（`loadError && items.length > 0`）保持现状即可，不必强行 EmptyState。
4. **加载中**保持现有「加载中…」即可。
5. **不要**改 `list-load.ts` 裁决语义、repository、创建/重命名/复制/删除、toast 时机。
6. 顶栏「构思画布」标题 + 右上角「新建构思画布」可保留；不必本次强行改 `PageHeader`（若顺手且 diff 很小可改，非必须）。
7. e2e 依赖 `getByRole("button", { name: "新建构思画布" })`——空态 CTA 与顶栏按钮文案必须仍含 **「新建构思画布」**，`.first()` 仍可用。

## 建议改动文件

- `apps/web/app/(main)/canvas/page.tsx`（主改：引入 EmptyState + icon，替换空态/无快照错误块）
- 可选：若 `.canvas-list-empty` 已无引用，可从 `apps/web/app/globals.css` 删掉该规则；无引用残留也可先留着，避免大段 CSS 噪音
- 测试：`apps/web/lib/canvas/list-load.test.ts` 必须继续绿；若便于加，可给 page 抽极小展示组件再测，**非必须**——不要为测而大重构

## 验收标准

- [ ] 空库成功加载：可见带图标的「还没有画布」EmptyState +「新建构思画布」可点。
- [ ] 加载失败无快照：EmptyState 错误态 +「重试」，**不**显示「还没有画布」。
- [ ] 有快照时失败：仍保留列表 + 行内提示 + 重试。
- [ ] 加载中不冒充空态。
- [ ] e2e 可访问名「新建构思画布」仍在。
- [ ] `tsc` / lint / vitest 通过；不改 list-load 行为。

## 约束（必须遵守）

- 只用现有设计 token / 共享组件（`EmptyState`、`Button`、`@/components/icons`）；不引入新 UI 库。
- 不改画布编辑器、viewport、命中测试、CAS、拖动；不在 canvas 祖先加 `transform` / `contain`。
- 不改 `blockId` / document JSON / revision / queue / RPC / ydoc。
- 本任务**不是** API/loading honesty；不要顺手改 `listCanvases` / `nextCanvasItemsAfterLoad`。
- 保持现有 e2e 选择器与按钮名稳定。

## 完成定义

本地 tsc + lint + vitest 绿 → 开 PR → CI 五项全绿 → squash merge → 切回 master。PROGRESS.md 只留本地不提交；开 PR 后不再推 docs-only/PROGRESS 提交。
