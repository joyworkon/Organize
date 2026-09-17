# Cairn 设计系统落地自检（2026-09-17）

起因：用户反馈「为什么好多都没有遵循 `TraeWork Copy` 这个设计系统的规范？之前不是改过了吗？还是说没改完？而且图标也没有用这个规范的图标，还是之前的老图标。」

结论：**改过，但只改了半层。** 前十步 Cairn 改版把「颜色 / 圆角 / 阴影 / 版式节奏 / 页头与工具行结构」对齐到了 TraeWork，
但**图标资产一次都没有换过**，一直是 `lucide-react`。图标是界面上出现频次最高的元素（侧栏、工具行、卡片、菜单里到处都是），
所以即使 token 全对了，观感上仍然「像旧的」。本次（第十一步）把这一层补上。

## 1. 前十步实际覆盖了什么（PR #299–#311）

| 步 | PR | 覆盖层 | 是否触碰图标 |
|---|---|---|---|
| 一 | #299 | 产品名改 Cairn、品牌色收敛为单色 | ✗ |
| 二 | #300 | L0 token：石墨中性外壳 + 石板蓝品牌色、`--radius-md` 收到 6px | ✗ |
| 三 | #301 | 内容泳道 `--organize-lane*`、页头收口 `PageHeader`、设置页分组卡 | ✗ |
| 四 | #304 #305 | 工具行收口（筛选面板 / 标签筛选并入工具行）、待办首屏节奏 | ✗ |
| 五 | #306 | 工作台首屏信息密度：横带合并 + 卡片三档层级 | ✗ |
| 六 | #307 | 笔记页工具行收口（排序合成下拉、导入/图谱进「更多」） | ✗ |
| 七 | #308 | 顶部工具条统一为一条壳（chrome bar） | ✗ |
| 八 | #309 | 文章顶栏收密度、全站内容宽度统一到标准泳道 1088 | ✗ |
| 九 | #310 | 详情页操作行统一壳 `.organize-detail-bar` | ✗ |
| 十 | #311 | 功能页页头去说明，只留「名称 + 右侧动作」 | ✗ |

也就是说：**每一步都在动"排布"和"色值"，没有一步动"资产"。** 这就是「改过了但看着还是老样子」的直接原因。

## 2. 这次补的：图标层（第十一步）

TraeWork 的图标是 671 个单色 SVG（`TraeWork Copy/assets/icons`，`fill="currentColor"`，16×16 视框）。
做法是**代码生成 + 一次性 codemod**，不引第二套图标库、不手抄 path：

- `apps/web/scripts/ds-icon-map.json` — 200 条「代码里用的图标名 → TraeWork SVG 文件名」映射（人工对齐语义，不是文件名硬匹配）。
- `apps/web/scripts/gen-ds-icons.mjs` — 读映射与 SVG，产出 `components/icons/ds-icons.generated.tsx`（200 个组件）。
  源目录可用 `TRAEWORK_ICONS` 覆盖；`TraeWork Copy/` 本身保持不入库（未跟踪的只读参考物）。
- `apps/web/components/icons/ds-icon-factory.tsx` — 统一组件外壳：`className` 直传、`aria-hidden`、`.ds-icon { flex-shrink: 0 }`。
- `apps/web/components/icons/index.tsx` — 唯一出口（barrel）。
- codemod：**131 个文件**的 `from "lucide-react"` 改为 `from "@/components/icons"`。业务代码里的图标名一个都没改，
  所以 diff 里没有"换图标"的语义噪音，只有 import 行变化。

现在 `lucide-react` 在源码里**零引用**（只剩 `package.json` 依赖项与 `components/icons/index.tsx` 里一句说明注释），
下一个 PR 可以直接从依赖里摘掉。

## 3. 还没对齐的部分（明确记下来，不当成"已完成"）

1. **`.ds-*` 组件类没有采用**。TraeWork 提供 `.ds-btn` / `.ds-card` / `.ds-alert` / `.ds-avatar` 等一整套组件类。
   Cairn 的 L1 原语是 shadcn/Radix（`components/ui/*`，全站唯一一套）。**这是有意不采用的**：
   换成 `.ds-*` 等于重写 18 件原语并丢掉 Radix 的可访问性与受控行为。做法仍是「token 对齐、组件保留」。
2. **间距刻度未逐项对齐**。TraeWork 有自己的 spacing scale，Cairn 目前用 Tailwind 默认刻度 + `--organize-*` 节奏变量。
   两者数值接近但不等同，暂不动（动它等于全站重排一遍，收益低风险高）。
3. **TraeWork 只有亮色**。它的 `colors_and_type.css` 没有暗色一份，而 Cairn 的暗色是硬要求。
   所以 TraeWork 永远只能当**亮色视觉参考**，暗色值由 Cairn 自己的 `.dark` token 负责——
   任何"照抄 TraeWork 颜色"的改动都必须同时给出暗色对照，否则暗色会崩。
4. **图标映射只覆盖在用的 200 个**。剩下 471 个 SVG 没有生成组件（按需再加映射即可，生成脚本无需改）。

## 4. 判定"是否遵循设计系统"的检查清单（下次直接跑）

- [ ] 颜色一律 `hsl(var(--token))`，不写字面色值；改颜色只动 `app/globals.css` 的 token 段与 `hooks/use-theme-color.ts`。
- [ ] 图标一律 `from "@/components/icons"`；`rg "lucide-react" apps/web --glob '!node_modules'` 应只命中 `package.json`。
- [ ] 圆角用 `--radius-*`；阴影用 token；不新增局部阴影常量。
- [ ] 页面标题走 `components/layout/page-header.tsx`；页内搜索走它的 `search` 槽（`components/layout/page-search.tsx`）。
- [ ] 内容宽度不写死，靠 `.organize-main-content > *` 的标准泳道兜（例外只有两处文档页）。
- [ ] 每条视觉改动都在亮色 + 暗色 + 390px 三态下看过。
