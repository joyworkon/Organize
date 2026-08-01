# BLOCKED — 任务工作台与月历

## 已完成（feat/task-workspace-calendar 分支，未推 PR）
- 任务0：基线核实 + worktree + PROGRESS
- 任务1：数据底座
  - migration 033（5 新表 + tasks 8 扩列 + 双向 trigger + RLS + 默认清单迁入 + 重复任务 RPC + 备份 v3）✅
  - shared types（6 新接口）+ 备份 schema v3（兼容 v2）+ restore remap ✅
  - task repository（单一数据源 + 乐观更新回滚）✅
  - task sidebar（清单/今天/7天/已完成/垃圾桶 + 计数）✅
- 验证：typecheck 0、test 45/374、db test 10/10、backup 17/17、migration 本地应用成功

## 未完成（接续点）
- 任务2 剩余：三栏主页面重写（现有 tasks/page.tsx 677 行需重构为侧栏+中栏+详情布局）、
  URL 路由（scope/list/view 用 query）、12 项菜单、日期组件、清单管理 UI。
- 任务3：月历视图（周一开头、月切换、跨月灰日、拖拽改期、响应式）。
- 任务4：≥30 vitest + ≥20 pgTAP、真浏览器验收、PR、roadmap 更新。
- mock 新表 seed（lib/supabase/mock-data.ts）。

## 接续指引
- worktree：../Organize-task-workspace-calendar，分支 feat/task-workspace-calendar
- 现有 tasks/page.tsx 未改（仍正常工作），新文件：lib/tasks/repository.ts、
  components/tasks/task-sidebar.tsx
- 接续：先写三栏页面（用 repository + sidebar），再接 12 菜单 + 月历 + 测试

## 无（越界/阻塞项）
无越界需求。剩余纯工作量大，非阻塞。
