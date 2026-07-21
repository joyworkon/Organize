"use client";

import { usePluginStore } from "@/lib/plugin/store";
import type { PluginContext } from "@organize/plugin-sdk";

interface PluginPanelContainerProps {
  ctx: PluginContext;
}

/** 渲染所有激活插件的侧边栏面板 */
export function PluginSidebarPanels({ ctx }: PluginPanelContainerProps) {
  const panels = usePluginStore((s) => s.getExtensionsByType("sidebar-panel"));

  if (panels.length === 0) return null;

  return (
    <div className="space-y-4">
      {panels.map((panel: any) => {
        const Component = panel.component;
        return (
          <div key={panel.id} className="rounded-lg border p-3">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <span>{panel.icon}</span>
              {panel.label}
            </h4>
            <Component ctx={ctx} />
          </div>
        );
      })}
    </div>
  );
}

interface PluginToolbarActionsProps {
  ctx: PluginContext;
}

/** 渲染所有激活插件的工具栏操作按钮 */
export function PluginToolbarActions({ ctx }: PluginToolbarActionsProps) {
  const actions = usePluginStore((s) => s.getExtensionsByType("toolbar-action"));

  if (actions.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {actions.map((action: any) => (
        <button
          key={action.id}
          onClick={() => action.handler(ctx)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-muted hover:bg-accent transition-colors"
          title={action.label}
        >
          <span>{action.icon}</span>
          <span className="hidden sm:inline">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

interface PluginAIActionsProps {
  ctx: PluginContext;
  text: string;
  onResult: (result: string) => void;
}

/** 渲染所有激活插件的 AI 操作 */
export function PluginAIActions({ ctx, text, onResult }: PluginAIActionsProps) {
  const actions = usePluginStore((s) => s.getExtensionsByType("ai-action"));

  if (actions.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {actions.map((action: any) => (
        <button
          key={action.id}
          onClick={async () => {
            const result = await action.handler(text, ctx);
            onResult(result);
          }}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title={action.label}
        >
          <span>{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
}
