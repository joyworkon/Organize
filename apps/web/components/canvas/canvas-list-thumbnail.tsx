import { Image as ImageIcon } from "@/components/icons";
import type { CanvasListSummary } from "@/lib/canvas/list-summary";

export function CanvasListThumbnail({ summary }: { summary?: CanvasListSummary | null }) {
  if (!summary?.shapes.length) {
    return <span className="canvas-list-thumbnail flex items-center justify-center text-xs text-muted-foreground">{summary ? "空白画布" : "暂无预览"}</span>;
  }
  return (
    <span className="canvas-list-thumbnail" aria-hidden="true">
      <svg viewBox="0 0 160 100" className="h-full w-full">
        {summary.shapes.map((shape, index) => {
          const x = shape.x * 160;
          const y = shape.y * 100;
          const width = shape.width * 160;
          const height = shape.height * 100;
          return (
            <g key={index} className={`canvas-list-shape is-${shape.kind}`}>
              <rect x={x} y={y} width={width} height={height} rx={shape.kind === "board" ? 1 : 0.5} />
              {shape.kind === "image" && width > 8 && height > 8 && (
                <ImageIcon x={x + width / 2 - 4} y={y + height / 2 - 4} width={8} height={8} className="text-muted-foreground" />
              )}
            </g>
          );
        })}
      </svg>
    </span>
  );
}
