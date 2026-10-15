---
name: Cairn Focused Workspace
version: "1.0.0"
colors:
  primary: "#202020"
  on-primary: "#ffffff"
  background: "#ffffff"
  sidebar: "#f9f9f9"
  text-secondary: "#626262"
typography:
  body:
    fontFamily: '"MiSans VF", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 22px
    fontWeight: 400
rounded:
  control: 8px
  composer: 16px
spacing:
  unit: 4px
  content: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
---
# Cairn 设计合同

状态：2026-10-15 设计提案；覆盖网页、Tauri 桌面与手机。正式应用尚未整体接入。`docs/design/tokens.json` 为全量数值源；本文件为行为与组合合同；`page-specs.md` 为路由验收；`preview/index.html` 为离线交互样稿。冲突时先遵守数据/权限/保存合同，再按本合同改观感。禁止把预览脚本移入生产。

## Overview

借鉴 Codex 的安静工作区、稳定侧栏、局部工具与输入面：黑白灰建立层级，正文拥有最多空间，操作在需要的位置出现。Cairn 保留“资料 → 笔记 → 行动”的知识工具身份，AI 通过整理、摘要、推荐等局部动作参与；首页不改造成聊天会话流。品牌名称为 Cairn。

本方案没有读取本机 Codex 窗口，也没有取得 Codex 内部设计 token。下面所有精确颜色、尺寸、断点均为 Cairn 提案，不能称作 Codex 像素复刻。公开 Apps SDK UI 是 ChatGPT 组件参考，不能当作 Codex 原生客户端规格。中性灰取向参考其开源基础色；不引入该库，不替换现有 Radix/shadcn 原语。

## Colors

三层背景：内容 `background`、导航 `sidebar`、需独立承载的 `surface`。列表通常直接放内容底，不在每个区段外画卡片。`border` 只分组，不作为唯一的控件识别；需可见轮廓的输入/复选框用 `controlBorder`。hover 与选中均中性灰。primary 是中性实色动作，link 仅用于正文链接；功能图标默认继承正文色。错误/警告/成功必须配文字或图形，不只靠颜色。

| token | 浅色 | 暗色 | 对比度：浅色/白底；暗色/surface |
|---|---|---|---|
| text | #202020 | #eeeeee | 16.29 / 13.88 |
| secondary | #626262 | #b0b0b0 | 6.10 / 7.42 |
| muted | #666666 | #a3a3a3 | 5.74 / 6.38 |
| link | #245d9b | #99c4f1 | 6.74 / 8.83 |
| success | #246345 | #8dd1a8 | 7.13 / 9.06 |
| warning | #895300 | #e7bf77 | 6.36 / 9.29 |
| danger | #b42318 | #ffa79e | 6.57 / 8.64 |

背景/表面/hover/selected/border 的完整值见 JSON。小字至少 4.5:1，大字与信息性图形至少 3:1；禁用项允许减弱但需真实 disabled，不能伪装成普通可用内容。不要在 muted 上继续叠 opacity。选中态除灰底另用字重、勾选、`aria-current` 或 `aria-selected`。焦点线 `focus` 2px + 3px offset，对相邻表面≥3:1；不用弱阴影独立承担焦点。

## Typography

UI 优先现有本地 MiSans VF，其次系统中文字体。预览不请求网络字体；本机没有 MiSans 时使用系统 fallback。正文14/22、标签13/20、元信息12/18、页标题20/28 semibold、文档标题32/42 semibold、文档正文16/29。UI weight 默认400；低于400仅在验证字形清晰且保持对比后使用。标题不做大写或宽字距，中文不加负字距；长标题按词/汉字自然换行。

手机输入框至少16px防止自动放大，文档正文维持16px。用户选择的笔记 serif/mono/small-font、阅读字体与全宽是最高优先级，不被全局字体更新重置；默认视觉不是强制覆盖。serif 中文 fallback 用“Songti SC / SimSun”，mono 中文仍可回退中文 sans。金额、时长、日期对齐处用 tabular-nums；代码单独用 mono。

## Layout

沿用壳断点768px（≤767手机），不新增彼此矛盾的设备判断。1200px只决定任务/评论等辅面能否并排，不改变手机导航分类。桌面侧栏232px，折叠56px；顶栏52px，详情操作行44px。标准泳道最大1088px、居中，桌面左右40px、窄桌面24px；手机16px。文档默认正文760px；它是阅读/编辑行长，不是全站列表新泳道。1088标准与现有全宽文档容器共存，目录/高亮固定坐标沿用原锚点。

