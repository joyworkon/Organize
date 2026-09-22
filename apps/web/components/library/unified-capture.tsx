"use client";

// 资料库统一输入框（阶段 C）：写点什么、粘贴链接，或拖入文件。
// 分流口径在 lib/library/classify-capture.ts（纯函数，单测钉住）：
//   单 URL → collectReadingItem；多 URL → 逐条 collect；文字夹带 URL → 完整文字存速记
//   + toast 动作「另存其中链接」；≤5000 字纯文本 → 速记；>5000 字 → 确定性物料切块
//   （不截断，超 4 万字符明确报错）。
// IME 防误提交（F01 同款 isImeComposing 守卫）、草稿（lib/memos/draft.ts，入口 "library"）、
// 提交互斥、速记离线队列与幂等 id 全部沿用既有链路（lib/memos/save-memo.ts）。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, PenLine } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { isImeComposing } from "@/lib/input/submit-guard";
import { classifyCapture, CAPTURE_MEMO_MAX_LENGTH } from "@/lib/library/classify-capture";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";
import { submitMemo } from "@/lib/memos/save-memo";
import { textToMaterialResult } from "@/lib/materials/text-material";
import { materialFingerprint } from "@/lib/materials/article";
import { clearMemoDraft, loadMemoDraft, saveMemoDraft } from "@/lib/memos/draft";
import { cn } from "@/lib/utils";

export interface UnifiedCaptureHandle {
  focus(): void;
}

export interface UnifiedCaptureProps {
  /** 任意内容入库成功后回调（页面刷新各视图） */
  onCaptured?: () => void;
}

