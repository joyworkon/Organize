# PROGRESS：note-page-comments submit 回滚诚实性

执行：Kimi K3Max。基线 master `411dbb5`。

## 2026-10-19

### 1. 分支
- `git pull origin master`：Already up to date（HEAD = 411dbb5）。
- 建分支 `fix/note-page-comments-submit-rollback-honesty`。

### 2. 背景复核（属实）
- **背景 1 属实**：`note-page-comments.tsx:152-156`，`note_comments` insert 失败时回滚
  `delete().eq("id", createdThreadId)` 的结果完全被忽略——error / 0 行（RLS 拒绝）/ 抛异常
  都会静默留下空线程，UI 只显示通用文案且列表不刷新。
- **背景 2 属实**：回滚 `await` 抛异常会覆盖原始 `commentError` 进入 catch（文案相同，
  但回滚失败在语义上被掩盖）。
- **背景 3 属实**：回滚 delete 缺 `.eq("note_id", token.noteId)`（对比 180 行 toggleResolved、
  207 行 deleteThread 均带）。
- **关键行为确认**：`loadThreads()` 开头（51 行）`setDraft(error: "")`，故回滚失败路径必须
  先 `await loadThreads()` 再写具体文案；`loadThreads` 会递增 `loadSeqRef` 使 submit 的
  `isCurrent()` 失效，故 await 后改用 `noteIdRef.current === token.noteId` 判定。

### 3. 修改与单测
- `note-page-comments.tsx` submit 回滚分支（最小改动，未动 toggleResolved/deleteThread/
  loadThreads/草稿与切笔记逻辑）：
  - 回滚链 → `.delete().eq("id", createdThreadId).eq("note_id", token.noteId).select("id")`，
    包在独立 try/catch；`error` / 0 行 / 抛异常均判回滚失败。
  - 回滚成功：`throw commentError` 走原 catch，行为不变（通用文案「评论发送失败，请稍后重试」）。
  - 回滚失败：`isCurrent()` 时先 `await loadThreads()` 刷新列表（loadThreads 开头清
    draft.error，故必须 await 后再写文案；loadThreads 递增 loadSeq 使 token 过期，await 后
    按 `noteIdRef.current === token.noteId` 判定），再写具体文案
    「评论发送失败，且空评论未能撤回，请刷新后处理」，然后 return 不进通用 catch。
  - 草稿文字任何失败均保留（未动成功路径的清空逻辑）。
- `note-page-comments.test.tsx` 新增 describe「NotePageComments 发送回滚诚实性」3 用例：
  1. 评论 insert 失败 + 回滚成功 → 通用文案、草稿保留、不重新加载（并断言回滚 delete 带
     `id` + `note_id` 双过滤）；
  2. 回滚返回 0 行 → 具体文案、触发新一轮加载、草稿保留；
  3. 回滚 reject → 具体文案、无未处理 rejection、草稿保留。

### 4. 本地验证
- `tsc --noEmit`：exit 0。
- `pnpm lint`：exit 0（No ESLint warnings or errors）。
- 定向 `vitest run components/notes/note-page-comments.test.tsx`：11 passed（8 旧 + 3 新）。
- 全量 `vitest run`：exit 0，**2254 passed / 2 skipped**（基线 2251 + 新增 3）。
