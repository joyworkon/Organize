"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  MoveVertical,
  SmilePlus,
  Trash2,
  Upload,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NoteIconPicker } from "./note-icon-picker";
import { NoteCoverReposition } from "./note-cover-reposition";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NotePageVisualsProps {
  noteId: string;
  contentClassName: string;
  /** N03：只读角色（viewer）隐藏图标/封面等会写库的变更入口；评论开关保留（可查看） */
  readOnly?: boolean;
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
  readOnly = false,
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
  const [positioning, setPositioning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const retryFile = useRef<File | null>(null);
  const uploadLock = useRef(false);
  const canWrite = useRef(!readOnly);
  canWrite.current = !readOnly;
  const mounted = useRef(true);
  const positionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (readOnly) { setPositioning(false); setDragOver(false); }
  }, [readOnly]);
  const supabase = useMemo(() => createClient(), []);

  const uploadCover = async (file: File) => {
    if (!canWrite.current || uploadLock.current) return;
    retryFile.current = file;
    const fail = (message: string) => { setUploadError(message); onError(message); };
    if (!file.type.startsWith("image/")) {
      fail("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      fail("封面图片不能超过 5MB");
      return;
    }

    uploadLock.current = true;
    setUploading(true);
    setPositioning(false);
    setUploadError(null);
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
      if (mounted.current && canWrite.current) {
        onCoverChange(publicUrl);
        onCoverPositionChange(50);
        retryFile.current = null;
      }
    } catch {
      if (mounted.current && canWrite.current) fail("封面上传失败，请稍后重试");
    } finally {
      uploadLock.current = false;
      if (mounted.current) setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const wasPositioning = useRef(false);
  useEffect(() => {
    if (!positioning && wasPositioning.current) positionButton.current?.focus();
    wasPositioning.current = positioning;
  }, [positioning]);
  const endPositioning = () => setPositioning(false);
  return (
    <div className={cn("note-page-visuals", dragOver && "is-drag-over")}
      onDragOver={(event) => {
        if (readOnly || !Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = uploading ? "none" : "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => {
        if (readOnly || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void uploadCover(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        disabled={readOnly || uploading}
        tabIndex={-1}
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        aria-label="上传封面图片"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadCover(file);
        }}
      />

      {(coverUrl || (!readOnly && (uploading || uploadError || dragOver))) && (
        <div
          className={cn("note-page-cover", positioning && "is-positioning")}
          style={{
            backgroundImage: coverUrl ? `url(${JSON.stringify(coverUrl)})` : undefined,
            backgroundPosition: `center ${coverPosition}%`,
          }}
          role="group"
          aria-label="笔记封面"
          aria-busy={uploading}
        >
          {!readOnly && coverUrl && !positioning && <div className="note-page-cover-controls">
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
              ref={positionButton}
              disabled={uploading}
              onClick={() => setPositioning(true)}
            >
              <MoveVertical className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title="移除封面"
              aria-label="移除封面"
              disabled={uploading}
              onClick={() => { setUploadError(null); onCoverChange(null); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>}
          {!readOnly && positioning && coverUrl && (
            <NoteCoverReposition url={coverUrl} position={coverPosition}
              onSave={(value) => { onCoverPositionChange(value); endPositioning(); }} onCancel={endPositioning} />
          )}
          {!readOnly && uploading && (
            <div className="note-cover-feedback" role="status"><Loader2 className="h-5 w-5 animate-spin" />正在上传封面…</div>
          )}
          {!readOnly && uploadError && (
            <div className="note-cover-feedback" role="alert">
              <span>{uploadError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => retryFile.current && void uploadCover(retryFile.current)}>重试</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>选择其他图片</Button>
            </div>
          )}
          {!readOnly && dragOver && !uploading && !uploadError && <div className="note-cover-feedback pointer-events-none">松开以上传封面图片</div>}
        </div>
      )}

      <div
        className={cn(
          contentClassName,
          "note-page-visual-content",
          coverUrl && "with-cover",
          coverUrl && icon && "has-cover"
        )}
      >
        <div className={cn("note-page-icon-actions", !icon && "no-icon")}>
          {icon ? (
            readOnly ? (
              <span className="note-page-icon" title="只读模式，无法更改图标">{icon}</span>
            ) : (
              <NoteIconPicker icon={icon} onSelect={onIconChange}>
                <Button
                  type="button"
                  variant="ghost"
                  className="note-page-icon"
                  aria-label="更改页面图标"
                  title="更改页面图标"
                >
                  {icon}
                </Button>
              </NoteIconPicker>
            )
          ) : (
            !readOnly && (
              <NoteIconPicker icon={null} onSelect={onIconChange}>
                <Button type="button" variant="ghost" size="sm" className="note-page-add-btn">
                  <SmilePlus className="h-4 w-4" />
                  添加图标
                </Button>
              </NoteIconPicker>
            )
          )}

          <div className={cn("note-page-add-actions", icon && "has-icon")}>
            {!coverUrl && !readOnly && (
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
              aria-expanded={commentsOpen}
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
