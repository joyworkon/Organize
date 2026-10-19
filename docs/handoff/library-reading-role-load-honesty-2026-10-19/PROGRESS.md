# PROGRESS：library reading_item resource_role 加载诚实性

- [2026-10-19] 同步 master（HEAD f526992，与基线一致），建分支 `fix/library-reading-role-load-honesty`。
- [2026-10-19] 背景 1 核实**属实**：`app/(main)/library/[id]/page.tsx:328-332` 非属主分支 `const { data: role } = await supabase.rpc("resource_role", ...)` 只取 data、忽略 error、无 try/catch——RPC 失败静默兜底 viewer 并传给 ResourceShareDialog 伪装「仅查看」，抛错则是未处理 promise rejection。需要修。
- [2026-10-19] 新增 `apps/web/lib/share/resource-role-load.ts`（`RESOURCE_ROLE_LOAD_ERROR_MESSAGE` + `resolveResourceRole`）与 `resource-role-load.test.ts`（9 个用例：owner/editor/viewer 成功原样、error 真值、data null、data undefined、非法字符串、error 为异常对象、文案常量）。定向 vitest：9 passed。
- [2026-10-19] 页面接线完成：新增 `readingRoleUnverified` / `roleLoadAttempt` state，角色 effect 读 error + try/catch 经 `resolveResourceRole` 收敛并依赖 `roleLoadAttempt`；新增 `retryLoadReadingRole`（递增计数）；`ResourceShareDialog` 传 `roleUnverified` / `onRetryRole`，`myRole={readingRole ?? "owner"}` 保持不变。移除不再使用的 `isCollabRole` 导入。
- [2026-10-19] `resource-share-dialog.tsx` 新增可选 props `roleUnverified` / `onRetryRole`；为真时在 DialogDescription 下方渲染 `role="alert"` 提示行（RESOURCE_ROLE_LOAD_ERROR_MESSAGE + 「重试」按钮），为假/未传渲染不变。其它调用点（notes/[id]）不传新 prop，不受影响。
- [2026-10-19] 本地验证：tsc --noEmit 退出码 0；next lint 无警告无错误（退出码 0）；vitest run 全量 2232 passed / 2 skipped（基线 2223 + 新增 9，全部通过；退出码 0）。
