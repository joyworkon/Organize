# PROGRESS — 任务工作台与月历

## 目标（≤10 行）
把待办升级为可持久化三栏工作台 + 月历：侧栏(清单/今天/7天/已完成/垃圾桶) +
中栏(列表/看板/月历) + 右详情；日期组件/重复任务/提醒/附件/模板/活动。

## 基线（任务 0 已核验 2026-08-01）
- master=origin=8f4c526
- Vitest 45 文件/374 用例/0 skipped；typecheck 0；db test 10/10

## 已合入 master（PR #65–#69）
- migration 033（5 新表 + tasks 8 扩列 + trigger + RLS + 备份 v3）✅
- 三栏布局 + 侧栏 + 月历视图 + scope 过滤 ✅
- 清单管理（新建/改名/删除）✅
- 日期组件（单日/时间段/全天/重复）✅
- 12 项菜单全部无占位（副本/便签/模板/附件/动态/打印/放弃/链接…）✅
- pgTAP 30 + vitest 408 ✅
- typecheck 0、CI 双 job 全绿 ✅

## 未完成（接续点）
- URL 路由（scope/list/view/month 用 query）
- 月历拖拽改期 + 触屏 + 响应式 390px
- 真浏览器验收 + 截图 + 越权测试
- mock 新表 seed + roadmap 更新

## 最大风险
- 副作用分离（AGENTS.md 红线）已遵守（乐观回滚在 repository）
- 附件上传失败补偿删对象已实现
