# PROGRESS — 任务工作台与月历（feat/task-workspace-calendar）

## 目标（≤10 行）
把待办升级为可持久化三栏工作台 + 月历：侧栏(清单/今天/7天/已完成/垃圾桶) +
中栏(列表/看板/月历) + 右详情；日期组件/重复任务/提醒/附件/模板/活动。
工作目录：../Organize-task-workspace-calendar (独立 worktree)。

## 基线（任务 0 已核验 2026-08-01）
- master=origin=8f4c526；worktree feat/task-workspace-calendar 基于此
- Vitest 45 文件/374 用例/0 skipped；typecheck 0；build 通过；db test 10/10
- 迁移 001–032 对齐

## 阶段
1. 数据底座：migration 033（task_lists/reminders/attachments/activities/templates + tasks 扩列 + trigger + RLS + 备份v3 + mock）
2. 工作台：侧栏/URL路由/列表/看板/详情 + 12项菜单 + 日期组件
3. 月历 + 响应式 + 拖拽改期
4. 测试(≥30 vitest→≥404 总 / ≥20 pgTAP→≥30 总) + 验收 + PR

## 最大风险
- 旧 due_date ↔ 新 schedule 双向 trigger 不能破坏现有任务数据
- work/study/life 自动迁入默认清单的迁移要幂等可重入
- 备份 v2→v3 兼容 + 新外键重映射，不能丢旧数据
- 副作用分离（AGENTS.md 红线）：乐观更新回滚 + 副作用不进 setState updater

## 进度
- [x] 任务0：基线核实 + worktree + PROGRESS
- [x] 任务1：数据底座（migration 033 + types + 备份 v3 + restore）—— db test 26/26
- [~] 任务2：工作台
  - [x] repository（单一数据源 + 乐观回滚）
  - [x] sidebar（清单/今天/7天/已完成/垃圾桶 + 计数）
  - [x] 三栏布局接入 tasks/page.tsx（侧栏 + scope 过滤）—— 零回归
  - [ ] 12 项菜单、日期组件、清单管理 UI、URL 路由
- [~] 任务3：月历
  - [x] TaskMonthView（周一开头、月切换、跨月灰日、按清单色、+N）—— typecheck 0、test 不变
  - [ ] 拖拽改期、触屏日期面板、响应式
- [~] 任务4：测试
  - [x] pgTAP 16 断言（033_task_workspace.test.sql）—— db test 26/26 全绿
  - [ ] ≥30 vitest（repository/month-view/sidebar）、浏览器验收、PR、roadmap
- [ ] 任务4：验证交付
