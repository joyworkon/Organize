# PROGRESS — 全局任务 ↔ 笔记待办双链 + P0 收口

## 目标（≤10 行）
让 Organize 全局任务(tasks 表)与笔记待办(taskItem 块)形成可靠双链;
收口已确认 P0 缺陷(假成功/软删除 RLS/Embed sandbox/CI/警告)。串行跑 G0–G4。

## 基线（任务 0 已核验，2026-07-31）
- master @ 3b08e46，与远端同步、干净、无他人改动
- pnpm test → 43 文件 / 361 用例 / 0 skipped
- pnpm typecheck → 0 错误；build 通过(9 警告，G4 清)

## 执行顺序
G0 协议冻结(文档) → G1 数据底座(migration+RPC+测试) → G2 编辑器同步(默认关闭) → G3 产品闭环(双标签页验收后启用) → G4 P0 收口
每阶段独立分支 feat/gN-* → PR → squash 合并 → 删分支。

## 进度
- [x] G0 ✅ PR#47(协议文档)
- [x] G1 ✅ PR#48(030/031 migration + 原子保存 RPC + 10 例 pgTAP)
- [~] G2 部分 ✅ PR#49(taskId 属性)+ PR#50(source 标记 + 开关);剩余 Realtime/多引用待续
- [x] G4-1 ✅ PR#51(Embed sandbox 安全 + 假成功修复)
- [x] G4-2 ✅ PR#52(CI 加 production build + supabase pgTAP db test,两 job 都绿)
- [x] G4-3 ✅ PR#53(清 9 警告 → 0 + 路线图 P1/P2 登记)
- [~] G2 剩余(①RPC 接入#55 ②legacy 激活[本 PR]；③Realtime 订阅/多引用·移动·拆分待续)
- [ ] G3(代码可做,启用阻塞于浏览器双标签页验收)
- [ ] G4 剩余(软删除走 mutate_trash RPC 一致性)

## 架构关键事实（影响设计）
- 编辑器 autosave 直连 Supabase(page.tsx flushSave，900ms 防抖，绕过 API)；6 条写入口+2 条 DB 侧(move_note_block RPC / save_note_version 触发器)
- TaskItem 是官方 @tiptap/extension-task-item，只有 checked 属性，无 taskId；笔记 todo 与全局 tasks 表完全独立(零连接)
- 无 /api/tasks 路由(全客户端直连 Supabase)；tasks.note_id 是 1:1 单向链接
- CI 只跑 typecheck+test，无 build/db test(G4 补)

## 最大风险
- 编辑器 autosave 绕过 API：双链同步要么改 flushSave 走 RPC，要么靠 DB 触发器(后者覆盖全部写入口更稳)
- 历史无 taskId 的 taskItem 仅在用户真实改字/勾选后激活——区分 user-edit 与 hydrate 是 G2 难点
- 原子保存 RPC 要在事务内锁行+幂等+回收 orphan 任务，并发场景易错
