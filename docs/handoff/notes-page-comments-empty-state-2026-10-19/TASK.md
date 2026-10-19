# 任务：笔记页「页面评论」补空状态（与块评论弹层对齐）

> 执行 Agent：Codex（ChatGPT App CLI 0.163，模型 gpt-6.1-sol）
> 难度：小（空状态文案 + 既有样式复用 + 1–2 条组件测试）；不要扩到 API/加载诚实性。

仓库：`/Users/k/Documents/ZCode/Organize`，基线 master（刚合并 collections-digest `#456` / `e577090`，以 `git pull` 后的最新 master 为准）。

## 当前问题（用户可感知）

笔记编辑页底部的「页面评论」面板（`note-page-comments.tsx`）在**加载完成且 threads 为空**时，标题下直接是空白，只有输入框。
同模块里的块评论弹层（`editor-dialogs.tsx`）已经有：

```tsx
{!loading && !loadError && threads.length === 0 && <div className="editor-dialog-empty">还没有评论</div>}
```

两边空态不一致：用户打开页面评论时不知道「这里可以评论、目前还没有」，只能猜。

另：评论输入框 `<textarea>` 无 `aria-label`（发送按钮已有），读屏不清晰。

## 目标行为

1. 当 `!loading` 且非「加载失败占位」且 `threads.length === 0` 时，在评论列表区域显示与弹层一致的空态文案 **「还没有评论」**（可用现有 `.editor-dialog-empty`，或在 `.note-page-comments` 下加等价 token 样式：`color: hsl(var(--muted-foreground))`，居中/适度内边距）。
2. 有评论、加载中、加载失败（已有错误条 + 重试）时，空态**不**出现。
3. 给评论 `textarea` 补 `aria-label="写下评论"`（或等价中文），不改 placeholder 语义。
4. **不要**改评论 API、发送/解决/删除逻辑、线程数据结构、权限门控。

## 建议改动文件

- `apps/web/components/notes/note-page-comments.tsx`（主改）
- `apps/web/components/notes/note-page-comments.test.tsx`（补空态 / aria 断言）
- 仅当复用 class 不够时才动 `apps/web/app/globals.css`（优先复用 `.editor-dialog-empty`，避免新一套空态样式）

## 验收标准

- [ ] 无评论且加载完成：可见「还没有评论」；composer 仍可用。
- [ ] 有评论：不显示该空态。
- [ ] 加载中 / 加载失败：不显示「还没有评论」伪装成功空列表。
- [ ] textarea 有可访问名称。
- [ ] `tsc` / lint / vitest 通过；新增或扩展单测覆盖空态分支。
- [ ] 不改 e2e 选择器语义；若已有依赖「页面评论」结构的测试文案，按需更新断言而非删断言。

## 约束（必须遵守）

- 只用现有设计 token / 共享组件；不引入新 UI 库。
- 不为排版重建 editor 实例；不在 editor/canvas 祖先加 `transform` / `contain`。
- 不改 `blockId` / document JSON / revision / queue / role RPC / ydoc 保存顺序。
- 不改评论 mutation API、RLS、DB schema。
- 本任务**不是** API/loading honesty；不要顺手改 fetch 错误分流。
- 保持现有 e2e data-testid / 可访问名稳定；更新测试而非删除覆盖。

## 完成定义

本地 tsc + lint + vitest 绿 → 开 PR → CI 五项全绿 → squash merge → 切回 master。PROGRESS.md 只留本地不提交；开 PR 后不再推 docs-only/PROGRESS 提交。
