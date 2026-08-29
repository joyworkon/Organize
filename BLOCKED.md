# BLOCKED

## P1-01（待合并）
无阻塞。两点声明（非阻塞，冻结语义的一部分）：
1. **去重非原子**：`collectReadingItem` 的去重是「查询 → 插入」两步，极端并发
   （多标签页同时提交同一 URL 的百毫秒窗口）可能产生两行。未加 `(user_id, url)
   WHERE deleted_at IS NULL` 部分唯一索引的原因：restore RPC 对 reading_items 是
   明文 `insert … select`（020，无去重），且历史数据（旧命令面板/批量导入不去重）
   可能已有同 URL 活跃重复行——直接上索引会破坏 P0-04 刚冻结的 v4 备份往返。
   后续如需 DB 收口，须同步给恢复 RPC 加 payload 去重并更新 pgTAP，独立任务处理。
2. **mock 分支的 trash 不真实**：mock 客户端 delete 是硬删，「软删除再保存=新条目」
   的语义在 mock 下由真实分支的 RLS 行为推导，stub 单测覆盖（软删除行排除用例）。

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
