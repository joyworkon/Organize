# 可直接复制的接手提示词

请接手 Organize 项目的资料库逐功能检查与修复。仓库 `/Users/k/Documents/ZCode/Organize`，当前分支 `fix/library-interaction-audit`，交接 HEAD `70cdb390af58e1464f2abe103904120037b40644`。

先完整阅读 `docs/handoff/library-2026-10-16/HANDOFF.md`、`SOL-STATUS.md`（若存在）和 artifacts 中的报告，再读 AGENTS.md、DESIGN.md 及设计接入记录。先核对 git status、当前 HEAD 与额度，保留交接文件和用户改动，不要直接切分支覆盖。上一 Agent 因五小时额度只剩2%交接，资料库产品补丁尚未应用，所有修复和验证均待你审查完成。

目标：修好五视图 tab 键盘/手机交互、文件与集合顶部搜索、账号切换隔离、统一输入保存失败保稿及旧异步动作隔离。候选 Luna tabs/search patch 已保存在交接 artifacts，仅通过 apply-check；审查 Sol 的实际产物，继续未完成部分。搜索范围应如实标明已加载文件/集合，保留分页；单个始终挂载的 tabpanel 更便于维护 ARIA。不要把上一轮工作台测试结果当作本轮通过。

我已授权按难度分配模型：简单修补用 GPT-6 Luna，实现用 GPT-6.1 Sol，复杂异步/权限审查用 GPT-6 Astra，每次实际使用时告诉我。继续完成代码、必要回归、隔离 mock 构建、浏览器手机/桌面检查、截图与报告，然后走当前特性分支 PR，全部 CI 通过后 squash 合并并清理。保留画布布局、用户内容色板、现有保存/权限合同；稍后读保存继续走 collectReadingItem。不要干扰3000用户服务或3200旧预览。

额度规则以后持续生效：开始、大批执行前和阶段末查额度；任一窗口剩约5%提前准备，约3%完成交接文档及可复制提示词并收尾；准确记录未完成项，不自动兑换重置。先告诉我读取到的当前状态，再直接继续已授权工作。
