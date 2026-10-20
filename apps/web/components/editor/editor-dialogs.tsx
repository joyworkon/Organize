"use client";

import { aiResultToBlocks } from "@/lib/ai/result-blocks";
import { nextBlockCommentsAfterLoad } from "@/lib/editor/block-comments-load";
import { nextBlockSuggestionsAfterLoad } from "@/lib/editor/block-suggestions-load";
import { dialogMutationErrorMessage } from "@/lib/editor/dialog-mutation-error";
import { nextMoveNotesAfterLoad } from "@/lib/editor/move-notes-load";
import type { Editor, JSONContent } from "@tiptap/core";
import { showPrompt } from "@/components/ui/prompt-dialog";
import type { AIBlockResult, CommentThread, EditSuggestion, Note } from "@organize/shared";
import {
  Bot,
  Check,
  CircleStop,
  Loader2,
  MessageSquare,
  Mic,
  PencilLine,
  Reply,
  Search,
  Send,
  Trash2,
  X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findBlockById, isSameNodeSnapshot, nodeText } from "./block-utils";
import type { EditorBlockTarget, EditorDialog } from "./types";

export function EditorDialogs({
  editor,
  noteId,
  dialog,
  onClose,
}: {
  editor: Editor;
  noteId: string;
  dialog: EditorDialog;
  onClose: () => void;
}) {
  if (!dialog) return null;
  if (dialog.type === "move") return <MoveDialog editor={editor} noteId={noteId} target={dialog.target} onClose={onClose} />;
  if (dialog.type === "comment") return <CommentDialog noteId={noteId} target={dialog.target} onClose={onClose} />;
  if (dialog.type === "suggestion") return <SuggestionDialog editor={editor} noteId={noteId} target={dialog.target} onClose={onClose} />;
  if (dialog.type === "ask-ai") return <AskAIDialog editor={editor} target={dialog.target} onClose={onClose} />;
  if (dialog.type === "ai-notes") return <AINotesDialog editor={editor} pos={dialog.pos} onClose={onClose} />;
  return null;
}

