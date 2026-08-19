# PROGRESS — 任务工作台与月历

## 2026-08-19 笔记+待办集中修复（PR #77–#97，共 21 个 PR 合入 master）

对照 Notion/滴答清单逐项体验 + 代码审查出 50 条问题，按"丢数据 > 名存实亡 > 体验"分三批修完：

- 第一批（丢数据类，#77–#82）：导出/分享/拷贝丢公式与附件（latex 属性名 + fileAttachment 序列化）、斜杠命令误删整段已有文字（只删触发符 range）、重复任务完成不生成下一次实例（四个完成入口接线 complete_recurring_task）、任务日期清除被 trigger 回填复活（035：显式清除全清语义）、月历拖拽范围任务整段平移（不再违反 check 约束）、到期提醒三类误报（setTimeout 24.8 天溢出/改期不再提醒/全天任务早晨误报过期）
- 第二批（名存实亡，#83–#88）：删除/恢复后侧栏幽灵节点（mutateTrash 广播变更事件）、清单改名/删除接线（原来不可达）、版本历史去重失效改为 60 秒时间节流（036）、月历跨天任务连续条形（周行布局+泳道+折叠 +N）、死按钮清理（排序/更多/任务属性/添加评论/桌面关闭按钮）、数据库块失败不再污染正文 + 加载可重试
- 第三批（体验对齐，#89–#97）：封面隐形按钮误触（pointer-events 双保险）、置顶立即重排（sortNotesLocal）、任务搜索空态、/tasks 跳转闪烁、路径栏块不刷新（meta 事务强制 NodeView 刷新）、笔记全文搜索（037：search_text 生成列 + trigram GIN，列表页+命令面板搜正文）、页内菜单补齐历史/导出/删除 + 修恢复覆盖竞态、优先级旗标+筛选+内联可改、22 处 window.prompt/alert → 全局 showPrompt 对话框/toast、待办列表拖拽排序（组内 sort_order 归一 + 乐观回滚）、触屏点按块显示手柄

migration 035/036/037 已合入并应用；pgTAP 48 条、vitest 492 条全绿。

## 目标（≤10 行）
把待办升级为可持久化三栏工作台 + 月历：侧栏(清单/今天/7天/已完成/垃圾桶) +
中栏(列表/看板/月历) + 右详情；日期组件/重复任务/提醒/附件/模板/活动。

## 已合入 master（PR #65–#73，共 9 个 PR）
- migration 033（5 新表 + tasks 8 扩列 + trigger + RLS + 备份 v3）✅
- 三栏布局 + 侧栏 + 月历视图 + scope 过滤 ✅
- 清单管理（新建/改名/删除）✅
- 日期组件（单日/时间段/全天/重复）✅
- 12 项菜单全部无占位 ✅
- 附件上传（storage + 失败补偿删对象）+ 任务动态 ✅
- URL 路由（scope/list/view query）✅
- 月历拖拽改期（保留时长/墙钟 + 回滚）✅
- 响应式 390px 手机布局（侧栏抽屉）✅
- pgTAP 30 + vitest 408 ✅

## 最终验证序列（2026-08-02 全过）
- test：48 文件 / 408 用例 / 0 FAIL
- typecheck：exit 0
- build：✓ Compiled successfully
- migration list：001-033 对齐
- db tests：30/30 PASS
- git diff --check：exit 0

## 红→绿反向验证证据（DB 层实测 2026-08-02）
1. 跨用户 RLS：用户 B 读 A 的 task_lists → count=0（红：被拒）；A 读自己 → count=1（绿：通过）。
2. 非法结束时间：schedule_end < start → check_violation 被拒（红）；合法范围 → 接受（绿）。
3. 重复任务幂等：同一 task done 后调 complete_recurring_task 两次 → 第二次返回 null（pgTAP #65 断言覆盖）。
4. 提醒 ≤3：第 4 条 insert → 23514 被拒（pgTAP 覆盖）。
5. 上传失败补偿：前端代码实现（元数据写失败→删 storage 对象），pgTAP 覆盖 task_attachments RLS。

## 触屏日期面板
触屏设备：拖拽不可用（HTML5 DnD 不支持触屏），改为点任务→打开 TaskDialog 选日期（onTaskClick 路径已实现）。
点日期→onDateClick 回调（预填新建）。这满足"触屏走日期面板"要求。

## mock 新表 seed
lib/supabase/mock-data.ts 加 task_lists（工作/学习/生活默认清单）+ task_reminders/attachments/activities/templates 空数组。

## 未完成
- 真浏览器验收（1440×900 + 390×844）+ 截图 → 执行 agent 无浏览器，需人工操作
- 本地两名临时用户验越权 → DB 层 RLS 已验证（红→绿），但未做完整双账号端到端

- mock 新表 seed → 后续
