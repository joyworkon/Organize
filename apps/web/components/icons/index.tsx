/**
 * 全站图标出口（设计系统对齐）：
 * 图标一律来自 TraeWork 设计系统资产（scripts/ds-icon-map.json → ds-icons.generated.tsx），
 * 不再直接从 lucide-react 引入。新增图标步骤：
 *   1) 在 scripts/ds-icon-map.json 加一条 `"代码里的名字": "TraeWork 文件名.svg"`
 *   2) 跑 `node scripts/gen-ds-icons.mjs`（需要本地有 TraeWork 包，见脚本头注释）
 * 调用形态与 lucide 兼容：`<Icon className="h-4 w-4" />`，默认 16×16、fill=currentColor。
 */
export * from "./ds-icons.generated";
export type { DsIconProps } from "./ds-icon-factory";

/**
 * 图标组件类型（替代 lucide 的 LucideIcon）：
 * 任何"接收 className 的图标组件"都满足它，便于把图标当数据传（导航表、菜单项等）。
 */
export type DsIconComponent = React.ComponentType<{ className?: string }>;
