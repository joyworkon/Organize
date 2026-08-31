"use client";

import { useMemo, useState } from "react";
import {
  Crown,
  Loader2,
  LogOut,
  Pencil,
  Trash2,
  UserMinus,
  UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showConfirm, showPrompt } from "@/components/ui/prompt-dialog";
import { createClient } from "@/lib/supabase/client";
import { colorFromUserId } from "@/hooks/use-note-collab";
import { useWorkspaces } from "@/hooks/use-workspaces";
import {
  workspaceMemberRoleLabel,
  type WorkspaceMemberRole,
} from "@/lib/collab/roles";
import {
  friendlyWorkspaceError,
  type WorkspaceMemberView,
  type WorkspaceView,
} from "@/lib/collab/workspace";

/**
 * 协作空间管理页（P5 后续产品卡，补齐 P5-02 卡 4 登记的遗留）。
 *
 * 063 的空间管理 RPC（改角色 / 移除成员 / 移交属主 / 建空间）此前没有界面：
 * 本页消费它们 + 属主直更 workspaces 行（重命名，RLS 只放行 owner）+
 * 解散空间（RLS "Owner can delete team workspace"，级联撤销全部授权）。
 * 邀请成员不在本页：仍走笔记分享面板（邀请与授权是同一动作，见 ADR 0002）。
 */
