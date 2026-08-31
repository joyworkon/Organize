/**
 * 协作空间管理（P5 后续产品卡）的视图模型装配与文案映射。
 *
 * 数据面：063 RLS 允许成员直读 workspaces / workspace_members；姓名头像经 064
 * 的 user_profiles（「共享空间 ⇒ 档案可见」）；写面全部走 063 RPC（改角色 /
 * 移除 / 移交 / 建空间）或属主直更 workspaces 行（重命名，RLS 只放行 owner）。
 * 本模块不做任何查询——只把行拼成 UI 模型、把服务端错误翻成可读文案。
 */
import { isWorkspaceMemberRole, type WorkspaceMemberRole } from "./roles";

export interface WorkspaceMemberView {
  userId: string;
  role: WorkspaceMemberRole;
  displayName: string | null;
  avatarUrl: string | null;
  joinedAt: string | null;
  isMe: boolean;
}

export interface WorkspaceView {
  id: string;
  name: string;
  kind: string;
  ownerId: string;
  createdAt: string;
  /** 我在该空间的成员角色（owner/member/guest，决定我能看到哪些管理操作） */
  myRole: WorkspaceMemberRole;
  /** 属主排最前，其余按加入时间；不含任何「我无权读取的隐藏行」 */
  members: WorkspaceMemberView[];
}

interface RawWorkspaceRow {
  id: string;
  name: string;
  kind: string;
  owner_id: string;
  created_at: string;
}

interface RawMemberRow {
  workspace_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

interface RawProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * 把三份查询行装配成页面视图模型。
 * - 个人空间（kind=personal）不进管理页：只有自己一人，没有可管理的成员关系。
 * - myRole 优先取成员行；成员行缺失时属主按 owner_id 兜底为 owner，
 *   其余按 guest 兜底（RLS 能读到空间行的只有属主/成员，guest 是防御值）。
 */
export function buildWorkspaceRows(
  workspaceRows: RawWorkspaceRow[],
  memberRows: RawMemberRow[],
  profileRows: RawProfileRow[],
  myUserId: string
): WorkspaceView[] {
  const profiles = new Map(profileRows.map((row) => [row.id, row]));

  const membersByWorkspace = new Map<string, RawMemberRow[]>();
  for (const row of memberRows) {
    const list = membersByWorkspace.get(row.workspace_id) ?? [];
    list.push(row);
    membersByWorkspace.set(row.workspace_id, list);
  }

  return workspaceRows
    .filter((ws) => ws.kind === "team")
    .map((ws) => {
      const rawMembers = (membersByWorkspace.get(ws.id) ?? [])
        .slice()
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
          return a.joined_at.localeCompare(b.joined_at);
        });

      const members: WorkspaceMemberView[] = rawMembers.map((row) => {
        const profile = profiles.get(row.user_id);
        return {
          userId: row.user_id,
          role: isWorkspaceMemberRole(row.role) ? row.role : "guest",
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          joinedAt: row.joined_at,
          isMe: row.user_id === myUserId,
        };
      });

      const myMemberRow = members.find((member) => member.isMe);
      const myRole: WorkspaceMemberRole = myMemberRow
        ? myMemberRow.role
        : ws.owner_id === myUserId
          ? "owner"
          : "guest";

      return {
        id: ws.id,
        name: ws.name,
        kind: ws.kind,
        ownerId: ws.owner_id,
        createdAt: ws.created_at,
        myRole,
        members,
      };
    });
}

/**
 * 063 管理 RPC 的错误消息翻成可读中文；未识别的消息原样透出。
 * 与 note-share-dialog 的 rpcErrorMessage 同思路，但覆盖空间管理域的错误。
 */
export function friendlyWorkspaceError(error: { message?: string } | null): string {
  const message = error?.message || "操作失败";
  if (message.includes("not workspace owner")) return "只有空间所有者能这样做";
  if (message.includes("transfer ownership first")) return "属主需先移交所有权才能退出或移除";
  if (message.includes("new owner must be a member")) return "新属主必须是该空间的成员";
  if (message.includes("already owner")) return "该成员已经是所有者";
  if (message.includes("workspace not found")) return "空间不存在或已被解散";
  if (message.includes("user not found")) return "该用户不存在";
  if (message.includes("invitee not found")) return "该邮箱没有对应的注册账号";
  if (message.includes("bad role")) return "成员角色不合法";
  if (message.includes("workspace name required")) return "请填写空间名称";
  // 未识别的消息（含 mock 的 P5-02-MOCK 显式报错）原样透出，由页面如实展示
  return message;
}
