"use client";

/**
 * 构思画布详情：桌面进编辑器，窄屏（手机）只读预览（规格 §1）。
 * 编辑器按页面懒加载，其他导航不承担画布开销（规格 §6.2）。
 */

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Loader2 } from "@/components/icons";
import { useIsNarrowViewport } from "@/components/canvas/use-is-narrow-viewport";

const CanvasWorkspace = dynamic(
  () => import("@/components/canvas/canvas-workspace").then((m) => m.CanvasWorkspace),
  {
    loading: () => (
      <div className="canvas-page">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载画布编辑器…
        </div>
      </div>
    ),
  },
);

export default function CanvasDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const narrow = useIsNarrowViewport();

  return (
    <>
      {narrow && (
        <div className="canvas-mobile-notice" role="note">
          手机端仅支持只读预览，编辑请在桌面端进行。
        </div>
      )}
      <CanvasWorkspace documentId={id} readOnly={narrow} />
    </>
  );
}