export default function SpacesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { workspaces, myUserId, loading, error, refresh } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const createWorkspace = async () => {
    const name = await showPrompt({
      title: "新协作空间的名称：",
      placeholder: "例如：产品组",
      confirmText: "创建",
    });
    if (name === null || !name.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("create_workspace", {
        p_name: name.trim(),
        p_invitees: [],
      });
      if (rpcErr) throw new Error(friendlyWorkspaceError(rpcErr));
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <PageHeader
        title="协作空间"
        description="管理你参与的协作空间：成员角色、移除、属主移交。邀请成员请使用笔记的分享面板。"
        icon={UsersRound}
        actions={
          <Button onClick={() => void createWorkspace()} disabled={creating} className="gap-1.5">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UsersRound className="h-4 w-4" />}
            新建协作空间
          </Button>
        }
      />

      {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="space-y-2 py-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button className="text-sm text-primary hover:underline" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="还没有协作空间"
            description="在笔记的分享面板邀请第一位协作者时会自动创建；也可以用右上角按钮先建一个空空间。"
          />
        ) : (
          workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              myUserId={myUserId}
              supabase={supabase}
              refresh={refresh}
              onError={setActionError}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ----------------------------- 单个空间卡片 ----------------------------- */

function WorkspaceCard({
  workspace,
  myUserId,
  supabase,
  refresh,
  onError,
}: {
  workspace: WorkspaceView;
  myUserId: string | null;
  supabase: ReturnType<typeof createClient>;
  refresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const isOwner = workspace.myRole === "owner";
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [disbanding, setDisbanding] = useState(false);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusyMember(key);
    onError("");
    try {
      await action();
    } catch (e) {
      onError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyMember(null);
    }
  };

  const renameWorkspace = async () => {
    const name = await showPrompt({
      title: "空间名称：",
      defaultValue: workspace.name,
      confirmText: "重命名",
    });
    if (name === null || !name.trim() || name.trim() === workspace.name) return;
    await run(`rename:${workspace.id}`, async () => {
      const { error } = await supabase
        .from("workspaces")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", workspace.id);
      if (error) throw new Error(friendlyWorkspaceError(error));
      await refresh();
    });
  };

  const disbandWorkspace = async () => {
    const confirmed = await showConfirm({
      title: `解散「${workspace.name}」？`,
      description:
        "空间与全部成员关系、以及通过它授予的笔记 / 阅读 / 任务授权都会立即撤销，不可恢复。",
      confirmText: "解散空间",
      destructive: true,
    });
    if (!confirmed) return;
    setDisbanding(true);
    onError("");
    try {
      const { error } = await supabase.from("workspaces").delete().eq("id", workspace.id);
      if (error) throw new Error(friendlyWorkspaceError(error));
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "解散失败");
    } finally {
      setDisbanding(false);
    }
  };

  const changeRole = (member: WorkspaceMemberView, role: WorkspaceMemberRole) => {
    void run(`role:${member.userId}`, async () => {
      const { error } = await supabase.rpc("update_workspace_member_role", {
        p_workspace_id: workspace.id,
        p_user_id: member.userId,
        p_role: role,
      });
      if (error) throw new Error(friendlyWorkspaceError(error));
      await refresh();
    });
  };

  const removeMember = (member: WorkspaceMemberView) => {
    void (async () => {
      const confirmed = await showConfirm({
        title: `把 ${member.displayName || "该成员"} 移出「${workspace.name}」？`,
        description: "移出后对方将失去这个空间内被授权的全部内容访问。",
        confirmText: "移出",
        destructive: true,
      });
      if (!confirmed) return;
      await run(`remove:${member.userId}`, async () => {
        const { error } = await supabase.rpc("remove_workspace_member", {
          p_workspace_id: workspace.id,
          p_user_id: member.userId,
        });
        if (error) throw new Error(friendlyWorkspaceError(error));
        await refresh();
      });
    })();
  };

  const transferOwnership = (member: WorkspaceMemberView) => {
    void (async () => {
      const confirmed = await showConfirm({
        title: `把「${workspace.name}」的所有权移交给 ${member.displayName || "该成员"}？`,
        description: "移交后你将变为普通成员，只有新属主能管理成员与重命名空间。",
        confirmText: "移交所有权",
      });
      if (!confirmed) return;
      await run(`transfer:${member.userId}`, async () => {
        const { error } = await supabase.rpc("transfer_workspace_ownership", {
          p_workspace_id: workspace.id,
          p_new_owner_user_id: member.userId,
        });
        if (error) throw new Error(friendlyWorkspaceError(error));
        await refresh();
      });
    })();
  };

  const leaveWorkspace = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: `退出「${workspace.name}」？`,
        description: "退出后你将失去这个空间内被授权的全部内容访问。",
        confirmText: "退出空间",
        destructive: true,
      });
      if (!confirmed || !myUserId) return;
      await run(`leave:${workspace.id}`, async () => {
        const { error } = await supabase.rpc("remove_workspace_member", {
          p_workspace_id: workspace.id,
          p_user_id: myUserId,
        });
        if (error) throw new Error(friendlyWorkspaceError(error));
        await refresh();
      });
    })();
  };

  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold">
            {workspace.name}
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {isOwner ? "你是所有者" : workspaceMemberRoleLabel(workspace.myRole)}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {workspace.members.length} 名成员
            {isOwner ? " · 重命名、成员管理与移交仅属主可用" : " · 仅所有者能管理成员"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isOwner && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void renameWorkspace()}
                disabled={renaming || busyMember !== null}
                className="gap-1.5 text-muted-foreground"
              >
                {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                重命名
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void disbandWorkspace()}
                disabled={disbanding || busyMember !== null}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {disbanding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                解散
              </Button>
            </>
          )}
          {!isOwner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void leaveWorkspace()}
              disabled={busyMember !== null}
              className="gap-1.5 text-muted-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出空间
            </Button>
          )}
        </div>
      </header>

      <ul className="divide-y">
        {workspace.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isWorkspaceOwner={isOwner}
            busy={busyMember !== null && busyMember.split(":")[1] === member.userId}
            onRoleChange={changeRole}
            onRemove={removeMember}
            onTransfer={transferOwnership}
          />
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------- 成员行 ----------------------------- */

function MemberAvatar({ member }: { member: WorkspaceMemberView }) {
  const name = member.displayName || "?";
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像是用户档案里的任意远程 URL，无法预配 next/image 域名
      <img
        src={member.avatarUrl}
        alt={name}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium text-white"
      style={{ backgroundColor: colorFromUserId(member.userId) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function MemberRow({
  member,
  isWorkspaceOwner,
  busy,
  onRoleChange,
  onRemove,
  onTransfer,
}: {
  member: WorkspaceMemberView;
  isWorkspaceOwner: boolean;
  busy: boolean;
  onRoleChange: (member: WorkspaceMemberView, role: WorkspaceMemberRole) => void;
  onRemove: (member: WorkspaceMemberView) => void;
  onTransfer: (member: WorkspaceMemberView) => void;
}) {
  const isRowOwner = member.role === "owner";
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <MemberAvatar member={member} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {member.displayName || "未设置昵称"}
            {member.isMe && <span className="ml-1.5 text-xs text-muted-foreground">（我）</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {workspaceMemberRoleLabel(member.role)}
            {isRowOwner && <Crown className="ml-1 inline h-3 w-3 align-[-1px]" />}
          </p>
        </div>
      </div>

      {isRowOwner ? (
        <span className="shrink-0 text-xs text-muted-foreground">空间属主</span>
      ) : isWorkspaceOwner ? (
        <div className="flex shrink-0 items-center gap-1">
          <Select
            value={member.role}
            onValueChange={(value) => onRoleChange(member, value as WorkspaceMemberRole)}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-[92px]">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">成员</SelectItem>
              <SelectItem value="guest">访客</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            title="移交所有权"
            onClick={() => onTransfer(member)}
            disabled={busy}
            className="h-8 w-8 text-muted-foreground"
          >
            <Crown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="移出空间"
            onClick={() => onRemove(member)}
            disabled={busy}
            className="h-8 w-8 text-destructive hover:text-destructive"
          >
            <UserMinus className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
