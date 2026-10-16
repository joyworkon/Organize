import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DashboardViewHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="dashboard-view-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="dashboard-view-actions">{actions}</div>}
    </header>
  );
}

export function DashboardSection({
  title,
  icon: Icon,
  actions,
  className,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("dashboard-card", className)}>
      <div className="dashboard-section-body">
        <div className="dashboard-section-heading">
          <h2>
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            {title}
          </h2>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}
