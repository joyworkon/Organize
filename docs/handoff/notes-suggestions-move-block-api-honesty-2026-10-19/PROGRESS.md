# PROGRESS — notes-suggestions-move-block-api-honesty

## 2026-10-19
- [x] 从最新 master（Already up to date）建分支 `fix/notes-suggestions-move-block-api-honesty`。
- [x] 核实现状：suggestions route 回显 `error.message`（GET/POST 500、PATCH 409）、authorize 任意错误伪装 404、非法 JSON 变 500、POST 无类型校验；move-block `String()` 强转、RPC 错误一律 409 回显。
- [x] 核实 RPC `move_note_block`（051 最新定义）主动 raise：`'Source and target notes must be different'` / `'Note not found or access denied'` / `'Block not found'`。
- [x] 核实客户端：`SuggestionDialog` 按数组顺序渲染（无重排），`MoveDialog` 只依赖 `response.ok` + `data.error` → 客户端无需改动；shim `listSuggestions` 由正序改为倒序对齐真实路由。
- [x] 新增 `lib/notes/suggestions-api.ts`：POST/PATCH body 解析（parseJsonBody + 类型校验：blockId 非空字符串、originalBlock/proposedBlock 为对象、suggestionId 非空字符串、status 枚举）、`suggestionNoteRejection`（PGRST116→404）、`suggestionPatchRejection`（PGRST116→409「建议不存在或已处理」，其它→null）。
- [x] 新增 `lib/notes/move-block-api.ts`：body 解析（非字符串/空串/目标即源→400「移动目标无效」，去掉 String() 强转）、`moveBlockRpcRejection`（三条 RPC raise message → 404「笔记不存在或无权限」/ 404「块不存在」/ 400「移动目标无效」，其它→null）。
- [x] 重写两个 route：统一 `serverError`（不再回显 error.message）、authorize 区分 PGRST116 与真实故障。
- [x] 对齐 mock shim：四个 handler 补非对象/类型校验，moveBlock 不存在→404「笔记不存在或无权限」、块不存在→404「块不存在」，listSuggestions 倒序。
- [x] 新增 `suggestions-api.test.ts` / `move-block-api.test.ts`；api-shim.test.ts 更新期望并补对齐用例。目标测试 51 过；tsc / lint 过。
