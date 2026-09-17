import { cn } from "@/lib/utils";

export type DsIconProps = Omit<React.SVGProps<SVGSVGElement>, "children" | "dangerouslySetInnerHTML"> & {
  /** 默认 16px（TraeWork 默认图标尺寸）；className 里的高宽类会覆盖它 */
  size?: number;
};

/**
 * 生成一个 TraeWork 单色图标组件。
 * - 几何、viewBox、fill 模型原样来自 TraeWork 资产（不重绘、不改描边）
 * - fill=currentColor ⇒ 明暗主题自动跟随文字色
 * - 与 lucide 的调用形态兼容（`<Icon className="h-4 w-4" />`），便于按视图整体替换
 */
export function dsIcon(name: string, viewBox: string, body: string) {
  const Icon = ({ className, size = 16, ...rest }: DsIconProps) => (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      aria-hidden={rest["aria-label"] ? undefined : true}
      {...rest}
      className={cn("ds-icon", className)}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
  Icon.displayName = `DsIcon(${name})`;
  Icon.dsIconName = name;
  return Icon;
}
