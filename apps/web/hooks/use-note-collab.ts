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

/**
 * 鉴权失败重试退避（A05-2 D1）：token 过期/被撤权时服务端回 PermissionDenied，
 * provider 不会自动重试（WS 保持打开、文档连接未建立）。这里按退避重握手，
 * 每次重连 token 函数都会重新取会话——覆盖「JWT 刚好过期、autoRefresh 已续好」
 * 的自愈窗口；3 次仍失败视为确定性拒绝（撤权/分享关闭），降级 error。
 */
const AUTH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
/** 连接门控超时（A05-2 D4）：首个会话这么久仍未完成首次同步 → 降级本地保存 */
const GATE_TIMEOUT_MS = 10_000;

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
  /**
   * 匿名公开链接协作（Track B 072）：传入分享令牌则跳过会话查询，
   * 连接 token = "share:<anonymousToken>"，collab-server 经 resolve_share_access
   * 实时判权（editor 可写 / viewer 服务端置只读）。
   */
  anonymousToken?: string;
}

export interface NoteCollab {
  provider: HocuspocusProvider | null;
  /** 同房间其他协作者（不含自己） */
  peers: CollabPeer[];
  /** 首次同步至少完成过一次（内容可信）。降级后保持 true：已同步的内容仍可用，分享编辑器据此继续 HTTP 保存兜底 */
  synced: boolean;
  connected: boolean;
  status: CollabStatus;
  selfClientId: number | null;
  /** 自己的光标色（匿名出席为临时随机 id 的色，供页面拼 collab.user） */
  selfColor: string;
  /**
   * 会话定形（A05 设计 §3.1）：未配置协作 / 已完成首次同步 / 已降级 error。
   * false = 首次同步尚未完成——页面应暂缓可编辑、草稿恢复等会改内容的交互：
   * 此刻输入会打进即将被重建掉的编辑器实例（A04 丢字窗口），把本地草稿
   * setContent 进尚未同步的空 ydoc 则会造成内容翻倍（A04 CRDT 翻倍）。
   * 降级后不再自动恢复协作（单向转换，刷新页面重新进入）。
   */
  resolved: boolean;
}

/**
 * 笔记实时协作会话（P5-03，ADR 0003；072 匿名公开链接分支；A05 会话健壮性）。
 *
 * 一个房间 = 一篇笔记（"note:<uuid>"）。登录用户 token 用 token 函数每次
 * 重连/服务端重验时现取会话 access token（supabase autoRefresh 下总是新鲜值），
 * collab 服务端验签后按 resource_role 判权（viewer 连接在服务端置只读）；
 * 匿名用户 token 用 "share:<分享令牌>"，服务端按 resolve_share_access 判权。
 * 关闭（未配置 / mock）时返回 provider=null，页面走既有乐观锁保存主链。
 *
 * 降级语义（status="error"）：鉴权重试耗尽 / 门控超时 / 退出登录。页面据此回退
 * 非协作编辑器，本页生命周期内不再自动重试协作。
 */