间距以4px单位，主节奏8/16/24/32/48。行高紧凑40、常规56；文章带摘要可72–88。桌面控件视觉32px，图标16px；粗指针与手机点击区至少44×44px，可在32px图形外扩热区。列表标题与metadata区分，列按内容对齐，不用每一行不同的标签/彩色图标抢层级。列表密度不挤压阅读与编辑正文。

手机采用顶部菜单、当前页面标题与新建动作，主要导航收进抽屉；不保留现有五入口常驻底栏。资料库内用五类tab切换，速记仍定位资料库对应tab。底部只承载当前阅读、编辑、速记流程需要的工具，首页使用全宽composer。所有旧入口均从抽屉、功能tab或命令面板可达。详情页保持稳定返回，恢复原筛选和滚动。小屏左右辅面使用全屏sheet或二级页面，禁止正文被两侧面板挤至窄列。桌面原生壳只增加拖拽空白区，不吞掉按钮点击、选择文字或浏览器键位。

## Elevation & Depth

页面、列表、侧栏、编辑器无常态阴影。Popover使用JSON popover阴影，dialog用dialog阴影；一个浮层只一层阴影。菜单/对话框暗色仍用surface与border建立边界。遮罩35%黑即可，禁止大面积模糊背景导致内容上下文消失。

## Shapes

控件8px、独立资料面12px、composer16px、dialog16px。标签6px或小胶囊，仅标签/状态可胶囊化；不要给每条导航项或每行数据套厚胶囊。角形状渐进增强遵循现有 `corner-shape` 兼容层，回退普通圆角不能改变几何。卡片须代表可独立操作对象或画布内容，不代表每个标题下面的普通段落。

## Components

| 组件 | 合同 |
|---|---|
| 导航 | 当前项灰底+文字加重；常态图标单色。一级入口与真实sidebar保持一致。笔记树、资料标签、任务子导航复用当前折叠/拖动逻辑；树展开与跳转为两个目标。条件共享入口继续按可见性出现。底部保留个人区和设置，不把插件重新提升一级。 |
| 页头/工具行 | PageHeader唯一功能页标题；标题+本功能搜索+一个主动作。详情头为返回/面包屑、同步状态、更多。同一可视任务区通常一个显著实心主动作（独立区域与确认步骤可分别有动作，不机械按整页计数）；不可把导航tab做实心主动作。筛选/排序/视图在同一工具行；小屏允许独立横滚，不能裁按钮。 |
| 列表/表格 | 行hover只变底色；标题为链接，其余点击不冒充跳转。更多按钮支持focus-within显示，触屏常显；批量选择用显式复选框。表头含排序语义，aria-sort；窄屏隐藏低优先级列，仍可在详情看，复杂表格横滚且标题列稳定。 |
| 搜索 | PageSearch仅搜当前功能，⌘/Ctrl K跨功能。输入后显示查询命中/清空；空查询恢复原顺序，零结果给清除筛选。异步结果不抢焦点，旧结果保留并标更新中；搜索无结果与无数据为空库分开。 |
| composer/表单 | 输入区16px圆角；正文输入占主要面积，下沿类型/附件/提交。保存链接仍复用collectReadingItem。标签在输入旁，不用placeholder替代label。帮助/错误紧贴字段，aria-describedby；错误保留已填值。密码/AI key不回显，成功状态使用服务端结果。 |
| 笔记编辑 | 无常驻大工具栏、无正文边框。保留TipTap结构、blockId、拖动/列/表格/resize DOM与浮层定位锚点。选区BubbleMenu、斜线命令和块按钮渐进显示；触屏有显式插入/更多入口，键盘可操作。标题与正文同轴，属性行紧凑。保存状态来自会话，不由视觉定时器假定成功。 |
| 阅读/整理稿 | 文章来源、阅读状态、原文入口可见；阅读文本760px默认。高亮/目录桌面侧面板，手机sheet。整理稿明确标为用户/AI生成的派生内容，原文可切回；生成中可取消，失败保留原文，保存与笔记写入沿用现有合同。 |
| 任务 | 复选框、标题、日期、清单/优先级，优先级只作小标记。完成可撤销，不依赖飘动画。详情≥1200并排，较窄全屏，焦点回原任务；子任务/依赖关系仍可达。日历窄屏默认议程，月视图可选；倒数日数字不是营销海报。 |
| 画布 | 画布独享全宽，工具浮于边缘，比例/缩放清晰。保留canvas store、命中测试、patch CAS与源状态。手机只读预览：常显“手机预览”，提供缩放/适应画布/对象详情，禁止出现可编辑假把手。 |
| 标签 | 中性底小标签，语义由文字承担；自定义色只在标签自身使用且检测对比。移除按钮44px点击区；多标签截断后“+N”，展开可访问全部。不要借标签做导航主按钮。 |
| 弹层/菜单 | 生产复用现有Dialog/Dropdown/Popover/Command；菜单包含危险项时分隔并置末。确认框说明对象、影响、可恢复性；焦点默认非破坏动作。Escape关闭最上层、恢复触发器焦点。Modal focus trap、背景inert；嵌套弹层按现有Radix边界处理。 |
| 历史/评论/共享 | 历史预览显示版本时间与恢复入口；恢复需确认且不直接覆盖未保存稿。评论以锚点关联，手机sheet。viewer只读提示在头部，隐藏修改性主动作；授权/移交仅owner显示，UI隐藏不是权限校验。 |

