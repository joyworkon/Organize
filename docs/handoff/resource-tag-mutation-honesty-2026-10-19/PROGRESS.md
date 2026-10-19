# PROGRESS

- 2026-10-19 规划写入 TASK.md / PROMPT.md（五狗），派给 Kimi K3Max。
- 2026-10-19 Kimi K3Max 接手。master 同步至 16eafe2（#443，已是最新），建分支 fix/resource-tag-mutation-honesty。
- 2026-10-19 复核背景 1–4 均属实：
  1. addTag 非 mock：`res.ok === false` 时函数直接落到末尾，既不回滚乐观标签也无 toast（use-tags.ts 296–306 旧代码）。
  2. removeTag 非 mock：DELETE 后从不检查 `res.ok`，失败照样更新 lastSuccessRef（旧 331–332）。
  3. 两处 catch 只静默回滚，无可见提示。
  4. mock：removeTag 忽略 `.delete()` 的 error；addTag mock 失败（mockResolveAndLink → undefined）静默回滚无提示。
- 2026-10-19 实现：新增 `apps/web/lib/tags/resource-tag-mutation.ts` 纯函数（`readAddTagMutation` / `addTagMutationFromMock` / `removeTagMutationFromResponse` / `removeTagMutationFromMock`）；use-tags.ts 的 addTag 四类失败（!res.ok / 缺 tag_id / 异常 / mock undefined）统一回滚乐观标签 + destructive toast「添加标签失败，已回滚」并返回 undefined；removeTag 检查 res.ok 与 mock error，失败回滚快照 + destructive toast「移除标签失败，已回滚」且不更新 lastSuccessRef；成功路径行为不变。新增 `resource-tag-mutation.test.ts` 11 条用例。
- 2026-10-19 本地验证全绿：tsc --noEmit exit 0；lint exit 0；vitest run exit 0，2277 passed / 2 skipped（基线 2266 + 新增 11）。