export function useNoteCollab({
  noteId,
  enabled,
  displayName,
  anonymousToken,
}: UseNoteCollabOptions): NoteCollab {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<CollabStatus>(enabled ? "connecting" : "off");
  const [selfColor, setSelfColor] = useState("");
  // 退出登录/切换账号的代际号：变化即重建会话（旧 provider 带着旧 token 不该续命）
  const [authEpoch, setAuthEpoch] = useState(0);
  // 显示名异步解析，重建 provider 只取决于 enabled/noteId；名字变化仅刷新 awareness
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  // 匿名出席身份：临时随机 id 只决定光标色，跨重连保持本实例稳定
  const anonIdRef = useRef<string>("");
  if (anonymousToken && !anonIdRef.current) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    anonIdRef.current = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 账号事件（A05 D8）：退出/切换账号时旧连接立即销毁。SIGNED_OUT 直接换代；
  // SIGNED_IN 时 user id 与本会话建立者不同（同页切换账号）同样换代。
  useEffect(() => {
    if (!enabled || anonymousToken) return;
    const supabase = createClient();
    let lastUserId: string | null = null;
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setAuthEpoch((epoch) => epoch + 1);
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        const uid = session?.user?.id ?? null;
        if (lastUserId !== null && uid !== lastUserId) {
          setAuthEpoch((epoch) => epoch + 1);
        }
        lastUserId = uid;
      }
    });
    return () => authSub.subscription.unsubscribe();
  }, [enabled, anonymousToken]);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    let active: HocuspocusProvider | null = null;
    let authRetries = 0;
    let settled = false; // 首次同步完成或降级：门控定时器终结（一次性）
    let dead = false; // 降级/卸载：此后不再任何重试（单向）
    let gateTimer: ReturnType<typeof setTimeout> | null = null;
    let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (gateTimer) {
        clearTimeout(gateTimer);
        gateTimer = null;
      }
      if (authRetryTimer) {
        clearTimeout(authRetryTimer);
        authRetryTimer = null;
      }
    };
    const degrade = () => {
      if (cancelled || dead) return;
      dead = true;
      settled = true;
      clearTimers();
      active?.destroy();
      active = null;
      setProvider(null);
      setStatus("error");
      setConnected(false);
    };
    setStatus("connecting");
    // 门控计时从会话建立起点算（A05 实测教训）：若从 provider 创建起算，
    // 会话查询路径挂死（supabase 调用不返回）时 provider 永不创建、门控永不触发，
    // 页面停留在 connecting 只读。10s 内未完成首次同步（含 provider 未创建）即降级。
    gateTimer = setTimeout(() => {
      if (!settled) degrade();
    }, GATE_TIMEOUT_MS);

    void (async () => {
      let myColor: string;
      if (anonymousToken) {
        // 匿名：不查会话/档案（也没有），出席名用「访客」，颜色来自临时随机 id
        myColor = colorFromUserId(anonIdRef.current);
      } else {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        // 无会话（理论上到不了这——middleware 已拦截）：立即降级而非挂等门控
        if (cancelled) return;
        if (!session?.access_token) {
          degrade();
          return;
        }
        // 颜色用 session 内的 user id 即可（E2E 实测教训：这里多打一次 getUser 网络调用，
        // 本地 Auth 偶发 15s+ 不返回，会把 provider 创建连同页面门控一起挂死）
        myColor = colorFromUserId(session.user?.id ?? "");
      }
      if (cancelled) return;

      const wsUrl = process.env.NEXT_PUBLIC_COLLAB_WS_URL!;
      setSelfColor(myColor);
      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      const p = new HocuspocusProvider({
        url: wsUrl,
        name: `note:${noteId}`,
        // token 用函数（A05 核心）：每次 WS onOpen（首连/重连/重试握手）与服务端
        // TokenSync 重验请求都会重新求值——登录用户拿到刷新后的 JWT，不再是一
        // 次性的过期凭证；匿名分享令牌恒定。
        token: anonymousToken
          ? () => `share:${anonymousToken}`
          : async () => {
              const {
                data: { session: s },
              } = await createClient().auth.getSession();
              return s?.access_token ?? "";
            },
        document: ydoc,
        awareness,
        onStatus: ({ status: wsStatus }) => {
          setConnected(wsStatus === "connected");
          // 首次同步完成前如实反映握手阶段；降级后不再翻回（单向转换）
          setStatus((prev) =>
            prev === "error"
              ? prev
              : wsStatus === "connected"
                ? "connected"
                : "connecting"
          );
        },
        onAuthenticationFailed: ({ reason }) => {
          if (cancelled || dead) return;
          if (authRetries >= AUTH_RETRY_DELAYS_MS.length) {
            degrade();
            return;
          }
          const delay = AUTH_RETRY_DELAYS_MS[authRetries];
          authRetries += 1;
          console.warn("[collab] 鉴权失败，退避重握手", { reason, attempt: authRetries });
          authRetryTimer = setTimeout(() => {
            if (cancelled || dead || !active) return;
            // disconnect+connect 触发完整重握手：onOpen → sendToken → token 函数
            // 重新取会话（不重建 provider 对象，监听器与 ydoc 原地保留）
            active.disconnect();
            void active.connect();
          }, delay);
        },
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

      p.on("synced", () => {
        if (settled) return;
        settled = true;
        // 首次同步完成：解除门控（effect 起点的计时器在此回收）
        if (gateTimer) {
          clearTimeout(gateTimer);
          gateTimer = null;
        }
        setSynced(true);
      });
      awarenessRef.current = awareness;
      setProvider(p);
    })();

    return () => {
      cancelled = true;
      settled = true;
      dead = true;
      clearTimers();
      active?.destroy();
      setProvider(null);
      setPeers([]);
      setSynced(false);
      setConnected(false);
      awarenessRef.current = null;
    };
    // authEpoch 重建会话：退出/切换账号后用新身份重新握手
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayName 经 ref 传递，不参与重建
  }, [enabled, noteId, anonymousToken, authEpoch]);

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
    selfColor,
    resolved: !enabled || synced || status === "error",
  };
}
