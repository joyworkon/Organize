# PROGRESS — canvas-patch-cas-honesty-2026-10-19

执行：Kimi K3Max。分支 `fix/canvas-patch-cas-honesty`，基线 master `583adae`。

## 背景核对（逐条复核 TASK.md 1–4，全部属实）

1. **CAS 失效，属实**。`lib/canvas/repository.ts:104-111` `patchCanvas` 直接
   `JSON.stringify(payload)`，键名是驼峰 `expectedRevision`；真实路由
   `app/api/canvases/[id]/route.ts:88-91` 与 shim `lib/mock/api-shim.ts:961-964`
   只读 `body.expected_revision` → 永远 null → RPC 走无条件覆盖分支，409 冲突
   恢复从不触发。全仓 `rg "expectedRevision"` 核对：除 canvas repository/autosave/
   调用方外，无其它发驼峰键的调用方（synced-block-sync.ts、public-share-editor.tsx
   均发下划线 `expected_revision`）。**决策：客户端映射为下划线发送**，路由/shim
   继续只读 `expected_revision`，单一键名不歧义（与同步区块下划线约定一致）。
2. **只改内容清空标题，属实**。路由 `:62` `typeof body.title === "string" ? … : ""`
   且无条件 `p_title: title`；085 RPC `set title = p_title`。
   `add-to-canvas-dialog.tsx:239-242` 调 `patchCanvas(id, { content, expectedRevision })`
   不带 title → 真实后端标题被清空；shim `:975` title 缺省保留原标题（mock 看不出）。
3. **非法 JSON 静默改名为空，属实**。路由 `:61` `.catch(() => ({}))` → `{}` →
   content undefined 走「仅改名」+ title "" → 清空标题并 200。
4. **泄露数据库报错，属实**。PATCH `:99-101` 与 DELETE `:149-151` 均
   `{ error: error.message }, 500`。`lib/api/error.ts` 的 `serverError` 未映射
   22023（只映射 23505/23503/42501/22P02），故 RPC 入参错误（22023）在路由内
   单独判 code → 400，其余走 `serverError` → 500 通用文案。

调用方清单（PATCH 全部经 `patchCanvas`，无旁路 fetch）：
- `app/(main)/canvas/page.tsx:87` 改名 `{ title, expectedRevision }`（revision 来自
  刚 `getCanvas` 的行，正常）；
- `components/canvas/canvas-workspace.tsx:286-290` autosave 恒带 title+content+
  expectedRevision（`state.revision`）；
- `components/library/add-to-canvas-dialog.tsx:239` 追加内容 `{ content,
  expectedRevision }` 不带 title；
三个调用方都不发空 PATCH，「title 与 content 都缺 → 400」不影响正常流程。

e2e 核对：`e2e/canvas-editing.spec.ts:168-193` 只拦截 PATCH 加延迟并计数，
**未断言请求体键名** → 无需改 e2e。

## 修改清单

1. `apps/web/lib/canvas/api-mutation.ts`（新建，纯函数，route 与 shim 共用）：
   - `parseJsonBody(request)`：非法 JSON / 空体 / 顶层非对象 → 400「请求格式错误」；
   - `validateCanvasPatchBody(body, options)`：非对象 → 400；title 提供了但非字符串 →
     400「画布标题格式错误」（字符串截断 200，与既有行为一致）；content 提供了 →
     `validateCanvasContent`（v1→v2 迁移），失败 → 400「画布内容校验失败」+ errors；
     title/content 都缺 → 400「没有可更新的内容」；expected_revision 非数字 → null，
     数字取整（语义不变）。
2. `apps/web/lib/canvas/repository.ts` `patchCanvas`：显式构造请求体
   `{ title?, content?, expected_revision }`——下划线键名，缺省字段不发送
   （CAS 真正生效 + title 缺省不再触发清空）。
3. `apps/web/app/api/canvases/[id]/route.ts`：
   - PATCH 改用 `parseJsonBody` + `validateCanvasPatchBody`（400 不调 RPC）；
   - title 或 content 缺省时先读当前行（`select title, content`）补齐缺省侧——
     title 缺省保留原标题，content 缺省即「仅改名」；CAS 仍在 RPC 内原子生效，
     补齐读与写之间的并发写会被 CAS 判 409，不会静默覆盖；
   - RPC 错误：code 22023（入参不合法）→ 400「请求格式错误」，其余 → `serverError`
     （不再泄露 message；`lib/api/error.ts` 未映射 22023，故在路由内判 code）；
   - DELETE `mutate_trash` 错误 → `serverError`；
   - 200 / 409 / 404 / 400（内容校验含 errors）响应形状不变。
4. `apps/web/lib/mock/api-shim.ts` `patchCanvasShim`：复用 `validateCanvasPatchBody`
   （`allowMockImages: true`），400 形状与路由一致；404 → CAS 409 → 写入顺序不变；
   title 缺省保留原标题。shim dispatch 层的「非法 JSON 字符串 → JSON.parse 抛错 →
   500」是所有 shim 路由共用的既有行为（synced-block 亦同），不在本任务范围。
5. 单测：
   - `lib/canvas/api-mutation.test.ts`（新建，11 例）：parseJsonBody 合法/非法/空/
     非对象；validateCanvasPatchBody 各分支（非对象、缺省、非字符串 title、空 PATCH、
     非法 content、expected_revision 归一化、title 截断）。
   - `lib/canvas/repository.test.ts`（新建，9 例）：请求体键名 `expected_revision`
     无驼峰键、缺省字段不发送；200/409(含缺 current)/404/401/400/网络错误映射。
   - `lib/mock/api-shim.test.ts`（+6 例）：过期 expected_revision → 409 + current.revision
     且内容不覆盖；CAS 命中后旧 revision 即冲突；不带 title 的 PATCH 标题不变；
     空 PATCH → 400；非字符串 title / 非对象 body → 400；非法 content → 400 带
     errors；不存在 id → 404。

## 调用方核对（修好 CAS 后）

- autosave（`canvas-workspace.tsx:283-309` + `lib/canvas/autosave.ts`）：保存成功
  `markSaved(outcome.revision)` 更新 `state.revision`（`canvas-store.ts:278-281`），
  下一次 schedule 用新 revision；保存期间的编辑以 `expectedRevision: outcome.revision`
  串行补发（`autosave.ts:102`）；409 → paused + conflict UI + `resume()` 重基。
  CAS 生效后链路闭环，无误报冲突路径（同页内 revision 恒单调跟随服务端确认值）。
- 改名（`app/(main)/canvas/page.tsx:81-92`）：改名单独先 `getCanvas` 取最新 revision
  再 PATCH；极端并发下 409 →  toast 失败，诚实不静默。
- 追加到画布（`add-to-canvas-dialog.tsx:222-250`）：先 `getCanvas` 再带
  expectedRevision PATCH；409 → 「画布已被其他改动更新，请重试」。title 缺省不再被
  清空（本任务修复点）。
- e2e：`canvas-editing.spec.ts` 拦截 PATCH 只加延迟/计数，未断言请求体键名 → 未改。

## 验证记录

- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（无警告无错误）
- `corepack pnpm -C apps/web exec vitest run` → exit 0，**2363 passed / 2 skipped**
  （基线 2337 passed / 2 skipped，+26 = api-mutation 11 + repository 9 + api-shim 6）
- 未本地跑 e2e（按要求）。

## PR / CI

（待填）
