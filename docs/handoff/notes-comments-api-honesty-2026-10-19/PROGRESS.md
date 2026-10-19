# PROGRESS notes-comments-api-honesty

## 2026-10-19 实现完成（待验证）

- 分支 `fix/notes-comments-api-honesty`（基于最新 master，pull 时 Already up to date）。
- 核实结论：TASK.md 六项问题全部属实；客户端 `editor-dialogs.tsx` 的 mutate 对非 ok 响应只显示 `data.error` 再 reload，不依赖幂等成功 → DELETE/PATCH 404 安全，客户端无需改动。
- 新增 `apps/web/lib/notes/comments-api.ts` 纯函数：parse POST/PATCH/DELETE 请求体（非法 JSON/非对象 → 400 请求格式错误；blockId/body 非字符串 → 400 评论内容无效；threadId 提供但非字符串 / PATCH 字段类型错 → 400 请求格式错误；PATCH/DELETE 无目标 → 400 无效操作）；PGRST116 分类（noteContext/threadLookup/commentPatch/threadPatch → 404）；DELETE 0 行分类（commentDelete/threadDelete → 404）。
- 新增 `apps/web/lib/notes/comments-api.test.ts`（vitest，覆盖 TASK 第 2–6 项各分支）。
- 重写 `app/api/notes/[id]/comments/route.ts`：所有 Supabase 错误走 `serverError`（不泄露 message）；getContext 区分 PGRST116（404）与其它（500）；PATCH 0 行 → 404；DELETE 改 `.delete().select("id")` 按删行数判 0 行 → 404；正常路径语义不变（GET 嵌套正序、POST 201、建线程失败回滚线程）。
- 对齐 `lib/mock/api-shim.ts`：dispatch 非法 JSON → 400 请求格式错误（不再 500 回显 message）；comments 三 handler 非对象 body → 400、字段类型校验、PATCH 目标不存在 500→404、DELETE 0 行 → 404。
- DELETE 0 行按 TASK 首选方案处理为 404：经核对客户端（editor-dialogs mutate）不依赖幂等成功，失败会展示错误文案，故无需保留假成功。