function Modal({ title, icon, onClose, children, wide = false }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="editor-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`editor-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="editor-dialog-title"><div>{icon}{title}</div><button type="button" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

function MoveDialog({ editor, noteId, target, onClose }: { editor: Editor; noteId: string; target: EditorBlockTarget; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastSuccessRef = useRef<Note[]>([]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // 笔记列表走浏览器端 Supabase 客户端：会话内 RLS 查询，
    // 假后端（NEXT_PUBLIC_MOCK_BACKEND）模式下同样可用
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, icon, updated_at")
        .eq("user_id", user.id)
        .neq("id", noteId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw new Error("无法加载笔记");
      const next = nextMoveNotesAfterLoad({
        previous: lastSuccessRef.current,
        ok: true,
        notes: (data || []) as unknown as Note[],
      });
      lastSuccessRef.current = next.notes;
      setNotes(next.notes);
      setLoadError(next.loadError);
    } catch {
      const next = nextMoveNotesAfterLoad({ previous: lastSuccessRef.current, ok: false });
      setNotes(next.notes);
      setLoadError(next.loadError);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);

  const filtered = notes.filter((note) => (note.title || "无标题").toLowerCase().includes(query.toLowerCase()));
  const move = async (targetNoteId: string) => {
    setMoving(targetNoteId);
    setError("");
    try {
      const response = await fetch(`/api/notes/${noteId}/move-block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetNoteId, blockId: target.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "移动失败");
        return;
      }
      const node = editor.state.doc.nodeAt(target.pos);
      if (node) {
        const tr = editor.state.tr.delete(target.pos, target.pos + node.nodeSize);
        if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
        editor.view.dispatch(tr);
      }
      onClose();
    } catch {
      setError("网络异常，移动失败");
    } finally {
      setMoving(null);
    }
  };

  return (
    <Modal title="移动到" icon={<Search className="h-4 w-4" />} onClose={onClose}>
      <div className="editor-dialog-search"><Search className="h-4 w-4" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记…" /></div>
      {error && <p className="editor-dialog-error">{error}</p>}
      {loadError && <div className="editor-dialog-error" role="alert"><span>{loadError}</span> <button type="button" onClick={() => void loadNotes()}>重试</button></div>}
      <div className="note-picker">
        {loading && <div className="editor-dialog-loading"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>}
        {!loading && !loadError && filtered.length === 0 && <div className="editor-dialog-empty">没有可移动到的笔记</div>}
        {filtered.map((note) => <button type="button" key={note.id} onClick={() => move(note.id)} disabled={Boolean(moving)}><span><strong>{note.title || "无标题"}</strong><small>{new Date(note.updated_at).toLocaleString("zh-CN")}</small></span>{moving === note.id && <Loader2 className="h-4 w-4 animate-spin" />}</button>)}
      </div>
    </Modal>
  );
}

function CommentDialog({ noteId, target, onClose }: { noteId: string; target: EditorBlockTarget; onClose: () => void }) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastSuccessRef = useRef<CommentThread[]>([]);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/notes/${noteId}/comments?blockId=${encodeURIComponent(target.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "评论加载失败");
      const next = nextBlockCommentsAfterLoad({ previous: lastSuccessRef.current, ok: true, threads: data });
      lastSuccessRef.current = next.threads;
      setThreads(next.threads);
      setLoadError(next.loadError);
    } catch (reason) {
      const next = nextBlockCommentsAfterLoad({ previous: lastSuccessRef.current, ok: false });
      setThreads(next.threads);
      setLoadError(next.loadError);
      throw reason;
    }
  }, [noteId, target.id]);

  const loadThreads = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return reload().catch(() => undefined).finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const submit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: target.id, body: text, threadId: replyTo }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error || "评论失败");
      else { setText(""); setReplyTo(null); await reload(); }
    } catch {
      setError("网络异常，评论失败");
    } finally {
      setSubmitting(false);
    }
  };

  const mutate = async (method: "PATCH" | "DELETE", body: Record<string, unknown>, failureLabel: string) => {
    setError("");
    let response: Response;
    try {
      response = await fetch(`/api/notes/${noteId}/comments`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError(dialogMutationErrorMessage({ networkError: true, fallback: failureLabel }));
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(dialogMutationErrorMessage({ serverMessage: data?.error, fallback: failureLabel }));
      return;
    }
    // reload 内部已把失败归入 loadError（带重试入口），这里只吞掉 rethrow，不重复报错
    await reload().catch(() => undefined);
  };

  const editComment = (commentId: string, currentBody: string) => {
    void showPrompt({ title: "编辑评论", defaultValue: currentBody }).then((raw) => {
      const nextBody = raw?.trim();
      if (nextBody && nextBody !== currentBody) void mutate("PATCH", { commentId, body: nextBody }, "编辑评论失败");
    });
  };

  return (
    <Modal title="区块评论" icon={<MessageSquare className="h-4 w-4" />} onClose={onClose} wide>
      <div className="comment-block-preview">{target.text || `［${target.type} 区块］`}</div>
      {error && <p className="editor-dialog-error">{error}</p>}
      {loadError && <div className="editor-dialog-error" role="alert"><span>{loadError}</span> <button type="button" onClick={() => void loadThreads()}>重试</button></div>}
      <div className="comment-thread-list">
        {loading && <div className="editor-dialog-loading"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>}
        {!loading && !loadError && threads.length === 0 && <div className="editor-dialog-empty">还没有评论</div>}
        {threads.map((thread) => (
          <section key={thread.id} className={thread.resolved_at ? "is-resolved" : ""}>
            <div className="comment-thread-head"><span>{thread.resolved_at ? "已解决" : "讨论中"}</span><button type="button" onClick={() => mutate("PATCH", { threadId: thread.id, resolved: !thread.resolved_at }, thread.resolved_at ? "重新打开评论失败" : "解决评论失败")}>{thread.resolved_at ? "重新打开" : "解决"}</button><button type="button" onClick={() => mutate("DELETE", { threadId: thread.id }, "删除评论线程失败")}><Trash2 className="h-3.5 w-3.5" /></button></div>
            {(thread.comments || []).map((comment) => <article key={comment.id}><p>{comment.body}</p><div><time>{new Date(comment.created_at).toLocaleString("zh-CN")}</time><button type="button" onClick={() => setReplyTo(thread.id)}><Reply className="h-3 w-3" />回复</button><button type="button" onClick={() => editComment(comment.id, comment.body)}>编辑</button><button type="button" onClick={() => mutate("DELETE", { commentId: comment.id }, "删除评论失败")}>删除</button></div></article>)}
          </section>
        ))}
      </div>
      <div className="comment-composer">{replyTo && <div className="reply-indicator">正在回复线程 <button type="button" onClick={() => setReplyTo(null)}>取消</button></div>}<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="写下评论…" maxLength={5000} /><button type="button" onClick={submit} disabled={!text.trim() || submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}发送</button></div>
    </Modal>
  );
}

const SUGGESTABLE = new Set(["paragraph", "heading", "blockquote", "codeBlock", "callout"]);

function withProposedText(original: JSONContent, text: string): JSONContent {
  if (["paragraph", "heading", "codeBlock", "callout"].includes(original.type || "")) {
    return { ...original, content: text ? [{ type: "text", text }] : [] };
  }
  if (original.type === "blockquote") {
    return { ...original, content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
  }
  return original;
}

function SuggestionDialog({ editor, noteId, target, onClose }: { editor: Editor; noteId: string; target: EditorBlockTarget; onClose: () => void }) {
  const [draft, setDraft] = useState(target.text);
  const [suggestions, setSuggestions] = useState<EditSuggestion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastSuccessRef = useRef<EditSuggestion[]>([]);
  const supported = SUGGESTABLE.has(target.type);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/notes/${noteId}/suggestions?blockId=${encodeURIComponent(target.id)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "编辑建议加载失败");
      const next = nextBlockSuggestionsAfterLoad({ previous: lastSuccessRef.current, ok: true, suggestions: data });
      lastSuccessRef.current = next.suggestions;
      setSuggestions(next.suggestions);
      setLoadError(next.loadError);
    } catch (reason) {
      const next = nextBlockSuggestionsAfterLoad({ previous: lastSuccessRef.current, ok: false });
      setSuggestions(next.suggestions);
      setLoadError(next.loadError);
      throw reason;
    }
  }, [noteId, target.id]);

  const loadSuggestions = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return reload().catch(() => undefined).finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => { void loadSuggestions(); }, [loadSuggestions]);

  const create = async () => {
    if (!supported || !draft.trim() || draft === target.text) return;
    setBusy(true);
    try {
      const proposed = withProposedText(target.json, draft.trim());
      const response = await fetch(`/api/notes/${noteId}/suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockId: target.id, originalBlock: target.json, proposedBlock: proposed }) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "建议保存失败"); else await reload().catch(() => undefined);
    } catch {
      setError("网络异常，建议保存失败");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (suggestion: EditSuggestion, status: "accepted" | "rejected") => {
    setError("");
    if (status === "accepted") {
      const located = findBlockById(editor.state.doc, target.id);
      const current = located?.node;
      if (!located || !current || !isSameNodeSnapshot(current.toJSON(), suggestion.original_block as JSONContent)) {
        setError("区块自创建建议后已经变化，无法自动接受；请重新创建建议。");
        return;
      }
      editor.chain().focus().insertContentAt({ from: located.pos, to: located.pos + current.nodeSize }, suggestion.proposed_block as JSONContent).run();
    }
    const fallback = status === "accepted"
      ? "建议内容已写入编辑器，但标记为已接受失败，请重试或手动撤销"
      : "拒绝建议失败";
    let response: Response;
    try {
      response = await fetch(`/api/notes/${noteId}/suggestions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suggestionId: suggestion.id, status }) });
    } catch {
      setError(dialogMutationErrorMessage({ networkError: true, fallback }));
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(dialogMutationErrorMessage({ serverMessage: data?.error, fallback }));
      return;
    }
    // reload 内部已把失败归入 loadError（带重试入口），这里只吞掉 rethrow，不重复报错
    await reload().catch(() => undefined);
  };

  return (
    <Modal title="编辑建议" icon={<PencilLine className="h-4 w-4" />} onClose={onClose} wide>
      {!supported && <p className="editor-dialog-error">该类型区块暂不支持文本建议。可先转换为文本、标题、引用、代码或标注。</p>}
      {supported && <><label className="editor-field"><span>原文</span><div className="suggestion-original">{target.text || "（空）"}</div></label><label className="editor-field"><span>建议内容</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label><div className="editor-dialog-actions"><button className="primary" type="button" onClick={create} disabled={busy || !draft.trim() || draft === target.text}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}保存建议</button></div></>}
      {error && <p className="editor-dialog-error">{error}</p>}
      {loadError && <div className="editor-dialog-error" role="alert"><span>{loadError}</span> <button type="button" onClick={() => void loadSuggestions()}>重试</button></div>}
      <div className="suggestion-list">{loading && <div className="editor-dialog-loading"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>}{!loading && !loadError && suggestions.length === 0 && <div className="editor-dialog-empty">还没有编辑建议</div>}{suggestions.map((suggestion) => <article key={suggestion.id}><div><strong>{suggestion.status === "pending" ? "待处理" : suggestion.status === "accepted" ? "已接受" : "已拒绝"}</strong><time>{new Date(suggestion.created_at).toLocaleString("zh-CN")}</time></div><p>{nodeText(suggestion.proposed_block as JSONContent)}</p>{suggestion.status === "pending" && <footer><button type="button" onClick={() => decide(suggestion, "rejected")}>拒绝</button><button type="button" className="primary" onClick={() => decide(suggestion, "accepted")}><Check className="h-3.5 w-3.5" />接受</button></footer>}</article>)}</div>
    </Modal>
  );
}

function AskAIDialog({ editor, target, onClose }: { editor: Editor; target: EditorBlockTarget; onClose: () => void }) {
  const [instruction, setInstruction] = useState("整理并润色这段内容");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setLoading(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction, text: target.text || JSON.stringify(target.json) }) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "AI 请求失败"); else setResult(data.text);
    } catch {
      setError("网络异常，AI 请求失败");
    } finally {
      setLoading(false);
    }
  };
  const insert = (replace: boolean) => {
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node || !result) return;
    // 模型常返回 Markdown：解析成标题/列表/加粗等节点，而不是把 ## / ** 原样塞进段落
    const blocks = aiResultToBlocks(result);
    if (blocks.length === 0) return;
    if (replace) editor.chain().focus().insertContentAt({ from: target.pos, to: target.pos + node.nodeSize }, blocks).run();
    else editor.chain().focus().insertContentAt(target.pos + node.nodeSize, blocks).run();
    onClose();
  };
  return (
    <Modal title="万事问 AI" icon={<Bot className="h-4 w-4" />} onClose={onClose} wide>
      <label className="editor-field"><span>告诉 AI 要做什么</span><textarea autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      <div className="ai-source-preview">{target.text || `［${target.type} 区块］`}</div>
      <p className="ai-privacy-note">以上内容与指令将发送至你在「设置 › AI 服务」配置的服务商。</p>
      {error && <p className="editor-dialog-error">{error}</p>}
      {result && <label className="editor-field"><span>结果预览</span><textarea value={result} onChange={(event) => setResult(event.target.value)} /></label>}
      <div className="editor-dialog-actions">{result && <><button type="button" onClick={() => insert(false)}>插入到下方</button><button type="button" className="primary" onClick={() => insert(true)}>替换原区块</button></>} {!result && <button type="button" className="primary" disabled={loading || !instruction.trim()} onClick={run}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}生成</button>}</div>
    </Modal>
  );
}

function aiResultBlocks(result: AIBlockResult): JSONContent[] {
  const blocks: JSONContent[] = [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "AI 速记" }] },
    { type: "callout", attrs: { emoji: "✨" }, content: [{ type: "text", text: result.summary }] },
  ];
  if (result.keyPoints.length) blocks.push({ type: "bulletList", content: result.keyPoints.map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })) });
  if (result.actionItems.length) blocks.push({ type: "taskList", content: result.actionItems.map((text) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] })) });
  if (result.transcript) blocks.push({ type: "details", content: [{ type: "detailsSummary", content: [{ type: "text", text: "查看完整转写" }] }, { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: result.transcript }] }] }] });
  return blocks;
}

function AINotesDialog({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "recording" | "ready" | "processing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => recorderRef.current?.state === "recording" && recorderRef.current.stop(), []);
  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => Math.min(value + 1, 3600)), 1000);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => { if (seconds >= 3600) stop(); }, [seconds, stop]);
  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const start = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("当前浏览器不支持录音"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        if (blob.size > 25 * 1024 * 1024) { setError("录音超过 25MB，请缩短后重试"); setStatus("idle"); return; }
        setAudio(blob); setStatus("ready");
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setSeconds(0); setStatus("recording");
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法启动录音");
    }
  };

  const process = async () => {
    if (!audio) return;
    setStatus("processing"); setError("");
    try {
      const form = new FormData();
      const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", audio, `recording.${extension}`);
      const response = await fetch("/api/ai/notes", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "AI 速记失败"); setStatus("ready"); return; }
      const node = editor.state.doc.nodeAt(pos);
      const range = node ? { from: pos, to: pos + node.nodeSize } : pos;
      editor.chain().focus().insertContentAt(range, aiResultBlocks(data)).run();
      onClose();
    } catch {
      setError("网络异常，AI 速记失败");
      setStatus("ready");
    }
  };

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Modal title="AI 速记" icon={<Mic className="h-4 w-4" />} onClose={onClose}>
      <div className={`recording-state ${status}`}><div className="recording-pulse"><Mic className="h-7 w-7" /></div><strong>{status === "recording" ? time : status === "processing" ? "正在转写并整理…" : status === "ready" ? "录音已完成" : "录制会议或灵感"}</strong><p>录音将发送至你在「设置 › AI 服务」配置的服务商，只用于本次转写，处理完成后不会保存音频。</p></div>
      {error && <p className="editor-dialog-error">{error}</p>}
      <div className="editor-dialog-actions centered">{status === "idle" && <button type="button" className="primary" onClick={start}><Mic className="h-4 w-4" />开始录音</button>}{status === "recording" && <button type="button" className="danger-button" onClick={stop}><CircleStop className="h-4 w-4" />停止录音</button>}{status === "ready" && <><button type="button" onClick={start}>重新录制</button><button type="button" className="primary" onClick={process}><Bot className="h-4 w-4" />生成速记</button></>}{status === "processing" && <button type="button" disabled><Loader2 className="h-4 w-4 animate-spin" />处理中</button>}</div>
    </Modal>
  );
}
