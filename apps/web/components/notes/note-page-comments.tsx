"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MessageSquare, Reply, Send, Trash2 } from "@/components/icons";
import type { BlockComment, CommentThread } from "@organize/shared";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  INITIAL_PAGE_COMMENTS_DRAFT,
  nextDraftOnNoteSwitch,
  shouldApplyCommentResult,
  type CommentLoadToken,
  type PageCommentsDraftState,
} from "./note-page-comments-state";

export const PAGE_COMMENT_BLOCK_ID = "__page__";

interface NotePageCommentsProps {
  noteId: string;
  onCountChange?: (count: number) => void;
}

export function NotePageComments({
  noteId,
  onCountChange,
}: NotePageCommentsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [draft, setDraft] = useState<PageCommentsDraftState>(INITIAL_PAGE_COMMENTS_DRAFT);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // 进行中写操作（解决/删除）的线程 id：只禁用对应线程的按钮，不阻塞其它线程与发送框
  const [pendingThreadIds, setPendingThreadIds] = useState<ReadonlySet<string>>(new Set());

  // noteId 只作为 key 触发 effect；异步链路统一走 ref，保证发起时快照可判失效。
  // ref 在 effect 内更新（不在渲染期写），避免并发渲染被丢弃时误判。
  const noteIdRef = useRef(noteId);
  const prevNoteIdRef = useRef(noteId);
  const loadSeqRef = useRef(0);
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  const loadThreads = useCallback(async (opts: { showLoading?: boolean } = {}) => {
    const token: CommentLoadToken = { noteId: noteIdRef.current, seq: ++loadSeqRef.current };
    const isCurrent = () => shouldApplyCommentResult(token, noteIdRef.current, loadSeqRef.current);
    if (opts.showLoading) setLoading(true);
    setDraft((prev) => ({ ...prev, error: "" }));
    setLoadFailed(false);
    try {
      const { data: threadRows, error: threadError } = await supabase
        .from("note_comment_threads")
        .select("*")
        .eq("note_id", token.noteId)
        .eq("block_id", PAGE_COMMENT_BLOCK_ID)
        .order("created_at", { ascending: true });
      if (threadError) throw threadError;

      const ids = (threadRows || []).map((thread) => thread.id);
      let comments: BlockComment[] = [];
      if (ids.length > 0) {
        const { data: commentRows, error: commentError } = await supabase
          .from("note_comments")
          .select("*")
          .in("thread_id", ids)
          .order("created_at", { ascending: true });
        if (commentError) throw commentError;
        comments = (commentRows || []) as BlockComment[];
      }

      const commentsByThread = new Map<string, BlockComment[]>();
      for (const comment of comments) {
        const group = commentsByThread.get(comment.thread_id) || [];
        group.push(comment);
        commentsByThread.set(comment.thread_id, group);
      }
      const next = (threadRows || []).map((thread) => ({
        ...thread,
        comments: commentsByThread.get(thread.id) || [],
      })) as CommentThread[];
      if (!isCurrent()) return;
      setThreads(next);
      onCountChangeRef.current?.(next.filter((thread) => !thread.resolved_at).length);
    } catch {
      if (!isCurrent()) return;
      setDraft((prev) => ({ ...prev, error: "评论加载失败" }));
      setLoadFailed(true);
    } finally {
      if (opts.showLoading && isCurrent()) setLoading(false);
    }
  }, [supabase]);

  // 切换笔记：丢弃上一篇的草稿/回复目标/错误与列表，避免串稿或闪旧评论。
  useEffect(() => {
    noteIdRef.current = noteId;
    setDraft((prev) => nextDraftOnNoteSwitch(prevNoteIdRef.current, noteId, prev));
    if (prevNoteIdRef.current !== noteId) {
      prevNoteIdRef.current = noteId;
      setThreads([]);
      setLoadFailed(false);
      setLoading(true);
      onCountChangeRef.current?.(0);
    }
  }, [noteId]);

  useEffect(() => {
    void loadThreads({ showLoading: true });
  }, [noteId, loadThreads]);

  const submit = async () => {
    const body = draft.text.trim();
    if (!body || submitting) return;
    const token: CommentLoadToken = { noteId: noteIdRef.current, seq: loadSeqRef.current };
    const isCurrent = () => shouldApplyCommentResult(token, noteIdRef.current, loadSeqRef.current);
    setSubmitting(true);
    setDraft((prev) => ({ ...prev, error: "" }));
    setLoadFailed(false);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");

      let threadId = draft.replyTo;
      let createdThreadId: string | null = null;
      if (!threadId) {
        const { data: thread, error: threadError } = await supabase
          .from("note_comment_threads")
          .insert({
            // 发起时的笔记快照：即使 await 期间已切笔记，评论也只写进发起时的笔记
            note_id: token.noteId,
            block_id: PAGE_COMMENT_BLOCK_ID,
            user_id: user.id,
          })
          .select()
          .single();
        if (threadError || !thread) throw threadError || new Error("评论失败");
        threadId = thread.id;
        createdThreadId = thread.id;
      }

      const { error: commentError } = await supabase.from("note_comments").insert({
        thread_id: threadId,
        user_id: user.id,
        body,
      });
      if (commentError) {
        if (createdThreadId) {
          await supabase
            .from("note_comment_threads")
            .delete()
            .eq("id", createdThreadId);
        }
        throw commentError;
      }
      // 已切到其他笔记（或有更新一轮加载）：评论已写入发起时的笔记，但不写回当前 UI
      if (!isCurrent()) return;
      setDraft((prev) => ({ ...prev, text: "", replyTo: null }));
      await loadThreads();
    } catch {
      if (isCurrent()) setDraft((prev) => ({ ...prev, error: "评论发送失败，请稍后重试" }));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleResolved = async (thread: CommentThread) => {
    const token: CommentLoadToken = { noteId: noteIdRef.current, seq: loadSeqRef.current };
    const isCurrent = () => shouldApplyCommentResult(token, noteIdRef.current, loadSeqRef.current);
    setPendingThreadIds((prev) => new Set(prev).add(thread.id));
    try {
      // .select("id")：RLS 拒绝或行不存在时 PostgREST 返回 0 行且 error=null，需按行数判失败
      const { data: updatedRows, error: updateError } = await supabase
        .from("note_comment_threads")
        .update({ resolved_at: thread.resolved_at ? null : new Date().toISOString() })
        .eq("id", thread.id)
        .eq("note_id", token.noteId)
        .select("id");
      if (updateError || !updatedRows || updatedRows.length === 0) {
        if (isCurrent()) setDraft((prev) => ({ ...prev, error: "评论状态更新失败" }));
        return;
      }
      if (isCurrent()) await loadThreads();
    } catch {
      if (isCurrent()) setDraft((prev) => ({ ...prev, error: "评论状态更新失败" }));
    } finally {
      setPendingThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(thread.id);
        return next;
      });
    }
  };

  const deleteThread = async (threadId: string) => {
    const token: CommentLoadToken = { noteId: noteIdRef.current, seq: loadSeqRef.current };
    const isCurrent = () => shouldApplyCommentResult(token, noteIdRef.current, loadSeqRef.current);
    setPendingThreadIds((prev) => new Set(prev).add(threadId));
    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from("note_comment_threads")
        .delete()
        .eq("id", threadId)
        .eq("note_id", token.noteId)
        .select("id");
      if (deleteError || !deletedRows || deletedRows.length === 0) {
        if (isCurrent()) setDraft((prev) => ({ ...prev, error: "删除评论失败" }));
        return;
      }
      if (isCurrent()) await loadThreads();
    } catch {
      if (isCurrent()) setDraft((prev) => ({ ...prev, error: "删除评论失败" }));
    } finally {
      setPendingThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    }
  };

  return (
    <section className="note-page-comments" aria-label="页面评论">
      <div className="note-page-comments-heading">
        <MessageSquare className="h-4 w-4" />
        <span>页面评论</span>
        {threads.length > 0 && <small>{threads.length}</small>}
      </div>

      {draft.error && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{draft.error}</span>
          {loadFailed && !loading && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 px-2.5 text-xs md:min-h-11"
              onClick={() => void loadThreads({ showLoading: true })}
            >
              重试
            </Button>
          )}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载评论...
        </div>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <article
              key={thread.id}
              className={cn("note-page-comment-thread", thread.resolved_at && "is-resolved")}
            >
              {(thread.comments || []).map((comment, index) => (
                <div key={comment.id} className="note-page-comment">
                  <span className="note-page-comment-avatar">我</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>我</strong>
                      <time>{new Date(comment.created_at).toLocaleString("zh-CN")}</time>
                    </div>
                    <p>{comment.body}</p>
                    {index === (thread.comments?.length || 0) - 1 && (
                      <button type="button" onClick={() => setDraft((prev) => ({ ...prev, replyTo: thread.id }))}>
                        <Reply className="h-3.5 w-3.5" />
                        回复
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="note-page-comment-actions">
                <button
                  type="button"
                  disabled={pendingThreadIds.has(thread.id)}
                  onClick={() => void toggleResolved(thread)}
                >
                  <Check className="h-3.5 w-3.5" />
                  {thread.resolved_at ? "重新打开" : "解决"}
                </button>
                <button
                  type="button"
                  disabled={pendingThreadIds.has(thread.id)}
                  onClick={() => void deleteThread(thread.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="note-page-comment-composer">
        {draft.replyTo && (
          <div className="note-page-comment-replying">
            正在回复评论
            <button type="button" onClick={() => setDraft((prev) => ({ ...prev, replyTo: null }))}>
              取消
            </button>
          </div>
        )}
        <textarea
          value={draft.text}
          onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="写下评论..."
          maxLength={5000}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.text.trim() || submitting}
          aria-label="发送评论"
          title="发送评论"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </section>
  );
}