状态统一：loading先固定几何骨架，超过400ms显示“正在加载”，重复请求不闪白；首空库给一个创建入口，筛选空结果给清除条件；错误保留已有内容和重试动作。toast用于短反馈，需处理的错误留在现场。离线默认提示“离线 · 尚未同步”，每篇显示待同步；仅本机持久化已确认时可提示“更改保存在此设备”，本机写入失败必须持续报错并提供复制/导出；只在服务端确认后“已保存”。冲突为持续提示+比较/复制本地/载入远端，禁止自动将任一版本判为成功。实时协作不可用按现有逻辑降级，提示一次不循环打扰。readonly既禁止编辑也保留复制/查阅/允许的导出。

键盘：Tab顺序=导航→页头→工具→内容；focus-visible始终可见。tablist方向键+Home/End、单一tab stop；菜单方向键/Enter/Escape遵循Radix。快捷键统一use-hotkey，输入区不触发g序列；IME `isComposing` 或keyCode229期间Enter不能提交/保存/跳页。只有明确的新建表单可用⌘Enter提交。选区工具不要夺走正文选区。

移动：使用100dvh/visualViewport并沿用mobileKeyboardOpen判定；键盘打开隐藏底栏，输入和提交按钮始终在可视区域。顶部/底部用env(safe-area-inset-*)，吸底composer不可遮挡最后一段和焦点；不把viewport resize误判为pinch zoom。drawer关闭回到菜单触发器，跨路由关闭；手机文本可长按选择、双指缩放画布，不能全站禁止touch-action。

动效：hover100ms、浮层160ms，最多200ms。只动画opacity/少量translate；不对编辑器/画布坐标祖先加transform；列表排序不使用会改变拖动坐标的动画。prefers-reduced-motion为0ms，无自动旋转/闪烁、无连续背景运动。

## Do’s and Don’ts

每次改动先查 `docs/ui-change-guide.md` 的真实责任路径，再查本合同与路由规格。保持URL、角色、保存状态、用户偏好、离线合同；一次只迁移一个责任层。现有图标从 `@/components/icons` 使用，不增加emoji或新图标库。不要营销hero、装饰性渐变、重复KPI卡、每段套框或把AI放进所有按钮。

## Sources

下列均在2026-10-15实际读取；引用只限定为方向与组织方法，参数为本项目提案。

- [OpenAI：Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)：工作区组织、上下文连续性；非内部token来源。
- [OpenAI：Plugins UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)：组件、主题适配参考；适用ChatGPT插件，不声称适用原生Codex全部界面。
- [OpenAI Apps SDK UI](https://github.com/openai/apps-sdk-ui)：已读README及src/styles/variables-primitive.css与variables-semantic.css；参考中性色与语义层，不引入React/Tailwind新依赖。
- [Google Labs DESIGN.md](https://github.com/google-labs-code/design.md)：已读README，参考机器数值+文字理由并存的文档方式。本项目JSON自有schema，不冒称通过其alpha CLI校验。
- 本仓已读：AGENTS.md、docs/ui-change-guide.md、globals.css、use-theme-color.ts、sidebar.tsx、lib/navigation/mobile.ts、library/page.tsx、dashboard-hub.tsx、notes/[id]/page.tsx。现状优先于旧注释：当前主题实际浅蓝底+红primary；导航为资料库融合结构。
