// 存量连接周期重验（A05-3，设计 docs/collab-session-refresh-design.md §3.2/§3.3）。
//
// 协议：服务端每 REAUTH_INTERVAL_MS 对已建立连接 connection.requestToken() →
// 客户端回 Auth(Token)（provider 的 token 函数重新求值——登录用户拿到刷新后的
// JWT）→ onTokenSync 用同一判定链重验，按本模块的纯策略决定处置：
//   update：身份一致且仍有权 → 就地更新 context（token/role），readOnly 同步
//           （editor→viewer 降级无需重连，每条消息检查即生效；viewer→editor 升级同理）
//   close ：无权（撤权/链接关闭/角色为 null）或身份漂移（连接被移花接木、
//           token 形态漂移）→ onTokenSync 抛错 → 上游关闭连接（Unauthorized）
//
// 撤权生效窗口 = REAUTH_INTERVAL + 客户端重试退避（默认 5min + ≤17s，见设计 §3.3）；
// 持久化路径（save_note_ydoc*）按最后写者 token 调用，撤权立即失败，不受窗口约束。

export type CollabRole = "owner" | "editor" | "viewer";

/** 重验身份结论（与 server.ts 的 CollabContext 判定链输出对齐） */
export interface ReauthIdentity {
  userId: string;
  role: CollabRole;
  anonymous: boolean;
}

export type ReauthDecision =
  | { action: "update"; identity: ReauthIdentity; readOnly: boolean }
  | { action: "close" };

/**
 * 纯策略：previous（连接建立时的身份）× fresh（重验结论）→ 处置。
 * anonymous 的 userId 恒为 "anon"（无账号概念），token 即身份。
 */
export function decideReauth(
  previous: ReauthIdentity,
  fresh: ReauthIdentity | null
): ReauthDecision {
  if (!fresh) return { action: "close" };
  // token 形态漂移（share: ↔ JWT）：连接身份模型变了，按被接管处理
  if (previous.anonymous !== fresh.anonymous) return { action: "close" };
  // 登录连接验出的 user id 必须与建立时一致（同页切换账号应重建连接，不该复用）
  if (!fresh.anonymous && previous.userId !== fresh.userId) {
    return { action: "close" };
  }
  return { action: "update", identity: fresh, readOnly: fresh.role === "viewer" };
}

/** 默认 5 分钟；环境变量可覆盖（E2E 用小间隔），下限 1s 防病态值 */
export function parseReauthIntervalMs(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 300_000;
  return Math.max(1_000, Math.floor(value));
}
