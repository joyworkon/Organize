"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, MessageSquare, Reply, Send, Trash2 } from "lucide-react";
import type { BlockComment, CommentThread } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadThreads = useCallback(async () => {
    setError("");
    const { data: threadRows, error: threadError } = await supabase
      .from("note_comment_threads")
      .select("*")
      .eq("note_id", noteId)
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
    setThreads(next);
    onCountChange?.(next.filter((thread) => !thread.resolved_at).length);
  }, [noteId, onCountChange, supabase]);

  useEffect(() => {
    setLoading(true);
    void loadThreads()
      .catch(() => setError("评论加载失败"))
      .finally(() => setLoading(false));
  }, [loadThreads]);

  const submit = async () => {
    const body = text.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");

      let threadId = replyTo;
      let createdThreadId: string | null = null;
      if (!threadId) {
        const { data: thread, error: threadError } = await supabase
          .from("note_comment_threads")
          .insert({
            note_id: noteId,
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
      setText("");
      setReplyTo(null);
      await loadThreads();
    } catch {
      setError("评论发送失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleResolved = async (thread: CommentThread) => {
    const { error: updateError } = await supabase
      .from("note_comment_threads")
      .update({ resolved_at: thread.resolved_at ? null : new Date().toISOString() })
      .eq("id", thread.id)
      .eq("note_id", noteId);
    if (updateError) {
      setError("评论状态更新失败");
      return;
    }
    await loadThreads();
  };

  const deleteThread = async (threadId: string) => {
    const { error: deleteError } = await supabase
      .from("note_comment_threads")
      .delete()
      .eq("id", threadId)
      .eq("note_id", noteId);
    if (deleteError) {
      setError("删除评论失败");
      return;
    }
    await loadThreads();
  };

  return (
    <section className="note-page-comments" aria-label="页面评论">
      <div className="note-page-comments-heading">
        <MessageSquare className="h-4 w-4" />
        <span>页面评论</span>
        {threads.length > 0 && <small>{threads.length}</small>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
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
                      <button type="button" onClick={() => setReplyTo(thread.id)}>
                        <Reply className="h-3.5 w-3.5" />
                        回复
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="note-page-comment-actions">
                <button type="button" onClick={() => void toggleResolved(thread)}>
                  <Check className="h-3.5 w-3.5" />
                  {thread.resolved_at ? "重新打开" : "解决"}
                </button>
                <button type="button" onClick={() => void deleteThread(thread.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="note-page-comment-composer">
        {replyTo && (
          <div className="note-page-comment-replying">
            正在回复评论
            <button type="button" onClick={() => setReplyTo(null)}>
              取消
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
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
          disabled={!text.trim() || submitting}
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
