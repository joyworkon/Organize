"use client";

import { useState } from "react";
import { usePluginStore } from "@/lib/plugin/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Puzzle, Power, PowerOff, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PluginsPage() {
  const [toggling, setToggling] = useState<string | null>(null);
  const [pluginError, setPluginError] = useState("");
  const { plugins, activePlugins } = usePluginStore();

  const togglePlugin = async (pluginId: string, enabled: boolean) => {
    setToggling(pluginId);
    setPluginError("");
    try {
      const recordsResponse = await fetch("/api/plugins", { cache: "no-store" });
      const records = await recordsResponse.json();
      const record = records.find((candidate: { package_name: string }) => candidate.package_name === pluginId);
      if (!record) throw new Error("插件配置不存在，请刷新后重试");
      const response = await fetch(`/api/plugins/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("插件状态保存失败");
      window.location.reload();
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : "插件状态保存失败");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">插件管理</h1>
        <p className="text-muted-foreground mt-1">
          管理已安装的插件，启用或禁用功能扩展
        </p>
      </div>

      {pluginError && <p className="text-sm text-destructive">{pluginError}</p>}

      {plugins.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Puzzle className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>暂无已安装的插件</p>
          <p className="text-sm mt-2">
            将插件包放入 packages/plugins/ 目录即可自动加载
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plugins.map((plugin) => {
            const isActive = activePlugins.has(plugin.id);
            return (
              <Card key={plugin.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{plugin.icon || "🧩"}</span>
                      <div>
                        <CardTitle className="text-base">{plugin.name}</CardTitle>
                        <CardDescription>v{plugin.version}</CardDescription>
                      </div>
                    </div>
                    <Button
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      disabled={toggling === plugin.id}
                      onClick={() => void togglePlugin(plugin.id, !isActive)}
                    >
                      {isActive ? (
                        <Power className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <PowerOff className="h-3.5 w-3.5 mr-1" />
                      )}
                      {isActive ? "已启用" : "已禁用"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {plugin.description}
                  </p>

                  {/* 扩展点列表 */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {plugin.extensions.map((ext) => (
                      <span
                        key={ext.id}
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs",
                          "bg-muted text-muted-foreground"
                        )}
                      >
                        {ext.type === "toolbar-action" && "🔧 工具栏"}
                        {ext.type === "sidebar-panel" && "📋 侧边栏"}
                        {ext.type === "content-processor" && "⚙️ 内容处理"}
                        {ext.type === "ai-action" && "🤖 AI 操作"}
                      </span>
                    ))}
                  </div>

                  {plugin.author && (
                    <p className="text-xs text-muted-foreground mt-3">
                      作者: {plugin.author}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 插件开发说明 */}
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <h3 className="font-medium mb-2">开发自定义插件</h3>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>1. 在 <code className="bg-muted px-1 rounded">packages/plugins/</code> 下创建新目录</p>
            <p>2. 使用 <code className="bg-muted px-1 rounded">@organize/plugin-sdk</code> 中的 <code className="bg-muted px-1 rounded">definePlugin()</code> 定义插件</p>
            <p>3. 在 <code className="bg-muted px-1 rounded">next.config.mjs</code> 的 transpilePackages 中添加包名</p>
            <p>4. 重启开发服务器，插件将自动加载</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
