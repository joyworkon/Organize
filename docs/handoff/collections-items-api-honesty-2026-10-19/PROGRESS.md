# PROGRESS — collections-items-api-honesty

## 2026-10-19
- [x] 任务已派给 Kimi K3Max，待开始。
- [x] 基线确认：master `0b0458e`（#454），已建分支 `fix/collections-items-api-honesty`。
- [x] 背景复核（全部属实）：
  - route.ts POST upsert error 非 23503 分支原样回显 `error.message`（500）——属实。
  - POST 集合存在校验 `maybeSingle()` 忽略 `error`，DB 错被伪装成 404——属实。
  - DELETE 幂等 `{ success: true }`，error 已走 serverError——属实，保持不动。
  - GET 已 serverError；cursor 文案来自本仓库解码器，不动。
  - 调用方：`add-to-collection-dialog.tsx`（POST）、`collections-view.tsx`（GET/DELETE）只看 `res.ok` + `data.error` toast，零客户端改动。
  - mock shim（`api-shim-collections.ts`）已模拟 23503→400 与 404 路径，未模拟任意 DB 错误；本次真实路由改动不影响 shim 行为契约，shim 不改。
- [x] 实现：新增 `lib/collections/items-api.ts`（`classifyCollectionItemUpsertError` / `classifyCollectionExistsQuery` 纯函数）+ `items-api.test.ts`；route POST 接线两处。
