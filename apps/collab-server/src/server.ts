// 实时协作 WebSocket 服务（P5-03，ADR 0003；067 生产化卡补齐持久化）
//
// 职责：Yjs 文档的鉴权中继 + CRDT blob 存储——每个房间 = 一篇笔记
// （documentName = "note:<uuid>"）。
//   1. 鉴权：token 必须是 Supabase Auth 的 access token，用 anon key 调
//      auth.getUser(token) 验真（不信任客户端自报的 uid）
//   2. 授权：以该用户自己的 JWT 调 PostgREST 的 resource_role('note', id)——
//      063 的唯一判定链，服务端不自建第二套权限逻辑
//   3. viewer 连接置 readOnly（服务端丢弃其更新），owner/editor 可写
//   4. 持久化（067）：
//      - onLoadDocument：经 get_note_ydoc 回放 blob（新鲜度规则由 RPC 内判——
//        notes.updated_at 更新时返回 null，走播种路径，防止旧 CRDT 遮蔽
//        非协作写入的内容）
//      - onStoreDocument：Hocuspocus 内置防抖后经 save_note_ydoc 落库
//        encodeStateAsUpdate 全量快照（base64）。以最后写者的 JWT 调用，
//        失败只记日志不炸房间（可读内容仍由客户端 v2 节流快照兜底）
//   5. 播种租约（seed-lease.ts）：房间为空时只允许一个客户端播种，
//      根除「两客户端并发进入空房间各自播种出重复段落」的竞态
//
// 客户端快照与 blob 的分工：notes.content（可读事实源）由客户端经
// save_note_with_tasks_v2(expected_revision = null) 节流落库；本进程只维护
// CRDT blob（回放缓存）。blob 可随时从 content 重建，不进备份。
import { Server } from "@hocuspocus/server";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { SeedLease } from "./seed-lease";

const PORT = Number(process.env.PORT ?? 1420);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("[collab] 缺少 SUPABASE_URL / SUPABASE_ANON_KEY 环境变量");
  process.exit(1);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDocumentName(name: string): { noteId: string } | null {
  const prefix = "note:";
  if (!name.startsWith(prefix)) return null;
  const id = name.slice(prefix.length);
  return UUID_RE.test(id) ? { noteId: id } : null;
}

interface CollabContext {
  userId: string;
  role: "owner" | "editor" | "viewer";
  /** 发起连接时的 access token（blob 读写 RPC 以它调用；过期后落库失败仅记日志） */
  token: string;
}

// anon key 仅用于 auth.getUser(token) 验签与携带用户 JWT 调 PostgREST，
// 不持有任何 service 权限
const authClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function asUserClient(token: string) {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// 每房间一份播种租约 + 最后写者 token（onStoreDocument 的 lastContext 即最后
// 写者，token 在此仅作 context 缺失时的兜底）
const rooms = new Map<string, { lease: SeedLease; lastWriterToken: string | null }>();

function roomState(documentName: string) {
  let state = rooms.get(documentName);
  if (!state) {
    state = { lease: new SeedLease(), lastWriterToken: null };
    rooms.set(documentName, state);
  }
  return state;
}

const server = new Server<CollabContext>({
  port: PORT,

  async onAuthenticate({ token, documentName, connectionConfig }) {
    console.log("[auth] begin", documentName, "tokenLen", token?.length);
    const parsed = parseDocumentName(documentName);
    if (!parsed) { console.log("[auth] bad name"); throw new Error("bad document name"); }

    // 1. 验 token：拿不到用户即拒（getUser 会向 Supabase Auth 验签）
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) {
      console.log("[auth] getUser failed:", userError?.message);
      throw new Error("unauthorized");
    }
    console.log("[auth] user ok", userData.user.id);
    const userId = userData.user.id;

    // 2. 以用户自己的 JWT 查 063 的唯一判定链
    const { data: role, error: roleError } = await asUserClient(token).rpc(
      "resource_role",
      { p_resource_type: "note", p_resource_id: parsed.noteId }
    );
    if (roleError) {
      console.log("[auth] role rpc failed:", roleError.message);
      throw new Error("forbidden");
    }
    console.log("[auth] role:", role);
    if (role !== "owner" && role !== "editor" && role !== "viewer") {
      // 无任何授权：不区分「不存在」与「无权限」（对齐 065 的口径）
      throw new Error("forbidden");
    }

    // 3. viewer 只读：服务端丢弃该连接的更新（客户端编辑器本身也是不可编辑态）
    connectionConfig.isAuthenticated = true;
    connectionConfig.readOnly = role === "viewer";
    console.log("[auth] done, readOnly =", role === "viewer");

    return { userId, role, token };
  },

  // 回放 blob（067）。null = 无 blob / 过期 / 无权——都走客户端播种路径
  async onLoadDocument({ document, documentName, context }) {
    const parsed = parseDocumentName(documentName);
    if (!parsed || !context?.token) return;

    const { data: b64, error } = await asUserClient(context.token).rpc(
      "get_note_ydoc",
      { p_note_id: parsed.noteId }
    );
    if (error) {
      console.log("[ydoc] load failed:", error.message);
      return; // 播种路径兜底，不阻断房间
    }
    if (b64) {
      Y.applyUpdate(document, new Uint8Array(Buffer.from(b64, "base64")));
      console.log("[ydoc] replayed", documentName, "bytes", b64.length);
    }
    if (!document.isEmpty("default")) {
      roomState(documentName).lease.markSeeded();
    }
  },

  async onChange({ documentName, context }) {
    const state = roomState(documentName);
    // 任何内容更新都终结播种阶段（含回放后的首次编辑）
    state.lease.markSeeded();
    if (context?.role !== "viewer") state.lastWriterToken = context?.token ?? null;
  },

  // Hocuspocus 内置防抖（默认 2s / 上限 10s）后调用；lastContext = 最后写者
  async onStoreDocument({ document, documentName, lastContext }) {
    const parsed = parseDocumentName(documentName);
    if (!parsed) return;

    const token =
      lastContext?.role && lastContext.role !== "viewer"
        ? lastContext.token
        : roomState(documentName).lastWriterToken;
    if (!token) {
      console.log("[ydoc] no writer token, skip persist", documentName);
      return;
    }

    const b64 = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const { error } = await asUserClient(token).rpc("save_note_ydoc", {
      p_note_id: parsed.noteId,
      p_ydoc_b64: b64,
    });
    if (error) {
      // 常见于会话 JWT 过期或权限被撤：fail-closed，可读内容仍有客户端快照兜底
      console.log("[ydoc] persist failed:", error.message);
      return;
    }
    console.log("[ydoc] persisted", documentName, "bytes", b64.length);
  },

  // 播种租约仲裁：协议见 seed-lease.ts 文件头
  async onStateless({ connection, documentName, payload }) {
    let msg: { t?: string };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.t !== "seed-req") return;

    const decision = roomState(documentName).lease.request();
    console.log("[seed]", documentName, decision);
    connection.sendStateless(JSON.stringify({ t: `seed-${decision}` }));
  },

  // 房间卸载即回收租约；重开时 blob/播种状态重新协商，无跨会话状态
  async afterUnloadDocument({ documentName }) {
    rooms.delete(documentName);
  },
});

server.listen().then(() => {
  console.log(`[collab] listening on ws://0.0.0.0:${PORT}`);
});