/** 拖入文件交给现有物料导入流程（MaterialImport 监听本事件并接管） */
export const MATERIAL_FILES_EVENT = "organize:material-files";

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const UnifiedCapture = forwardRef<UnifiedCaptureHandle, UnifiedCaptureProps>(
  function UnifiedCapture({ onCaptured }, ref) {
    const supabase = useMemo(() => createClient(), []);
    const [userId, setUserId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [coarsePointer, setCoarsePointer] = useState(false);
    const [dragging, setDragging] = useState(false);
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const draftRestoredRef = useRef(false);
    const onCapturedRef = useRef(onCaptured);
    onCapturedRef.current = onCaptured;
    const inputRef = useRef("");
    inputRef.current = input;

    useEffect(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUserId(session?.user?.id ?? null);
      });
      setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
    }, [supabase]);

    const focusComposer = useCallback(() => {
      const el = composerRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }, []);
    useImperativeHandle(ref, () => ({ focus: focusComposer }), [focusComposer]);

    // 侧栏资料库行内「+」：已在本页时经 organize:memo-compose 聚焦统一输入框
    useEffect(() => {
      const handler = () => focusComposer();
      window.addEventListener("organize:memo-compose", handler);
      return () => window.removeEventListener("organize:memo-compose", handler);
    }, [focusComposer]);

    // 草稿按 用户+入口("library") 隔离；只恢复一次，用户已输入时不覆盖
    useEffect(() => {
      if (!userId || draftRestoredRef.current) return;
      draftRestoredRef.current = true;
      const draft = loadMemoDraft(localStorage, userId, "library");
      if (draft && !inputRef.current) setInput(draft);
    }, [userId]);

    const updateInput = useCallback(
      (value: string) => {
        setInput(value);
        if (userId) saveMemoDraft(localStorage, userId, "library", value);
      },
      [userId]
    );

    /** 仅当当前输入仍是被确认保存的版本时才清空（保存期间续写的内容保留） */
    const clearInputIfSame = useCallback(
      (submitted: string) => {
        if (inputRef.current !== submitted) return;
        setInput("");
        if (userId) clearMemoDraft(localStorage, userId, "library");
      },
      [userId]
    );

    const collectUrls = useCallback(async (urls: string[]) => {
      for (const url of urls) {
        const result = await collectReadingItem(url);
        toast({ ...collectResultToast(result), description: shortUrl(url) });
        if (result.status === "saved" || result.status === "saved-link-only") {
          onCapturedRef.current?.();
        }
      }
    }, []);

    const handleSubmit = async () => {
      const rawInput = inputRef.current;
      const cls = classifyCapture(rawInput);
      if (cls.kind === "empty" || saving) return;
      setSaving(true);
      try {
        switch (cls.kind) {
          case "url":
          case "urls": {
            await collectUrls(cls.kind === "url" ? [cls.url] : cls.urls);
            clearInputIfSame(rawInput);
            break;
          }
          case "memo":
          case "memo-with-urls": {
            const result = await submitMemo({ content: cls.text, userId });
            if (result.status === "error") {
              toast({ title: "保存失败", description: result.message, variant: "destructive" });
              break;
            }
            clearInputIfSame(rawInput);
            if (result.status === "queued") {
              toast(
                result.persisted
                  ? { title: "当前离线，已本地保存，联网后自动同步" }
                  : { title: "本地存储不可用，离线创建可能丢失", variant: "destructive" }
              );
            } else {
              toast({
                title: "已保存为速记",
                description: cls.kind === "memo-with-urls" ? "文字已完整保留，其中的链接未自动保存" : undefined,
                action: cls.kind === "memo-with-urls" ? (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    onClick={() => void collectUrls(cls.urls)}
                  >
                    另存其中链接
                  </button>
                ) : undefined,
              });
            }
            // 与 quick-add.tsx 同一合同：通知工作台/速记视图刷新；全部视图经 onCaptured 走 refreshTick
            onCapturedRef.current?.();
            window.dispatchEvent(new CustomEvent("organize:memos-synced"));
            break;
          }
          case "text-material": {
            try {
              const result = textToMaterialResult(cls.text);
              const key = await materialFingerprint({ files: [], text: cls.text, mode: "organize" });
              const saved = await collectReadingItem({
                kind: "material",
                key,
                result,
                sources: ["统一输入框粘贴的长文本"],
              });
              toast(collectResultToast(saved));
              if (saved.status === "saved" || saved.status === "saved-link-only") {
                clearInputIfSame(rawInput);
                onCapturedRef.current?.();
              } else if (saved.status === "duplicate") {
                clearInputIfSame(rawInput);
              }
            } catch (error) {
              toast({
                title: error instanceof Error ? error.message : "保存失败",
                variant: "destructive",
              });
            }
            break;
          }
        }
      } finally {
        setSaving(false);
      }
    };

    return (
      <div
        className={cn(
          "memo-composer rounded-lg border bg-card p-3 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-primary",
          dragging && "border-primary bg-accent"
        )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length) {
            window.dispatchEvent(new CustomEvent(MATERIAL_FILES_EVENT, { detail: { files: dropped } }));
          }
        }}
      >
        <div className="flex items-start gap-2">
          <PenLine className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => updateInput(e.target.value)}
            onKeyDown={(e) => {
              // F01：输入法组合态（中文选字）的 Enter 不作提交
              if (isImeComposing(e)) return;
              if (e.key === "Enter") {
                const submit = !e.shiftKey && (e.metaKey || e.ctrlKey || !coarsePointer);
                if (!submit) return; // Shift+Enter / 触屏 Enter：换行
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="写点什么、粘贴链接，或拖入文件……"
            aria-label="资料库统一输入"
            rows={3}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="mt-1 flex items-center justify-end gap-2">
          {input.length > CAPTURE_MEMO_MAX_LENGTH * 0.9 && (
            <span className="text-[11px] text-muted-foreground">
              {input.length > CAPTURE_MEMO_MAX_LENGTH
                ? "超长文本将作为物料保存（上限 4 万字符）"
                : `${input.length}/${CAPTURE_MEMO_MAX_LENGTH}`}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!input.trim() || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
          </Button>
        </div>
      </div>
    );
  }
);
