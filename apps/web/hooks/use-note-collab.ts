"use client";

import { useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createClient } from "@/lib/supabase/client";

export interface CollabPeer {
  clientId: number;
  user: { name: string; color: string };
}

export type CollabStatus = "off" | "connecting" | "connected" | "error";

const CURSOR_COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];

export function colorFromUserId(userId: string): string {
  const hash = Number.parseInt(userId.slice(0, 8), 16);
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

interface UseNoteCollabOptions {
  noteId: string;
  /** 协作开关：真实后端 + 显式配置 NEXT_PUBLIC_COLLAB_WS_URL + 角色已判定 */
  enabled: boolean;
  /** 光标/出席显示名（页面侧已解析好档案名，hook 不再查库） */
  displayName: string;
}

export interface NoteCollab {
  provider: HocuspocusProvider | null;
  /** 同房间其他协作者（不含自己） */
  peers: CollabPeer[];
  synced: boolean;
  connected: boolean;
  status: CollabStatus;
  selfClientId: number | null;
}

/**
 * 笔记实时协作会话（P5-03，ADR 0003）。
 *
 * 一个房间 = 一篇笔记（"note:<uuid>"）。token 用当前会话的 Supabase access token，
 * collab 服务端验签后按 resource_role 判权（viewer 连接在服务端置只读）。
 * 关闭（未配置 / mock）时返回 provider=null，页面走既有乐观锁保存主链。
 */
export function useNoteCollab({ noteId, enabled, displayName }: UseNoteCollabOptions): NoteCollab {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<CollabStatus>(enabled ? "connecting" : "off");
  const [selfColor, setSelfColor] = useState("");
  // 显示名异步解析，重建 provider 只取决于 enabled/noteId；名字变化仅刷新 awareness
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    let active: HocuspocusProvider | null = null;
    setStatus("connecting");

    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token || cancelled) return;

      const wsUrl = process.env.NEXT_PUBLIC_COLLAB_WS_URL!;
      const myColor = colorFromUserId((await supabase.auth.getUser()).data.user?.id ?? "");
      setSelfColor(myColor);
      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      const p = new HocuspocusProvider({
        url: wsUrl,
        name: `note:${noteId}`,
        token,
        document: ydoc,
        awareness,
        onStatus: ({ status: s }) => setConnected(s === "connected"),
      });
      if (cancelled) {
        p.destroy();
        return;
      }
      active = p;

      // CollaborationCursor 扩展会把 user 写进 awareness；这里先补一次，
      // 让出席栏在编辑器扩展就绪前也能显示自己
      awareness.setLocalStateField("user", { name: displayNameRef.current, color: myColor });

      const updatePeers = () => {
        const states = awareness.getStates();
        const list: CollabPeer[] = [];
        states.forEach((state, clientId) => {
          if (state.user && clientId !== awareness.clientID) {
            list.push({ clientId, user: state.user });
          }
        });
        setPeers(list);
      };
      awareness.on("change", updatePeers);
      updatePeers();

      p.on("synced", () => setSynced(true));
      awarenessRef.current = awareness;
      setProvider(p);
      setStatus("connected");
    })();

    return () => {
      cancelled = true;
      active?.destroy();
      setProvider(null);
      setPeers([]);
      setSynced(false);
      setConnected(false);
      awarenessRef.current = null;
    };
  }, [enabled, noteId]);

  // 名字解析晚于会话建立时（罕见），刷新本地 awareness 的 user 字段
  const awarenessRef = useRef<Awareness | null>(null);
  useEffect(() => {
    if (awarenessRef.current && selfColor) {
      awarenessRef.current.setLocalStateField("user", { name: displayName, color: selfColor });
    }
  }, [provider, displayName, selfColor]);

  return {
    provider,
    peers,
    synced,
    connected,
    status,
    selfClientId: awarenessRef.current?.clientID ?? null,
  };
}
