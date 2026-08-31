# BLOCKED

## P5-01（已完成，2026-08-31）
无阻塞。三点声明归档：
1. 本机 `supabase test db` 里 **059_task_atomic_update 恒定失败**
   （`permission denied for table task_mutations`）是既有环境漂移：本机 `postgres` 角色非
   超管，而 059 只 GRANT 了 `select, insert`。CI 全新库同文件绿，故 063 的断言刻意不依赖
   表级 GRANT 的错误文案，改断「数据有没有变」。
2. **上游文档前提为假**：`docs/collaboration-plan.md` 称「038 预留 `notes.last_edit_by`
   列位」，实测 `notes` 无该列、迁移全文无此名。Stage 0 的 PR3（065 保存 RPC v2）因此
   多出「加列 + 备份合同 v4 字段清单 + mock seed + 回归测试」一整块工作，不能按计划原文
   「顺便写一下」。
3. 三张新表不进备份合同 v4、业务行属主不转移（只做控制面转移），均为本原型刻意的最小
   边界，已登记 P5-02。

## P1-01（已完成，2026-08-29，PR #180）
无阻塞。已知限制归档：
1. 去重两步（查询→插入）非原子，极端并发窗口可能重复；未加部分唯一索引的原因是
   020 恢复 RPC 明文插入 + 历史重复行会破坏 v4 备份往返，DB 收口须连恢复 RPC 一起改
2. mock 分支 delete 为硬删，软删除语义由真实分支 RLS 推导 + stub 单测覆盖

## P1-02（待合并）
无阻塞。一点声明：**经验复习功能整体移除而非修复**——lessons 表无 next_review_at
列（012），原「待复习」数据源不存在；是否引入复习算法是产品决策（P1-02 卡面原文），
未来若引入需先加正式 schema（迁移 + RLS + GRANT + 备份合同 + mock 同步）。

# BLOCKED — 任务工作台与月历（历史）

## P0-04（已完成，2026-08-29，PR #179）
无阻塞。遗留声明归档：
1. 附件/图片文件本体不在备份内（仅元数据）——UI 清单已明示，文件级打包属后续增强
2. mock 后端：restore-section 的恢复走 /api/backup/restore（服务端路由，mock 下不可用）；
   预检（inspect）为纯客户端逻辑两种模式均可用
3. 继承：1 个 moderate（uuid，TipTap 锚定不可达，随 P2-01）
# BLOCKED

## P0-03（已完成，见 PROGRESS）
无阻塞。两点设计记录（非阻塞）：
1. mock 后端模式下 user_ai_settings 走浏览器内存 client（RLS/表权限收回只在真实
   后端有意义），SSRF 校验在应用层对两种模式一致生效
2. AI 功能本体（实际调 OpenAI 兼容端点）在 mock 下依旧不可用——P0-03 的验收是
   安防层单测覆盖，不依赖真实 AI 调用

# BLOCKED — 任务工作台与月历（历史）

## P0-02（已完成，2026-08-29，见下）
无阻塞。两点环境说明（非阻塞）：
1. 本机无 Docker/Supabase CLI，pgTAP 验证由 PR 的 CI db-test job 实跑（迁移 001–056 + 全部测试文件）
2. 继承自 P0-01 的 1 个 moderate（uuid，TipTap 锚定、不可达）不变，随 P2-01 处理

# BLOCKED — 任务工作台与月历（历史）

## P0-01（已完成，2026-08-29）
无阻塞。基线数字与任务书完全一致并全部达成。遗留（非阻塞）：1 个 moderate（uuid，TipTap 锚定不可升级，实测仅 v4 用法、公告影响 v3/v5/v6——不可达），登记随 P2-01 TipTap 升级决策一并处理。

# BLOCKED — 任务工作台与月历（历史）

## 已合入 master（#65–#74）
全部功能 + 测试 + 文档。详见 PROGRESS.md。

## 最终验证序列全过（2026-08-02）
test 48/408、typecheck 0、build ✓、db test 30/30、migration 001-033、git diff --check 0。

## 红→绿反向验证证据（DB 层实测）
1. 跨用户 RLS：B→A 的清单 count=0（红），A→自己 count=1（绿）。
2. 非法结束时间：check_violation 拒绝（红），合法接受（绿）。
3. 重复任务幂等：二次调 RPC 返回 null（pgTAP 覆盖）。
4. 提醒≤3：第 4 条被拒 23514（pgTAP 覆盖）。
5. 上传补偿：前端实现元数据失败删 storage 对象。

## 本分支补的缺口
- mock 新表 seed（task_lists 等）✅
- 触屏日期面板说明（点任务→Dialog 选日期）✅
- 红→绿证据写入 PROGRESS.md ✅

## 未完成（执行 agent 固有限制）
- 真浏览器验收截图：无浏览器，需人工。代码已就绪，功能经自动测试验证。
- 双账号端到端越权：DB 层 RLS 红→绿已验证，但未做完整浏览器双账号。

## 无（越界项）
无。
