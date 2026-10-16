import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题左侧的可选单色图标，不额外生成装饰卡片 */
  icon?: React.ComponentType<{ className?: string }>;
  /** 右侧操作区（按钮组） */
  actions?: React.ReactNode;
  /**
   * 页内搜索框（`PageSearch`）：与右侧主动作同处一行，优先于动作呈现，
   * 只搜当前功能内的内容。跨功能搜索走 ⌘K 命令面板。
   */
  search?: React.ReactNode;
  className?: string;
}

/**
 * 主内容页统一的页面标题区：单色图标 + 克制标题 + 页内搜索 + 右侧操作。
 * 各页 h1 字号、描述字号、图标样式不一致的问题统一收口到这里。
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  search,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "organize-page-header flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="organize-page-heading flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-5 w-5 shrink-0 place-items-center text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold leading-7">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {(actions || search) && (
        <div className="organize-page-header-actions flex min-w-0 max-w-full flex-wrap items-center gap-2 lg:justify-end">
          {search}
          {actions}
        </div>
      )}
    </header>
  );
}
