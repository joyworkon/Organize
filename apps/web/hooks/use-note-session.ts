"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteDraftSnapshot } from "@/lib/notes/local-draft";
import {
  createNoteSaveSession,
  type NoteSaveSession,
  type NoteSaveSessionDeps,
  type NoteSaveTransport,
  type NoteSaveUiState,
} from "@/lib/notes/note-save-session";
import type { CollabRole } from "@/lib/collab/roles";

/**
 * 保存会话的 React 绑定（R07）：
 * - 以 noteId+accountId 为 generation：任一变化即销毁旧会话、创建新会话，
 *   旧会话的在途保存/重试定时器全部失效，不会污染新会话。
 * - 页面通过 ui 状态渲染保存摘要，不再持有互不约束的散 flag。
 * 会话核心（lib/notes/note-save-session.ts）不访问 DOM / React，可独立行为测试。
 */
export function useNoteSaveSession(options: {
  noteId: string;
  accountId: string | null;
  draftRef: { current: NoteDraftSnapshot };
  getRole: () => CollabRole | null;
  isCollabActive: () => boolean;
  isOnline: () => boolean;
  isTaskNoteLinkEnabled: () => boolean;
  createTransport: () => NoteSaveTransport;
  consumeSkipFlush: () => boolean;
  onSaved?: (info: { noteId: string; title: string }) => void;
}): { session: NoteSaveSession | null; ui: NoteSaveUiState | null } {
  const { noteId, accountId, draftRef } = options;
  const sessionRef = useRef<NoteSaveSession | null>(null);
  const [session, setSession] = useState<NoteSaveSession | null>(null);
  const [ui, setUi] = useState<NoteSaveUiState | null>(null);
  // 依赖项用 ref 装载，避免把每次渲染的新函数当成重建会话的依据
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!accountId) {
      sessionRef.current?.destroy();
      sessionRef.current = null;
      setSession(null);
      setUi(null);
      return;
    }
    const deps: NoteSaveSessionDeps = {
      noteId,
      accountId,
      draftRef,
      getRole: () => optionsRef.current.getRole(),
      isCollabActive: () => optionsRef.current.isCollabActive(),
      isOnline: () => optionsRef.current.isOnline(),
      isTaskNoteLinkEnabled: () => optionsRef.current.isTaskNoteLinkEnabled(),
      transport: optionsRef.current.createTransport(),
      consumeSkipFlush: () => optionsRef.current.consumeSkipFlush(),
      timers: {
        setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
        clearTimeout: (handle) => clearTimeout(handle),
      },
      randomId: () =>
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      debounceMs: 900,
      callbacks: {
        onUiState: () => {
          if (sessionRef.current) setUi(sessionRef.current.getUiState());
        },
        onNotesChanged: () => {
          window.dispatchEvent(new CustomEvent("organize:notes-changed"));
        },
        onSaved: (info) => {
          optionsRef.current.onSaved?.(info);
        },
      },
    };
    const created = createNoteSaveSession(deps);
    sessionRef.current = created;
    setSession(created);
    setUi(created.getUiState());
    return () => {
      created.destroy();
      if (sessionRef.current === created) {
        sessionRef.current = null;
      }
    };
  }, [noteId, accountId, draftRef]);

  return { session: sessionRef.current, ui };
}
