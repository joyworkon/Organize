"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { TipTapEditor, type TransactionSource } from "@/components/editor/tiptap-editor";
import { useNoteCollab } from "@/hooks/use-note-collab";

const SAVE_THROTTLE_MS = 3000;

interface PublicShareEditorProps {
  token: string;
  noteId: string;
  /** 服务端渲染时的原始内容快照：空房间播种用 */
  seedContent: Record<string, unknown> | null;
}

/**
 * 匿名可编辑公开链接（Track B 072，分叉 2-B）。
 *
 * - 实时：useNoteCollab 匿名分支（token = share:<token>），与登录用户共享同一房间；
 *   落库双通道 = collab-server 的 CRDT blob + 本组件经 /api/public-share/[token]/save
 *   的节流快照（save_public_note 属主 scope 写）。
 * - 快照乐观锁传 null（节流覆盖写，与协作在线时 v2 的口径一致）：房间里的 Y.Doc
 *   才是本会话的事实源，服务端 RPC 内仍有内容护栏。
 * - 边界：任务勾选禁用（disableTaskItemToggle）、不提供标题编辑、无子资源入口。
 * - 降级：mock 后端 / 未配置 NEXT_PUBLIC_COLLAB_WS_URL → 只读静态视图 + 顶部提示。
 * - 断权：属主改回只读/关闭后，下一次快照保存会收到 forbidden，编辑器即时转只读。
 */
const EMPTY_DOC = { type: "doc", content: [] } as Record<string, unknown>;

/** 从 TipTap JSON 提取纯文本（播种判定用） */
function docText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  const content = node.content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => docText(c as Record<string, unknown>)).join("");
}

export default function PublicShareEditor({ token, noteId, seedContent }: PublicShareEditorProps) {
  const realBackend = process.env.NEXT_PUBLIC_MOCK_BACKEND !== "true";
  const wsConfigured = Boolean(process.env.NEXT_PUBLIC_COLLAB_WS_URL);
  const enabled = realBackend && wsConfigured;

  const collab = useNoteCollab({
    noteId,
    enabled,
    displayName: "访客",
    anonymousToken: token,
  });
  // collab.user 身份对象必须 memo：useEditor 以 collab?.user 为重建依赖，
  // 内联对象每帧换新会让编辑器无限重建（Maximum update depth 实测）
  const collabUser = useMemo(
    () => ({ name: "访客", color: collab.selfColor || "#6b7280" }),
    [collab.selfColor]
  );

  const lastJsonRef = useRef<Record<string, unknown> | null>(null);
  const savingRef = useRef(false);
  const forbiddenRef = useRef(false);
  // 播种判定：属主有内容时，快照必须仍包含种子文本才允许落库——协作编辑器在
  // 播种完成前是空文档，期间任何 user 来源事务（链接刷新 dispatch 等）产生的
  // 空/半空文档绝不能写快照（会把 DB 内容清掉）。
  // seedContent 为 null（本来就是空笔记）则不设此门。
  const seedText = useMemo(() => (seedContent ? docText(seedContent) : ""), [seedContent]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  const shouldSave = useCallback(
    (json: Record<string, unknown> | null): json is Record<string, unknown> =>
      !!json && !forbiddenRef.current && (!seedText || docText(json).includes(seedText)),
    [seedText]
  );

  const flushSave = useCallback(async () => {
    const json = lastJsonRef.current;
    // synced 前不上抛快照：Y.Doc 未同步/未播种时的空文档会把 DB 内容清掉
    // （与 notes 页「协作模式必须等首次同步后再补」同一合同）
    if (!shouldSave(json) || savingRef.current || !collab.synced) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/public-share/${token}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: json, expected_revision: null }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (data.status === "forbidden") {
        // 权限已被实时收回（改回只读/关闭/过期）：立即停写并置只读
        forbiddenRef.current = true;
        setRevoked(true);
        return;
      }
      if (!res.ok) {
        setNotice(data.error || "快照保存失败，内容仍在实时会话中");
      }
    } catch {
      setNotice("快照保存失败，内容仍在实时会话中");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [token, collab.synced, shouldSave]);

  // 协作会话在线时 Y.Doc 是事实源：节流把最新 JSON 覆盖写到快照通道
  useEffect(() => {
    if (!dirty || !enabled) return;
    const timer = setTimeout(() => {
      setDirty(false);
      void flushSave();
    }, SAVE_THROTTLE_MS);
    return () => clearTimeout(timer);
  }, [dirty, enabled, flushSave]);

  // 卸载/切页前尽力补一次快照（fetch keepalive，页面关闭也能发出）
  useEffect(() => {
    const handler = () => {
      if (!shouldSave(lastJsonRef.current) || !collab.synced) return;
      void fetch(`/api/public-share/${token}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lastJsonRef.current, expected_revision: null }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      handler();
    };
  }, [token, collab.synced, shouldSave]);

  // 只有「用户主动编辑」才标脏快照：hydrate（同步前的空文档/补块 id）与
  // remote-sync（对端编辑，对端自己会保存）都不写快照——否则同步窗口内的
  // 空文档会把 DB 内容清掉（notes 页同一合同的镜像）
  const handleUpdate = useCallback(
    (content: Record<string, unknown>, source: TransactionSource) => {
      if (source !== "user") return;
      lastJsonRef.current = content;
      setDirty(true);
    },
    []
  );

  // 降级：mock 后端 / WS 未配置 → 只读静态视图（不假成功）
  if (!enabled) {
    return (
      <>
        <Notice
          tone="muted"
          text="当前环境不支持匿名实时编辑，以下为只读视图。"
        />
        <TipTapEditor
          noteId={noteId}
          content={seedContent ?? EMPTY_DOC}
          editable={false}
          onUpdate={() => {}}
        />
      </>
    );
  }

  return (
    <>
      {notice && (
        <Notice tone="warning" text={notice} onClose={() => setNotice(null)} />
      )}
      {revoked ? (
        <Notice
          tone="warning"
          text="分享者已关闭可编辑权限，当前为只读视图。"
        />
      ) : null}
      {!collab.synced && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在进入实时会话…
        </div>
      )}
      <div className="relative">
        <TipTapEditor
          noteId={noteId}
          content={seedContent ?? EMPTY_DOC}
          editable={collab.synced && !revoked}
          disableTaskItemToggle
          collab={
            // 绑定协作必须等首次同步完成：synced 一到，播种租约请求是房间里的
            // 第一个动作（UniqueID 的 onCreate 也要等编辑器创建——此时不再有
            // 「同步即抢跑补 id」把服务端播种阶段提前结束的竞态）
            collab.provider && collab.synced
              ? {
                  provider: collab.provider,
                  user: collabUser,
                  seedContent,
                }
              : null
          }
          onUpdate={handleUpdate}
        />
        {saving && (
          <div className="absolute bottom-2 right-4 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            保存中…
          </div>
        )}
      </div>
    </>
  );
}

function Notice({
  tone,
  text,
  onClose,
}: {
  tone: "muted" | "warning";
  text: string;
  onClose?: () => void;
}) {
  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        tone === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {tone === "warning" && <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{text}</span>
      {onClose && (
        <button onClick={onClose} className="text-xs hover:underline">
          知道了
        </button>
      )}
    </div>
  );
}
