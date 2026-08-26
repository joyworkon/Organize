"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ListChecks, Loader2, Network, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  buildNoteGraph,
  buildTaskGraph,
  filterIsolatedNodes,
  type GraphData,
  type NoteGraphRow,
  type TaskDependencyRow,
  type TaskGraphRow,
} from "@/lib/graph/build-graph";
import { computeForceLayout } from "@/lib/graph/force-layout";

type GraphView = "notes" | "tasks";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;

interface Transform {
  k: number;
  x: number;
  y: number;
}

function nodeRadius(degree: number): number {
  return 7 + Math.min(degree, 10) * 1.2;
}

function truncateLabel(label: string): string {
  return label.length > 10 ? `${label.slice(0, 10)}…` : label;
}

export default function GraphPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<GraphView>("notes");
  const [hideIsolated, setHideIsolated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteRows, setNoteRows] = useState<NoteGraphRow[]>([]);
  const [taskRows, setTaskRows] = useState<TaskGraphRow[]>([]);
  const [dependencyRows, setDependencyRows] = useState<TaskDependencyRow[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // 拖拽超过阈值后置位，吞掉随后的 click，避免平移结束误开节点
  const draggedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // getSession 读本地会话（与 X1 约定一致）；数据本身需联网，失败走错误横幅
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setError("未登录，请先登录");
        return;
      }
      const [notesResult, tasksResult, depsResult] = await Promise.all([
        supabase
          .from("notes")
          .select("id, title, content, parent_note_id")
          .eq("user_id", user.id)
          .is("deleted_at", null),
        supabase
          .from("tasks")
          .select("id, title, status")
          .eq("user_id", user.id)
          .is("deleted_at", null),
        supabase
          .from("task_dependencies")
          .select("task_id, depends_on_task_id")
          .eq("user_id", user.id),
      ]);
      const failed = notesResult.error
        ? `笔记（${notesResult.error.message}）`
        : tasksResult.error
          ? `任务（${tasksResult.error.message}）`
          : depsResult.error
            ? `任务依赖（${depsResult.error.message}）`
            : null;
      if (failed) throw new Error(failed);
      setNoteRows((notesResult.data ?? []) as NoteGraphRow[]);
      setTaskRows((tasksResult.data ?? []) as TaskGraphRow[]);
      setDependencyRows((depsResult.data ?? []) as TaskDependencyRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "图谱数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const fullGraph: GraphData = useMemo(
    () => (view === "notes" ? buildNoteGraph(noteRows) : buildTaskGraph(taskRows, dependencyRows)),
    [view, noteRows, taskRows, dependencyRows]
  );
  const graph: GraphData = useMemo(
    () => (hideIsolated ? filterIsolatedNodes(fullGraph) : fullGraph),
    [fullGraph, hideIsolated]
  );

  const positions = useMemo(
    () => new Map(computeForceLayout(graph, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }).map((p) => [p.id, p])),
    [graph]
  );

  // 视图/筛选切换后回到初始视口
  useEffect(() => {
    setTransform({ k: 1, x: 0, y: 0 });
    setHoverId(null);
  }, [view, hideIsolated]);

  const neighbors = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const edge of graph.edges) {
      if (edge.source === hoverId) set.add(edge.target);
      if (edge.target === hoverId) set.add(edge.source);
    }
    return set;
  }, [graph.edges, hoverId]);

  // 滚轮缩放（原生监听，React 合成事件无法 preventDefault）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
      const py = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
      setTransform((current) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        const scale = k / current.k;
        return { k, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const toCanvasDelta = useCallback((dx: number, dy: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { dx: 0, dy: 0 };
    return { dx: (dx / rect.width) * CANVAS_WIDTH, dy: (dy / rect.height) * CANVAS_HEIGHT };
  }, []);

  const onBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    draggedRef.current = false;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: transform.x,
      baseY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) > 4) {
      draggedRef.current = true;
    }
    const delta = toCanvasDelta(event.clientX - pan.startX, event.clientY - pan.startY);
    setTransform((current) => ({ ...current, x: pan.baseX + delta.dx, y: pan.baseY + delta.dy }));
  };
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  const openNode = (nodeId: string) => {
    if (draggedRef.current) return;
    router.push(view === "notes" ? `/notes/${nodeId}` : `/tasks/${nodeId}`);
  };

  const edgeStyle = (kind: string) =>
    kind === "parent"
      ? { strokeDasharray: "5 4" as const }
      : kind === "dependency"
        ? { markerEnd: "url(#graph-arrow)" }
        : {};

  const linkCount = graph.edges.filter((e) => e.kind === "link").length;
  const parentCount = graph.edges.filter((e) => e.kind === "parent").length;
  const isolatedCount = fullGraph.nodes.length - graph.nodes.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            知识图谱
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {view === "notes"
              ? `笔记 ${graph.nodes.length} 篇 · 链接 ${linkCount} 条 · 层级 ${parentCount} 条`
              : `任务 ${graph.nodes.length} 个 · 依赖 ${graph.edges.length} 条`}
            {hideIsolated && isolatedCount > 0 ? ` · 已隐藏 ${isolatedCount} 个孤立节点` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-card p-0.5">
            <Button
              variant={view === "notes" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("notes")}
              aria-pressed={view === "notes"}
            >
              <FileText className="h-4 w-4 mr-1" />
              笔记图谱
            </Button>
            <Button
              variant={view === "tasks" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("tasks")}
              aria-pressed={view === "tasks"}
            >
              <ListChecks className="h-4 w-4 mr-1" />
              任务依赖
            </Button>
          </div>
          <Button
            variant={hideIsolated ? "default" : "outline"}
            size="sm"
            onClick={() => setHideIsolated((v) => !v)}
            aria-pressed={hideIsolated}
          >
            隐藏孤立节点
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading} aria-label="重新加载">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            重试
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          正在构建图谱…
        </div>
      ) : !error && graph.nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title={hideIsolated && fullGraph.nodes.length > 0 ? "当前没有相互连接的内容" : "还没有可展示的内容"}
          description={
            view === "notes"
              ? "在笔记正文中用 [[ 或链接插入其他笔记，或建立父子层级，这里就会生长出知识网络。"
              : "在任务详情中添加前置依赖，这里就会展示任务的阻塞关系。"
          }
          action={
            hideIsolated && fullGraph.nodes.length > 0 ? (
              <Button variant="outline" onClick={() => setHideIsolated(false)}>
                显示全部节点
              </Button>
            ) : undefined
          }
        />
      ) : !error ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            className="w-full aspect-[3/2] touch-none select-none cursor-grab active:cursor-grabbing"
            role="img"
            aria-label="知识图谱画布"
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" className="fill-primary/60" />
              </marker>
            </defs>
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {graph.edges.map((edge) => {
                const source = positions.get(edge.source);
                const target = positions.get(edge.target);
                if (!source || !target) return null;
                const dimmed = neighbors && !(neighbors.has(edge.source) && neighbors.has(edge.target));
                return (
                  <line
                    key={`${edge.kind}:${edge.source}:${edge.target}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className={cn(
                      "transition-opacity duration-150",
                      edge.kind === "dependency" ? "stroke-primary/50" : "stroke-muted-foreground/30"
                    )}
                    strokeWidth={edge.kind === "link" ? 1.5 : 1.2}
                    opacity={dimmed ? 0.15 : 1}
                    {...edgeStyle(edge.kind)}
                  />
                );
              })}
              {graph.nodes.map((node) => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                const dimmed = neighbors && !neighbors.has(node.id);
                const isTaskDone = node.kind === "task" && taskRows.find((t) => t.id === node.id)?.status === "done";
                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x} ${pos.y})`}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.2 : 1}
                    onClick={() => openNode(node.id)}
                    // 阻止冒泡到画布的平移处理：否则 setPointerCapture 会把 click 重定向到 svg，吞掉跳转
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerEnter={() => setHoverId(node.id)}
                    onPointerLeave={() => setHoverId((current) => (current === node.id ? null : current))}
                  >
                    <circle
                      r={nodeRadius(node.degree)}
                      className={cn(
                        "transition-opacity duration-150",
                        node.kind === "note" ? "fill-primary" : isTaskDone ? "fill-muted-foreground/40" : "fill-foreground"
                      )}
                      stroke={hoverId === node.id ? "hsl(var(--primary))" : "hsl(var(--background))"}
                      strokeWidth={hoverId === node.id ? 3 : 2}
                    />
                    <text
                      y={nodeRadius(node.degree) + 14}
                      textAnchor="middle"
                      className="fill-foreground pointer-events-none"
                      fontSize={11}
                    >
                      {truncateLabel(node.label)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>滚轮缩放 · 拖拽平移 · 点击节点打开 · 悬停高亮相邻</span>
            {view === "notes" && <span>实线=链接 · 虚线=父子层级</span>}
            {view === "tasks" && <span>箭头指向被阻塞任务 · 灰色=已完成</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
