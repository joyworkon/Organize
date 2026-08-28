import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题左侧的可选图标，渲染为主色浅底圆角方块 */
  icon?: React.ComponentType<{ className?: string }>;
  /** 右侧操作区（按钮组） */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 主内容页统一的页面标题区：图标 + 标题 + 描述 + 右侧操作。
 * 各页 h1 字号、描述字号、图标样式不一致的问题统一收口到这里。
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[--radius-lg] bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold leading-tight sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
