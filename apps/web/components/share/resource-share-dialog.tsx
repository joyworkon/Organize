"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Users,
  Link2,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  UserPlus,
  ArrowLeftRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { collabRoleLabel, type CollabRole } from "@/lib/collab/roles";
import { showConfirm } from "@/components/ui/prompt-dialog";
import type { ShareResourceType } from "@organize/shared";

interface ResourceShareDialogProps {
  /** 资源域：笔记页传 'note'，文章详情页传 'reading_item'（069） */
  resourceType: ShareResourceType;
  resourceId: string;
  /** 我对这个资源的角色；owner 才能改授权，其余只读浏览 */
  myRole: CollabRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface WorkspaceRow {
  id: string;
  name: string;
  kind: string;
}

/** 按 resourceType 取文案（面板标题 / 描述 / 移交确认框） */
const COPY: Record<
  ShareResourceType,
  { noun: string; title: string; ownerDesc: string; collaboratorDesc: string; transferConfirm: string }
> = {
  note: {
    noun: "笔记",
    title: "分享笔记",
    ownerDesc: "把笔记授权给协作空间，空间成员即可按角色访问；也可创建公开链接。",
    collaboratorDesc: "你是这篇笔记的协作者，只有所有者可以管理分享设置。",
    transferConfirm:
      "移交给 {name} 后：笔记引用的任务将连同子任务一并转移并脱离你原有的任务层级；标签会复制给对方；你的公开链接将被移除；你仍以协作者身份保留访问。",
  },
  reading_item: {
    noun: "文章",
    title: "分享文章",
    ownerDesc: "把文章授权给协作空间，空间成员即可按角色访问；也可创建公开链接。",
    collaboratorDesc: "你是这篇文章的协作者，只有所有者可以管理分享设置。",
    transferConfirm:
      "移交给 {name} 后：文章的划线高亮将随文章转移；标签会复制给对方；你笔记、任务、经验里指向这篇文章的关联会解除；你的公开链接将被移除；你仍以协作者身份保留访问。",
  },
};

function rpcErrorMessage(error: { message?: string } | null, noun: string): string {
  const message = error?.message || "操作失败";
  if (message.includes("not workspace owner")) return "只有空间所有者能这样做";
  if (message.includes("not resource controller")) return `只有${noun}所有者能修改授权`;
  // 068/069 移交属主：服务端拒绝原因如实翻译（fail-closed 的每一种显式拒绝）
  if (message.includes("recipient must have editor access"))
    return `对方还没有这篇${noun}的编辑权限，请先在上方授权为「可编辑」`;
  if (
    message.includes("only the note owner can transfer") ||
    message.includes("only the article owner can transfer")
  )
    return `只有${noun}所有者能移交`;
  if (message.includes("has a parent page") || message.includes("has child pages"))
    return "只支持移交顶层且没有子页面的笔记，请先在页面树中调整";
  if (message.includes("in trash")) return `垃圾箱里的${noun}不能移交，请先恢复`;
  if (message.includes("also referenced by another note"))
    return "笔记里的某个任务还被你的其他笔记引用，请先在那篇笔记中解除该任务块";
  if (message.includes("crosses the transfer boundary"))
    return "笔记里的任务存在跨任务依赖，请先解除依赖再移交";
  return message;
}

/** 资源域 → 移交 RPC 名（068 notes 域 / 069 reading_items 域；tasks 域为后续卡） */
function transferRpcName(resourceType: ShareResourceType): string {
  return resourceType === "note" ? "transfer_note_ownership" : "transfer_reading_item_ownership";
}

/**
 * 协作分享面板（P5-02 卡 4 引入，069 泛化到 reading_items 域）。
 *
 * 权限模型是「资源授权给空间」（ADR 0002）：没有点对点成员表，邀请一个人 =
 * 把他拉进某个协作空间（或新建空间），再把资源 grant 给那个空间。三段式：
 *   ① 协作空间：我所在的空间 × 这个资源的当前授权（grant/revoke_resource）
 *   ② 邀请协作者：邮箱 → find_user_by_email 精确换 user_id → 进空间 → 授权
 *   ③ 公开链接：沿用 /api/share（与协作 ACL 相互独立的表现层）
 * 属主另有 ④ 移交属主（068 notes / 069 reading_items）。
 *
 * mock 后端：空间/授权查询为空集，管理 RPC 显式报错（mock-client 的
 * P5-02-MOCK），面板如实展示错误 —— 不假装分享成功。
 */
export function ResourceShareDialog({
  resourceType,
  resourceId,
  myRole,
  open,
  onOpenChange,
}: ResourceShareDialogProps) {
  const isOwner = myRole === "owner";
  const copy = COPY[resourceType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{isOwner ? copy.ownerDesc : copy.collaboratorDesc}</DialogDescription>
        </DialogHeader>

        {isOwner ? (
          <OwnerShareSections resourceType={resourceType} resourceId={resourceId} />
        ) : (
          <CollaboratorGrants resourceType={resourceType} resourceId={resourceId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- 属主视图 ----------------------------- */

function OwnerShareSections({
  resourceType,
  resourceId,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const copy = COPY[resourceType];
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [grants, setGrants] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyWs, setBusyWs] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 我所在的协作空间（RLS：成员可见自己参与的空间）；mock 下为空集。
      // 个人空间只有自己一人，授权给它没有意义，不进列表。
      const { data: wsRows, error: wsErr } = await supabase
        .from("workspaces")
        .select("id, name, kind")
        .eq("kind", "team")
        .order("created_at", { ascending: true });
      if (wsErr) throw new Error(wsErr.message);
      // 这个资源在「我能看到的空间」上的授权（resource_acl 客户端只读，写走 RPC）
      const { data: grantRows, error: grantErr } = await supabase
        .from("resource_acl")
        .select("workspace_id, access_role")
        .eq("resource_type", resourceType)
        .eq("resource_id", resourceId);
      if (grantErr) throw new Error(grantErr.message);
      setWorkspaces((wsRows || []) as WorkspaceRow[]);
      setGrants(new Map((grantRows || []).map((row) => [row.workspace_id, row.access_role])));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "加载协作空间失败");
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId, supabase]);

  useEffect(() => {
    // Dialog 打开时才挂载本组件，mount 即加载
    void loadData();
  }, [loadData]);

  const setGrant = async (workspaceId: string, role: "viewer" | "editor" | null) => {
    setBusyWs(workspaceId);
    setActionError(null);
    try {
      if (role === null) {
        const { error } = await supabase.rpc("revoke_resource", {
          p_resource_type: resourceType,
          p_resource_id: resourceId,
          p_workspace_id: workspaceId,
        });
        if (error) throw new Error(rpcErrorMessage(error, copy.noun));
      } else {
        const { error } = await supabase.rpc("grant_resource", {
          p_resource_type: resourceType,
          p_resource_id: resourceId,
          p_workspace_id: workspaceId,
          p_access_role: role,
        });
        if (error) throw new Error(rpcErrorMessage(error, copy.noun));
      }
      await loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyWs(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            协作空间
          </span>
          {workspaces.length > 0 && (
            <Link href="/spaces" className="text-xs font-normal text-primary hover:underline">
              管理成员
            </Link>
          )}
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有协作空间。在下方邀请第一位协作者时会自动创建。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {workspaces.map((ws) => {
              const current = grants.get(ws.id);
              return (
                <li
                  key={ws.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ws.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {current ? collabRoleLabel(current as CollabRole) : "未共享"}
                    </p>
                  </div>
                  <Select
                    value={current === "editor" || current === "viewer" ? current : "none"}
                    onValueChange={(value) =>
                      void setGrant(ws.id, value === "none" ? null : (value as "viewer" | "editor"))
                    }
                    disabled={busyWs === ws.id}
                  >
                    <SelectTrigger className="h-8 w-[110px]">
                      {busyWs === ws.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未共享</SelectItem>
                      <SelectItem value="viewer">可查看</SelectItem>
                      <SelectItem value="editor">可编辑</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <InviteSection resourceType={resourceType} resourceId={resourceId} onDone={loadData} />

      <PublicLinkSection resourceType={resourceType} resourceId={resourceId} />

      <TransferOwnershipSection resourceType={resourceType} resourceId={resourceId} />

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
    </div>
  );
}

/* ----------------------------- 邀请协作者 ----------------------------- */

function InviteSection({
  resourceType,
  resourceId,
  onDone,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
  onDone: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [workspaceChoice, setWorkspaceChoice] = useState<string>("__new__");
  const [newWsName, setNewWsName] = useState("");
  const [teamWorkspaces, setTeamWorkspaces] = useState<WorkspaceRow[]>([]);
  const [matched, setMatched] = useState<{ user_id: string; display_name: string | null } | null>(null);
  const [notFoundEmail, setNotFoundEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [sending, setSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      // 邀请目标只能是 team 空间（个人空间天然只有自己一个人）
      const { data } = await supabase
        .from("workspaces")
        .select("id, name, kind")
        .order("created_at", { ascending: true });
      const teamOnly = ((data || []) as WorkspaceRow[]).filter((ws) => ws.kind === "team");
      setTeamWorkspaces(teamOnly);
      setWorkspaceChoice(teamOnly.length > 0 ? teamOnly[0].id : "__new__");
    })();
  }, [supabase]);

  const checkEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setChecking(true);
    setMatched(null);
    setNotFoundEmail(null);
    setInviteSent(false);
    setError(null);
    setDone(false);
    try {
      // 唯一查人入口：精确等值（不前缀/不通配/不列举）；mock 下显式报错
      const { data, error: rpcErr } = await supabase.rpc("find_user_by_email", {
        p_email: trimmed,
      });
      if (rpcErr) throw new Error(rpcErrorMessage(rpcErr, COPY[resourceType].noun));
      const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as Array<{
        user_id: string;
        display_name: string | null;
      }>;
      if (rows.length === 0) {
        // 未注册邮箱 → 走邮箱邀请（Track A）：对方注册后自动获得访问权
        setNotFoundEmail(trimmed);
      } else {
        setMatched(rows[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "查找用户失败");
    } finally {
      setChecking(false);
    }
  };

  const invite = async () => {
    if (!matched) return;
    setInviting(true);
    setError(null);
    try {
      let targetWorkspaceId = workspaceChoice;
      if (workspaceChoice === "__new__") {
        const name = newWsName.trim() || "协作空间";
        const { data: wsId, error: createErr } = await supabase.rpc("create_workspace", {
          p_name: name,
          p_invitees: [matched.user_id],
        });
        if (createErr) throw new Error(rpcErrorMessage(createErr, COPY[resourceType].noun));
        targetWorkspaceId = wsId as string;
      } else {
        const { error: addErr } = await supabase.rpc("add_workspace_member", {
          p_workspace_id: targetWorkspaceId,
          p_user_id: matched.user_id,
          p_role: "member",
        });
        if (addErr) throw new Error(rpcErrorMessage(addErr, COPY[resourceType].noun));
      }
      const { error: grantErr } = await supabase.rpc("grant_resource", {
        p_resource_type: resourceType,
        p_resource_id: resourceId,
        p_workspace_id: targetWorkspaceId,
        p_access_role: role,
      });
      if (grantErr) throw new Error(rpcErrorMessage(grantErr, COPY[resourceType].noun));
      setDone(true);
      setEmail("");
      setMatched(null);
      setNewWsName("");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setInviting(false);
    }
  };

  const sendInvite = async () => {
    if (!notFoundEmail) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/share/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_type: resourceType,
          resource_id: resourceId,
          access_role: role,
          email: notFoundEmail,
          workspace_id: workspaceChoice === "__new__" ? undefined : workspaceChoice,
          new_workspace_name:
            workspaceChoice === "__new__" ? newWsName.trim() || "协作空间" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "邀请发送失败");
      setInviteSent(true);
      setEmail("");
      setNotFoundEmail(null);
      setNewWsName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请发送失败");
    } finally {
      setSending(false);
    }
  };

  // 角色/空间选择在「已注册邀请」与「未注册邮箱邀请」两个分支间复用
  const inviteControls = (
    <>
      <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "editor")}>
        <SelectTrigger className="h-8 w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="editor">可编辑</SelectItem>
          <SelectItem value="viewer">可查看</SelectItem>
        </SelectContent>
      </Select>
      <Select value={workspaceChoice} onValueChange={setWorkspaceChoice}>
        <SelectTrigger className="h-8 w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teamWorkspaces.map((ws) => (
            <SelectItem key={ws.id} value={ws.id}>
              加入 {ws.name}
            </SelectItem>
          ))}
          <SelectItem value="__new__">新建协作空间…</SelectItem>
        </SelectContent>
      </Select>
      {workspaceChoice === "__new__" && (
        <Input
          placeholder="新空间名称"
          value={newWsName}
          onChange={(e) => setNewWsName(e.target.value)}
          className="h-8 w-[150px]"
        />
      )}
    </>
  );

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <UserPlus className="h-4 w-4" />
        邀请协作者
      </h3>
      <p className="text-xs text-muted-foreground">
        按注册邮箱精确查找（不支持模糊搜索）。对方会加入所选协作空间，并获得本篇内容的访问权。
      </p>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="对方注册邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void checkEmail();
          }}
        />
        <Button variant="outline" onClick={() => void checkEmail()} disabled={checking || !email.trim()}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "查找"}
        </Button>
      </div>
      {matched && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm">
            找到用户：<span className="font-medium">{matched.display_name || "未设置昵称"}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {inviteControls}
            <Button size="sm" onClick={() => void invite()} disabled={inviting}>
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "邀请并授权"}
            </Button>
          </div>
        </div>
      )}
      {notFoundEmail && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm">
            「<span className="font-medium">{notFoundEmail}</span>」尚未注册，
            可发送邀请邮件，对方注册后会自动获得访问权。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {inviteControls}
            <Button size="sm" onClick={() => void sendInvite()} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "发送邀请邮件"}
            </Button>
          </div>
        </div>
      )}
      {done && <p className="text-sm text-green-600">已邀请并完成授权</p>}
      {inviteSent && (
        <p className="text-sm text-green-600">
          邀请邮件已发送，对方点击链接注册后会自动获得访问权
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/* ----------------------------- 协作者只读视图 ----------------------------- */

function CollaboratorGrants({
  resourceType,
  resourceId,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Array<{ wsName: string; role: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: grantRows, error } = await supabase
          .from("resource_acl")
          .select("workspace_id, access_role")
          .eq("resource_type", resourceType)
          .eq("resource_id", resourceId);
        if (error) throw new Error(error.message);
        const names = new Map<string, string>();
        const wsIds = (grantRows || []).map((row) => row.workspace_id);
        if (wsIds.length > 0) {
          const { data: wsRows } = await supabase.from("workspaces").select("id, name").in("id", wsIds);
          for (const ws of wsRows || []) names.set(ws.id, ws.name);
        }
        if (!active) return;
        setRows(
          (grantRows || []).map((row) => ({
            wsName: names.get(row.workspace_id) || "协作空间",
            role: row.access_role,
          }))
        );
      } catch {
        if (active) setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [resourceType, resourceId, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">这篇内容通过协作空间与你共享。</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row, index) => (
        <li key={index} className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="truncate text-sm">{row.wsName}</span>
          <span className="text-xs text-muted-foreground">{collabRoleLabel(row.role as CollabRole)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------- 移交属主（068/069） ----------------------------- */

interface CandidateUser {
  user_id: string;
  name: string | null;
}

/**
 * 移交资源属主（transfer_note_ownership 068 / transfer_reading_item_ownership 069）。
 * 只列「当前已持有 editor 授权」的协作者——移交是交给既有协作者（先共享后移交），
 * RPC 端会用同一判定链权威复核。
 *
 * 连带语义（两个迁移头注释的拍板，确认框必须如实交代）：
 *   - note：引用任务连同子任务转移；有跨笔记引用 / 跨界依赖 / 父子页面时显式拒绝；
 *   - reading_item：划线高亮随文章转移（NOT NULL 锚点，唯一无损选项），
 *     旧属主笔记/任务/经验的关联解除；
 *   - 共同：标签按同名复制、公开链接移除、移交后原属主仍以协作者保留访问。
 * mock 后端：候选为空（无协作空间），RPC 显式报错由面板如实展示。
 */
function TransferOwnershipSection({
  resourceType,
  resourceId,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data: grantRows, error: grantErr } = await supabase
          .from("resource_acl")
          .select("workspace_id, access_role")
          .eq("resource_type", resourceType)
          .eq("resource_id", resourceId);
        if (grantErr) throw new Error(grantErr.message);
        // 有 editor 授权的空间，其成员即候选（成员资格 + 空间授权 = 可编辑）
        const editorWorkspaceIds = (grantRows || [])
          .filter((row) => row.access_role === "editor" || row.access_role === "owner")
          .map((row) => row.workspace_id);
        if (editorWorkspaceIds.length === 0) {
          if (active) setCandidates([]);
          return;
        }
        const { data: memberRows, error: memberErr } = await supabase
          .from("workspace_members")
          .select("user_id")
          .in("workspace_id", editorWorkspaceIds);
        if (memberErr) throw new Error(memberErr.message);
        const userIds = [...new Set((memberRows || []).map((m) => m.user_id))].filter(
          (uid) => uid && uid !== user?.id
        );
        if (userIds.length === 0) {
          if (active) setCandidates([]);
          return;
        }
        // 共享空间成员的档案可见（064）；查不到名字时回退「成员」
        const { data: profileRows } = await supabase
          .from("user_profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        const names = new Map(
          (profileRows || []).map((p) => [p.user_id, p.display_name as string | null])
        );
        if (!active) return;
        setCandidates(
          userIds.map((uid) => ({ user_id: uid, name: names.get(uid) ?? null }))
        );
      } catch {
        // 候选加载失败按空集处理（协作功能整体不可用时段典型如此），不阻塞其他段
        if (active) setCandidates([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [resourceType, resourceId, supabase]);

  const transfer = async () => {
    if (!selected) return;
    const target = candidates.find((c) => c.user_id === selected);
    const ok = await showConfirm({
      title: "移交属主？",
      description: COPY[resourceType].transferConfirm.replace("{name}", target?.name || "该协作者"),
      confirmText: "移交",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc(transferRpcName(resourceType), {
        [resourceType === "note" ? "p_note_id" : "p_item_id"]: resourceId,
        p_new_owner: selected,
      });
      if (rpcErr) throw new Error(rpcErrorMessage(rpcErr, COPY[resourceType].noun));
      // 角色已变更：整页重载，让页面按新角色重建保存/写入管线
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移交失败");
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <ArrowLeftRight className="h-4 w-4" />
        移交属主
      </h3>
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          还没有可移交的协作者。先在上方邀请并把对方设为「可编辑」。
        </p>
      ) : (
        <div className="flex gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder="选择协作者" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>
                  {c.name || "协作者"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void transfer()}
            disabled={busy || !selected}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            移交
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/* ----------------------------- 公开链接 ----------------------------- */

type ShareAccessMode = "disabled" | "public_read" | "public_edit";
type ShareExpiryChoice = "never" | "7d" | "30d";

const ACCESS_MODE_LABELS: Record<ShareAccessMode, string> = {
  disabled: "关闭",
  public_read: "公开只读",
  public_edit: "公开可编辑",
};

function expiryDateFromChoice(choice: ShareExpiryChoice): string | null {
  if (choice === "never") return null;
  const days = choice === "7d" ? 7 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function PublicLinkSection({
  resourceType,
  resourceId,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
}) {
  const [share, setShare] = useState<{
    token: string;
    url: string;
    is_public: boolean;
    access_mode: ShareAccessMode;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [patching, setPatching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 072：过期时间选择（建议默认 7 天，§6 非协商项），创建与改模式共用
  const [expiry, setExpiry] = useState<ShareExpiryChoice>("7d");

  const loadShare = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share?resource_type=${resourceType}&resource_id=${resourceId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setShare(
        data
          ? {
              token: data.token,
              url: data.url,
              is_public: data.is_public,
              access_mode: (data.access_mode ?? (data.is_public ? "public_read" : "disabled")) as ShareAccessMode,
            }
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    void loadShare();
  }, [loadShare]);

  const createShare = async (accessMode: Exclude<ShareAccessMode, "disabled">) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_type: resourceType,
          resource_id: resourceId,
          access_mode: accessMode,
          expires_at: expiryDateFromChoice(expiry),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
      const data = await res.json();
      setShare({ token: data.token, url: data.url, is_public: data.is_public, access_mode: data.access_mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  // 072：三态即时切换（disabled ↔ public_read ↔ public_edit），每次切换立即生效——
  // 服务端各通道按实时 shares 行判权，改回只读/关闭即刻断掉匿名快照保存与实时写
  const patchAccessMode = async (mode: ShareAccessMode) => {
    if (!share || patching) return;
    setPatching(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: share.token,
          access_mode: mode,
          ...(mode !== "disabled" ? { expires_at: expiryDateFromChoice(expiry) } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "修改失败");
      }
      const data = await res.json();
      setShare({ token: data.token, url: data.url, is_public: data.is_public, access_mode: data.access_mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setPatching(false);
    }
  };

  const revokeShare = async () => {
    if (!share) return;
    if (!confirm("确定撤销这个公开链接？撤销后链接立即失效。")) return;
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
      });
      if (!res.ok) throw new Error("撤销失败");
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤销失败");
    }
  };

  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${share.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  };

  const fullUrl = share?.url
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${share.url}`
    : "";

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Link2 className="h-4 w-4" />
        公开链接
      </h3>
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : share ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input readOnly value={fullUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => void copyLink()} title="复制链接">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={share.access_mode}
              onValueChange={(v) => void patchAccessMode(v as ShareAccessMode)}
              disabled={patching}
            >
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACCESS_MODE_LABELS) as ShareAccessMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {ACCESS_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={expiry} onValueChange={(v) => setExpiry(v as ShareExpiryChoice)}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 天后过期</SelectItem>
                <SelectItem value="30d">30 天后过期</SelectItem>
                <SelectItem value="never">不过期</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {share.access_mode === "public_edit" && (
            <p className="text-xs text-destructive">
              任何持此链接者均可编辑本篇内容，可随时改回只读或关闭。
            </p>
          )}
          {!share.is_public && (
            <p className="text-xs text-muted-foreground">该分享已关闭公开访问</p>
          )}
          <div className="flex items-center justify-between">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 text-sm hover:underline ${
                share.is_public ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在新窗口打开
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revokeShare()}
              className="gap-1.5 text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              撤销分享
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            创建公开链接，任何人不登录也能查看；也可设为「公开可编辑」与他人实时协作（与上方协作授权相互独立）。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={expiry} onValueChange={(v) => setExpiry(v as ShareExpiryChoice)}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 天后过期</SelectItem>
                <SelectItem value="30d">30 天后过期</SelectItem>
                <SelectItem value="never">不过期</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void createShare("public_read")}
              disabled={creating}
              className="gap-1.5"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              创建公开只读链接
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void createShare("public_edit")}
              disabled={creating}
              className="gap-1.5"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              创建公开可编辑链接
            </Button>
          </div>
          <p className="text-xs text-destructive">
            「公开可编辑」意味着任何持链接者（含未注册访客）都能编辑，建议保留默认 7 天过期。
          </p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
