# 任务：构思画布键盘快捷键补齐（全选 / 复制 / 缩放 / 适合全部）+ 快捷键速查面板

> 执行 Agent：Codex（ChatGPT App CLI 0.163，模型 **gpt-6.1-sol**；若键盘事件与编辑态/输入框冲突反复翻车，写 HANDOFF 建议换 **gpt-6-astra**）
> 难度：中（只在既有 window keydown 分支里加快捷键，复用既有 store 命令与 zoomToFit；加一个用共享 Dialog 的速查面板）
> 规划：Organize 接力看护 / 五狗；方向：笔记 / **构思画布** / 日历 UX（用户可感知的交互补齐）

仓库：`/Users/k/Documents/ZCode/Organize`。基线：master（`150af52` / 合并 #462 calendar-month-pointer-drag-unity，以 `git pull` 后最新为准）。只做下面这一件事，不要扩大范围。

## 现状问题（用户能感受到）

`/canvas/[id]` 桌面编辑：已有 撤销/重做（⌘/Ctrl+Z、⇧⌘Z）、Esc 取消选择、Delete/Backspace 删除、方向键微移、空格/中键拖拽平移、⌘/Ctrl+滚轮缩放、框选与 Shift 多选。但常用画布快捷键缺口明显：

- **⌘/Ctrl+A** 没有「选中当前画布所有模块」——会落到浏览器全选页面文字（蓝色一片），体验很怪。
- **⌘/Ctrl+D** 不能复制选中模块（复制只能去属性栏点按钮，`duplicateBlock` 已存在）。
- **⌘/Ctrl+= / ⌘/Ctrl+-** 会触发浏览器整页缩放，而不是画布缩放；**⌘/Ctrl+0** 不是「画布回到 100%」；没有「适合全部」快捷键（只能点右下角按钮）。
- 用户无从得知有哪些快捷键：缩放控件按钮 title 不带快捷键提示，也没有速查面板。

## 目标行为

在 `apps/web/components/canvas/canvas-workspace.tsx` 现有 `onKeyDown`（约 L390–455，window capture 监听）中补齐，**全部遵守现有守卫**：`isTypingTarget(e)` 时不接管（除既有的画布 textarea 撤销特例）、`editingBlockId` / `readOnly` / `previewMode` 时不接管编辑类快捷键、`hasOpenDialog()` 时让位、IME 组合中（`isComposing` / keyCode 229）不触发。

1. **⌘/Ctrl+A**：`preventDefault`，选中当前画布全部可多选的模块（`{ kind: "blocks", blockIds }`）。规则参考 `use-canvas-pointer.ts` 的框选/Shift 多选产生的 `blocks` 选择与 `selectIds`；若多选有页面(board)约束，则选「当前选中/最近活动页面」的全部模块（`lastActiveTarget` 或选中对象所在 board），没有可选模块就 no-op。只读/预览模式也可全选（只是选中，不改数据）——若现有 store 在 readOnly 下禁止选择，则保持禁止并 no-op。
2. **⌘/Ctrl+D**：`preventDefault`，选中单个模块时 `apply("复制模块", duplicateBlock)`；多选时一次 `apply("复制多个模块", ...)` 依次复制每个（一次撤销即可回退全部），复制后选中新副本（若命令返回的 selection 只有最后一个，可接受；能选中全部副本更好）。选中 board/region/free 时：region 可复用 `duplicateRegion`；board/free 若无现成命令则 no-op，**不要新增数据结构**。只读/预览/编辑中不触发。
3. **⌘/Ctrl+= 与 ⌘/Ctrl++ / ⌘/Ctrl+-**：`preventDefault`，以**可视视口中心**为锚点缩放（×1.2 / ÷1.2，经 `clampZoom`），与右下角「放大/缩小」按钮行为一致（按钮现在只改 zoom 不保持中心——顺手让按钮也围绕视口中心缩放，抽一个共享函数，两处共用）。
4. **⌘/Ctrl+0**：画布回到 100%（围绕视口中心）。**⇧1（Shift+1）**：适合全部，复用「适合全部」按钮同一段 `zoomToFit` 逻辑（抽成函数共用）。
5. **?（Shift+/）**：打开「键盘快捷键」速查对话框，使用共享 `components/ui/dialog.tsx`，列出：撤销/重做、全选、复制、删除、取消选择、方向键微移（Shift 加大步长）、空格拖拽平移、⌘滚轮缩放、放大/缩小/100%/适合全部、? 打开本面板。Mac 显示 ⌘/⇧，非 Mac 显示 Ctrl/Shift（`navigator.platform`/`userAgentData` 简单判断即可，SSR 安全）。用现有 token（`text-muted-foreground`、`kbd` 风格用现有 class 或 Tailwind 小圆角边框，不新增 UI 库）。
6. **可发现性**：缩放控件按钮 `title` 补快捷键提示（如「放大（⌘=）」「缩小（⌘-）」「重置为 100%（⌘0）」「适合全部（⇧1）」），`aria-label` 保持原文不变（e2e 依赖）。可在缩放组末尾加一个「键盘快捷键」小图标按钮（ghost icon，`aria-label="键盘快捷键"`，lucide `Keyboard` 图标）打开同一面板。
7. 手机窄屏（只读）不显示快捷键按钮也可以；快捷键本身在只读时只保留缩放/适合全部/全选/速查。

## 要改的文件（预期）

- `apps/web/components/canvas/canvas-workspace.tsx`（keydown 分支、缩放按钮、速查对话框挂载）
- 可新建 `apps/web/components/canvas/canvas-shortcuts.ts`（纯函数：快捷键匹配 `matchCanvasShortcut(e) → action | null`、平台修饰键标签、围绕中心缩放计算）+ `canvas-shortcuts.test.ts`
- 可新建 `apps/web/components/canvas/canvas-shortcuts-dialog.tsx`（共享 Dialog）
- 必要时 `canvas-viewport.tsx` 导出围绕点缩放的纯计算（不要改 wheel/gesture/pan 行为）
- `apps/web/lib/canvas/commands.ts` 仅当多块复制需要一个组合 helper 时可加纯函数（不改既有命令语义）+ 单测

## 验收标准

- 单测：快捷键匹配（Mac meta / 其它 ctrl、`=`/`+`/`-`/`0`/`a`/`d`/`?`/Shift+1、IME 组合与输入框目标不匹配）、围绕中心缩放保持中心世界坐标不变、多块复制一次撤销回退（若加了 helper）。
- 现有 vitest 全绿；tsc、lint 全绿；`e2e/canvas*.spec.ts` 依赖的 aria-label/文案不变。
- PR 描述写清：新增哪些快捷键、速查面板入口、缩放按钮改为围绕中心。

## 禁止范围

- 不改 blockId / document JSON / revision / CAS / autosave / 队列顺序；不改命中测试与坐标换算；不在画布祖先加 transform/contain。
- 不新增 UI/快捷键库（不要引入 hotkeys 类依赖）；不改 wheel/触控板手势与空格平移逻辑。
- 不做复制粘贴到系统剪贴板、不做对齐/吸附、不做 board/free 新复制命令。
- 不做笔记/日历；不做 API/加载诚实性。
