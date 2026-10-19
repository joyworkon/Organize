# TASK — collections-digest-api-honesty（2026-10-19）

执行 Agent：Codex（gpt-6.1-sol，普通修复 + 补测试）。分支：`fix/collections-digest-api-honesty`。基线：master `a251c32`（#455）。

## 背景（规划者初查，执行前请自己复核属实再改）
文件：`apps/web/app/api/collections/[id]/digest/route.ts`（POST 生成整理稿）。
1. 来源加载（reading / memo / file 三分支，以及 file 分支里按 `reading_item_id` 再查 reading_items）都用 `maybeSingle()` 且**忽略 error**：DB 出错会被伪装成 400「来源不存在或不可访问」（或 file 分支静默当成"无正文"）。
2. 幂等查询 `existing`（`urn:organize:digest:${key}`）忽略 error：DB 出错时会误判为"无既有稿"，继续调用 AI 并可能重复生成。
3. 落库失败分支 `insertError?.message` 原样回显给客户端（500）——泄露 DB message。
4. `request.json()` 解析成功但 body 不是对象（如 `null`、数组、数字）时，`body.sourceType` 会抛 TypeError → 未处理 500。
5. 预算 `assertDigestBudget` 的 catch：`DigestBudgetError` → 413 用自家文案没问题；**非 DigestBudgetError 的未知错误**现在把 `error.message` 以 400 回显——应改为 serverError（500，不泄露）。请先看 `lib/collections/digest-server.ts` 确认它会抛哪些错误。
6. AI 生成失败 502 + `redactSecret(...)`：保持现状不动（provider 报错已脱敏，属于有意设计）。
7. 溯源 `digest_sources` upsert 失败按注释"不影响整理稿本体"——保持不阻断，但可 `console.error` 记录（不改响应）。

## 要做
1. `git checkout master && git pull`，建分支 `fix/collections-digest-api-honesty`。
2. 先 rg 调用方 `components/collections/digest-preview-dialog.tsx`，确认它只看 `res.ok` + `data.error`（默认零客户端改动）。
3. 新增 `apps/web/lib/collections/digest-api.ts` 纯函数（命名自定，参考同目录 `items-api.ts` 风格），例如：
   - 解析 body：非对象 → 400「请求格式无效」。
   - 分类来源查询结果 `{ data, error }`：error → serverError；无行 → 400「来源不存在或不可访问」；有行 → ok。
   - 分类幂等查询：error → serverError（不调用 AI）；有行 → reused；无行 → 继续。
   - 分类预算错误：DigestBudgetError → 413 原文案；其它 → serverError。
   - 落库失败 → serverError（文案可保留「整理稿保存失败（AI 已生成，可重试复用）」，但**不得**含 DB message）。
   用 `@/lib/api/error` 的 `serverError`（看 items 路由用法）。
4. 路由接线上述各处，行为契约外的逻辑不动。
5. 新增 `digest-api.test.ts` 覆盖以上分支。
6. 本地：`tsc`、`lint`、`vitest` 全过（基线约 2454 passed / 2 skipped）。

## 不做
- 不改 schema/RLS/迁移、`digest-server.ts` 的生成逻辑、其它 collections 路由、library、imports、e2e、globals.css；不新增依赖；mock shim 仅在必须对齐时才动。

## 完成定义
PR 开出 → CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿 → `gh pr merge --squash --delete-branch` → 切回 master 并同步 → 本地 PROGRESS.md 写最终状态。
