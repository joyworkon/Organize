"use client";

// 「加入集合」按钮（阶段 3）：资料卡片 / 导入文件行共用的小入口，
// 点开 AddToCollectionDialog（含自动建议芯片，用户确认制）。
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderInput as Folder } from "@/components/icons";
import { AddToCollectionDialog, type AddToCollectionTarget } from "./add-to-collection-dialog";

export function AddToCollectionsButton({
  sourceType,
  id,
  hintTitle,
  hintTags,
  label = "加入集合",
  batchIds,
}: {
  sourceType: "reading" | "memo" | "file";
  id: string;
  hintTitle?: string | null;
  hintTags?: string[];
  label?: string;
  /** 同批多文件整批加入（导入文件来源） */
  batchIds?: string[];
}) {
  const [target, setTarget] = useState<AddToCollectionTarget | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground hover:text-foreground"
        aria-label={`${label}（${sourceType}）`}
        onClick={() =>
          setTarget({
            sourceType,
            ids: batchIds?.length ? batchIds : [id],
            hintTitle: hintTitle ?? undefined,
            hintTags,
          })
        }
      >
        <Folder className="h-3.5 w-3.5" />
        {label}
      </Button>
      <AddToCollectionDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
