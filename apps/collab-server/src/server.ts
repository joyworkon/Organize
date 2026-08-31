// 实时协作 WebSocket 服务（P5-03，ADR 0003）
//
// 职责：Yjs 文档的鉴权中继——每个房间 = 一篇笔记（documentName = "note:<uuid>"）。
//   1. 鉴权：token 必须是 Supabase Auth 的 access token，用 anon key 调
//      auth.getUser(token) 验真（不信任客户端自报的 uid）
//   2. 授权：以该用户自己的 JWT 调 PostgREST 的 resource_role('note', id)——
//      063 的唯一判定链，服务端不自建第二套权限逻辑
//   3. viewer 连接置 readOnly（服务端丢弃其更新），owner/editor 可写
//
// 刻意不做（登记 ADR/ROADMAP，验证通过后再生产化）：
//   - 文档持久化：文档存内存，重启即失。可读快照由客户端经
//     save_note_with_tasks_v2(expected_revision = null) 节流落库（版本/任务链/归属
//     全部复用既有触发器），ydoc blob 持久化是下一张卡
//   - 房间限流/审计
import { Server } from "@hocuspocus/server";
import { createClient } from "@supabase/supabase-js";

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

    return { userId, role };
  },
});

server.listen().then(() => {
  console.log(`[collab] listening on ws://0.0.0.0:${PORT}`);
});
