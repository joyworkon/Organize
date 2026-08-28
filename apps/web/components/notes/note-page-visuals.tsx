"use client";

import { useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  MoveVertical,
  SmilePlus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const PAGE_EMOJIS = [
  "😀", "😊", "🥰", "😎", "🤔", "💡", "📘", "📚",
  "📝", "✍️", "🎯", "🚀", "⭐", "🔥", "✅", "📌",
  "🧭", "🗂️", "📊", "🧠", "🌱", "🎨", "💻", "🏠",
];

interface NotePageVisualsProps {
  noteId: string;
  contentClassName: string;
  icon: string | null;
  coverUrl: string | null;
  coverPosition: number;
  commentsOpen: boolean;
  commentCount: number;
  onIconChange: (icon: string | null) => void;
  onCoverChange: (url: string | null) => void;
  onCoverPositionChange: (position: number) => void;
  onToggleComments: () => void;
  onError: (message: string) => void;
}

export function NotePageVisuals({
  noteId,
  contentClassName,
  icon,
  coverUrl,
  coverPosition,
  commentsOpen,
  commentCount,
  onIconChange,
  onCoverChange,
  onCoverPositionChange,
  onToggleComments,
  onError,
}: NotePageVisualsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [positioning, setPositioning] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const uploadCover = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      onError("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onError("封面图片不能超过 5MB");
      return;
    }

    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const extension =
        {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "image/webp": "webp",
        }[file.type] || "jpg";
      const path = `${user.id}/note-covers/${noteId}-${Date.now()}.${extension}`;
      const { error } = await supabase.storage.from("images").upload(path, file, {
        cacheControl: "3600",
        upsert: true,
      });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("images").getPublicUrl(path);
      onCoverChange(publicUrl);
      onCoverPositionChange(50);
    } catch {
      onError("封面上传失败，请稍后重试");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="note-page-visuals">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadCover(file);
        }}
      />

      {coverUrl && (
        <div
          className="note-page-cover"
          style={{
            backgroundImage: `url(${JSON.stringify(coverUrl)})`,
            backgroundPosition: `center ${coverPosition}%`,
          }}
          role="img"
          aria-label="笔记封面"
        >
          <div className="note-page-cover-controls">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>更换</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title="调整封面位置"
              aria-label="调整封面位置"
              onClick={() => setPositioning((value) => !value)}
            >
              <MoveVertical className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title="移除封面"
              aria-label="移除封面"
              onClick={() => onCoverChange(null)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {positioning && (
            <div className="note-cover-position">
              <MoveVertical className="h-4 w-4" />
              <input
                type="range"
                min={0}
                max={100}
                value={coverPosition}
                aria-label="封面垂直位置"
                onChange={(event) =>
                  onCoverPositionChange(Number(event.target.value))
                }
              />
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          contentClassName,
          "note-page-visual-content",
          coverUrl && "has-cover"
        )}
      >
        <div className={cn("note-page-icon-actions", !icon && "no-icon")}>
          {icon ? (
            <EmojiPopover icon={icon} onSelect={onIconChange}>
              <button
                type="button"
                className="note-page-icon"
                aria-label="更改页面图标"
                title="更改页面图标"
              >
                {icon}
              </button>
            </EmojiPopover>
          ) : (
            <EmojiPopover icon={null} onSelect={onIconChange}>
              <Button type="button" variant="ghost" size="sm" className="note-page-add-btn">
                <SmilePlus className="h-4 w-4" />
                添加图标
              </Button>
            </EmojiPopover>
          )}

          <div className={cn("note-page-add-actions", icon && "has-icon")}>
            {!coverUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="note-page-add-btn"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                添加封面
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="note-page-add-btn"
              onClick={onToggleComments}
            >
              <MessageSquare className="h-4 w-4" />
              添加评论
              {commentCount > 0 && (
                <span className="note-page-comment-count">{commentCount}</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmojiPopover({
  icon,
  onSelect,
  children,
}: {
  icon: string | null;
  onSelect: (icon: string | null) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="grid grid-cols-8 gap-1">
          {PAGE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={cn(
                "grid h-8 w-8 place-items-center rounded text-lg hover:bg-accent",
                icon === emoji && "bg-accent"
              )}
              onClick={() => onSelect(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        {icon && (
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onSelect(null)}
          >
            <Trash2 className="h-4 w-4" />
            移除图标
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
