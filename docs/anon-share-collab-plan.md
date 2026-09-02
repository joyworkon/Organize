# 任务书:笔记分享给未注册用户(查看 + 编辑)

> 本文件是给**执行 Agent** 的冷启动任务书。你没有前置上下文也能照此实施。
> 先读「0. 上手须知」与「1. 背景」,再按「4. Track A」「5. Track B」逐卡执行。
> 每张卡都给了:改动清单、确切文件路径、关键代码/RPC 签名、易踩的坑、验收标准、验证命令。

---

## 0. 上手须知(仓库约定,必须遵守)

- **包管理器只用 pnpm**(不要 npm/yarn)。Node 22 LTS。monorepo 用 Turborepo。
- **协作分支流程**(`master` 受保护,禁止直接 push):
  ```bash
  git checkout master && git pull origin master      # 每次开工先同步(本地 master 常是旧的)
  git checkout -b feat/<短描述>                        # 一张卡 = 一条分支 = 一个 PR
  # 改代码 → 本地验证 → push → gh pr create → gh pr merge --squash → 删分支 → 切回 master 拉最新
  ```
  一次只在一条分支上工作。CI(`.github/workflows/ci.yml`)会在 PR 上跑 `tsc --noEmit` + `vitest run`,不过不要合并。
- **改动后的验证命令**(在对应目录执行):
  ```bash
  cd apps/web && npx tsc --noEmit                    # 类型检查(0 error 才算过)
  cd apps/web && pnpm test                           # 等价 npx vitest run
  supabase migration up                              # 应用新迁移(需 Docker:先 supabase start)
  supabase db test                                   # 跑 pgTAP(supabase/tests/*.test.sql)
  ```
- **Supabase 三条铁律**(违反必炸):
  1. 每张新表除了 RLS,**必须显式 GRANT 表级权限**给 anon/authenticated,否则写入报 `permission denied for table`。
  2. anon key 必须是 **JWT 格式**(`eyJ...`,取自 `supabase status -o json`),不认新版 `sb_publishable_`。
  3. SECURITY DEFINER 函数**必须自带 `auth.uid()` 校验与显式鉴权守卫**,并 `set search_path`(DEFINER 缺属主校验 = 开提权路径)。
- **DEFINER 判权的 NULL 陷阱**(血泪教训,见 `067_note_ydoc_store.sql:102`):
  判"角色不在白名单"要写 `if v_role is distinct from 'owner' and v_role is distinct from 'editor' then raise`,
  **绝不能**写 `if v_role not in ('owner','editor')`——当 `v_role` 为 NULL(陌生人/匿名)时整个表达式是 NULL,IF 不触发,写入会穿透。
- **React 副作用分离**:数据库写入不得放在 `setState` 更新器内,放 `useEffect` 或事件处理器。
- **pnpm 严格模式**:`@tiptap/core` 等必须是 `apps/web` 直接依赖。
- **mock 后端**(`NEXT_PUBLIC_MOCK_BACKEND=true`):协作层整体不启用(ADR 0003);mock 下新功能要么走 api-shim,要么**如实报错(503/501),不得假成功**。

---

## 1. 背景:当前协作/分享体系(已存在,勿重复造)

**登录用户之间的实时多人编辑已完整落地**(P5-01/02/03)。你要在此之上扩展"面向未注册用户"的能力,不要动这些既有链路的行为:

| 能力 | 位置 | 说明 |
|---|---|---|
| 权限唯一判定链 | 迁移 `063`,`public.resource_role('note',id)` → `owner`/`editor`/`viewer`/`null` | 所有 RLS/RPC/collab-server 都调它,不得另写等价判定 |
| 协作者只读可见性 | 迁移 `064`(三张主表加协作者 SELECT 策略)、`find_user_by_email`(精确查已注册账号) | |
| editor 保存 | 迁移 `065`,`save_note_with_tasks_v2(...)`(乐观锁 content_revision) | 属主走 v1 `save_note_with_tasks`,editor 走 v2 |
| 归属列 | 迁移 `066`,`notes.last_edit_by`(uuid,无 FK) | |
| 实时协同 | `apps/collab-server/src/server.ts`(Yjs CRDT + Hocuspocus WebSocket);`apps/web/hooks/use-note-collab.ts`;编辑器 `components/editor/tiptap-editor.tsx` 的 `collab` 属性 | 一笔一房间 `note:<uuid>`;viewer 服务端置 readOnly |
| CRDT blob 持久化 | 迁移 `067`,`note_ydocs` 表 + `get_note_ydoc`/`save_note_ydoc`(经 resource_role 判权,有**新鲜度规则**:仅 `blob.updated_at >= notes.updated_at` 才回放) | collab-server 无密钥,用连接者 JWT 调 RPC |
| 匿名只读公开链接 | 迁移 `006`+`018`,`shares` 表 + `get_public_share(token)` DEFINER RPC;页面 `apps/web/app/s/[token]/page.tsx`(服务端渲染静态 HTML);客户端解析 `apps/web/lib/share/public-share.ts` | **只能查看,不能编辑** |
| 分享面板 | `apps/web/components/share/resource-share-dialog.tsx`(协作空间授权 / 邀请 / 公开链接 / 移交属主) | |
| 公开链接 API | `apps/web/app/api/share/route.ts`(POST 创建 / GET 查 / DELETE 撤销;**当前无 PATCH**) | |
| 服务端 admin 客户端 | `apps/web/lib/supabase/admin.ts` 的 `createAdminClient()`(service role,缺 key 返回 null) | 已用于账号删除 / AI 设置 / cron |
| 认证回调 | `apps/web/app/auth/callback/route.ts`(`exchangeCodeForSession` + 跳 `next`,默认 `/library`) | |

**关键事实**(影响方案,已核实):
- `shares` 表**已排除在备份合同外**(`apps/web/lib/backup/schema.ts` 的 `REQUIRED_EXCLUSIONS` 含 `"shares"`)→ 给它加列**不动备份链**。
- `supabase/config.toml`:`enable_anonymous_sign_ins = false`、`enable_signup = true`、`enable_confirmations = false`;**未配置生产 SMTP**(本地 `local_smtp` 是测试服务 :54324,不真正发信)。
- `SUPABASE_SERVICE_ROLE_KEY` 已在 web 端 env 存在。
- **最新迁移号是 `070`**,新迁移从 `071` 起。
- `get_public_share` 返回的 payload **已含笔记 `id`** → 匿名客户端能拿到房间名 `note:<id>`。

---

## 2. 目标(用户已拍板)

给未注册用户两种获得"查看 + 编辑"权限的途径,**两者都要**,且匿名编辑要**实时协同**:
- **Track A 邮箱邀请 + 魔法链接**:邀请未注册邮箱 → 对方点链接自动建号 → 复用现有实时协作/ACL(低风险,先做)。
- **Track B 可编辑公开链接 + 匿名实时协同**:免登录,凭 URL 即可多人(匿名 + 登录用户)同时实时编辑(高风险,即 `docs/collaboration-plan.md` 分叉 2-B)。

**交付顺序**:PR1 = Track A(独立可上线);PR2 = Track B 后端/管线;PR3 = Track B 匿名实时端到端。每卡一个 PR,CI 绿了再合。

---

## 3. 不在本次范围(遇到就停,登记到 `BLOCKED.md` 或 PR 描述)
- 匿名编辑者的任务(taskItem)勾选变更、子资源(评论/版本列表对匿名开放)、匿名署名(`last_edit_by` 保持 null)。
- 匿名评论(`public_comment`)。
- 逐域属主迁移等既有 P5 后续待办。

---

## 4. Track A:邮箱邀请 + 魔法链接

### A1. 迁移 `supabase/migrations/071_share_invites.sql`

**建表 `share_invites`**:
```
id uuid pk default gen_random_uuid()
resource_type text not null check in ('note','reading_item')
resource_id uuid not null
workspace_id uuid not null            -- 兑现后对方加入的空间
access_role text not null check in ('viewer','editor')
email text not null                   -- 被邀请邮箱(小写存储)
invited_by uuid not null references auth.users(id) on delete cascade
invited_user_id uuid                  -- 可空:inviteUserByEmail 返回的预建 uid
token text not null unique            -- 兑现令牌(足够随机,同 /api/share 的 generateToken)
status text not null default 'pending' check in ('pending','accepted','revoked','expired')
created_at timestamptz default now()
expires_at timestamptz                -- 建议 now()+7d
accepted_at timestamptz
accepted_by uuid
```
- 索引:`(token)`、`(invited_by)`、`(lower(email))`。
- **RLS**:`invited_by = auth.uid()` 才可 select/insert/update/delete(属主管理自己的邀请)。被邀请人**不直读本表**,兑现走 DEFINER RPC。
- **GRANT**:select/insert/update/delete 给 authenticated(铁律 1)。

**DEFINER RPC `redeem_share_invite(p_token text) returns jsonb`**(`set search_path = pg_catalog, public`):
1. `auth.uid()` 为空 → 返回 `{status:'forbidden', reason:'anonymous'}`。
2. 按 token 取邀请;不存在 / `status<>'pending'` / 已过期 → `{status:'forbidden'}`(不区分原因,不泄漏存在性)。
3. 身份匹配:取当前用户 email(`auth.users` 或 `auth.jwt()`);满足 `auth.uid() = invited_user_id` **或** `lower(btrim(当前 email)) = lower(btrim(invite.email))`,否则 `{status:'forbidden', reason:'email_mismatch'}`。
4. 兑现(**关键坑**):**直接 INSERT** `workspace_members(workspace_id, auth.uid(), 'member')`(on conflict do nothing)与 `resource_acl(workspace_id, resource_type, resource_id, access_role, created_by=invited_by)`(on conflict 更新/忽略)。
   - **不要调用** `add_workspace_member` / `grant_resource`:那两函数内置"调用者须为空间 owner / 资源控制者"守卫,而兑现者是**被邀请人**(既非空间 owner 也非资源控制者),调用会被拒。`share_invites` 行本身即属主在创建时记录的**预授权**,由本 DEFINER 函数代为落地。
   - `resource_acl` 客户端只读(063 显式 revoke 了 insert/update/delete),但 DEFINER 绕过 RLS/表权限,可写。
5. 置 `status='accepted'`、`accepted_at=now()`、`accepted_by=auth.uid()`;返回 `{status:'ok', resource_type, resource_id}`。
- EXECUTE 给 authenticated(revoke from public)。

### A2. API `apps/web/app/api/share/invite/route.ts`(新)

- `POST`,`createAdminClient()`;为 null(缺 service key)→ 503 `{error:'邀请服务未配置(缺 SUPABASE_SERVICE_ROLE_KEY)'}`(参照 `apps/web/app/api/account/route.ts` 的 503 写法)。
- 用调用者 JWT(`createClient()` from `@/lib/supabase/server`)查 `resource_role(resource_type,resource_id)`;非 `'owner'` → 403。
- body:`{resource_type, resource_id, workspace_id?, access_role, email, new_workspace_name?}`。校验:resource_type ∈ {note,reading_item}、access_role ∈ {viewer,editor}、email 合法。
- `workspace_id` 缺省 → 以调用者身份调 `create_workspace(p_name:=new_workspace_name||'协作空间', p_invitees:='{}')` 拿新 team 空间 id。
- 以调用者身份 INSERT `share_invites`(invited_by=user.id,email=lower(trim),token=random,expires_at=now()+7d,status='pending')。
- 调 `admin.auth.inviteUserByEmail(email, { redirectTo: `${origin}/auth/callback?next=/invites/${token}` })`;把返回 `data.user.id` 回填该行 `invited_user_id`(update)。
- 返回 `{status:'invited', email}`。`inviteUserByEmail` 失败(如 SMTP 未配)→ 502 带脱敏错误。

### A3. 前端

- **改 `resource-share-dialog.tsx` 的 `InviteSection`**(约 349-353 行):`find_user_by_email` 返回 0 行时,把 `setError("该邮箱没有对应的注册账号")` 改为设置一个 `notFoundEmail` 状态,渲染"该邮箱尚未注册" + **"发送邀请邮件"按钮**(带角色/空间选择,复用现有 `role`/`workspaceChoice` state),点击调 `POST /api/share/invite`;成功提示"邀请邮件已发送,对方点击链接注册后会自动获得访问权"。
- **新页 `apps/web/app/(main)/invites/[token]/page.tsx`**(client):mount 后调 `supabase.rpc('redeem_share_invite',{p_token:token})`;`ok` → `router.replace('/notes/'+resource_id)`(reading_item 跳 `/library/<id>`);否则展示原因(过期/邮箱不符/已兑现/无权)。未登录时 middleware 会先引导登录再回来。
- `auth/callback/route.ts` **无需改**(`next` 已透传)。

### A4. 测试

- **pgTAP `supabase/tests/071_share_invites.test.sql`**(仿 `063_collaboration_acl.test.sql` 的身份切换:`SET ROLE authenticated` + `SET request.jwt.claim.sub`):
  - happy:正确 email/uid 兑现 → `workspace_members` + `resource_acl` 建成、access_role 正确、status=accepted。
  - 负例:邮箱不符 forbidden;过期 forbidden;重复兑现幂等(不产生第二条 acl/member、不报错);revoked forbidden;伪造 token forbidden;`auth.uid()` 为空 forbidden。
  - 结构断言:`redeem_share_invite` 的 `prosrc` **不含** `add_workspace_member`/`grant_resource`(钉住 A1 的坑)。
- **Vitest**:invite 路由的入参校验/503 分支(若逻辑抽成纯函数);`InviteSection` 未注册分支渲染(可选,jsdom)。

**Track A 验收**:A 邀请未注册邮箱 → 对方收到邮件点链接建号 → 落地 `/invites/<token>` 自动兑现 → 打开笔记即以 editor/viewer 身份进入**现有实时协作**(与已注册协作者体验一致)。`tsc --noEmit` 0 err、`vitest run` 绿、pgTAP 071 全绿。

---

## 5. Track B:可编辑公开链接 + 匿名实时协同

### B1. 迁移 `supabase/migrations/072_public_edit_shares.sql`

1. **加列**:`alter table public.shares add column if not exists access_mode text not null default 'public_read' check (access_mode in ('disabled','public_read','public_edit'))`。
2. **backfill + 一致性约束**(照抄 `docs/collaboration-plan.md` §4.1.2):`update shares set is_public=(access_mode<>'disabled')`;加约束 `(access_mode='disabled' and not is_public) or (access_mode<>'disabled' and is_public)`。
3. **改 `get_public_share`**(006/018/021 的现有 DEFINER):返回列增加 `access_mode`(取 shares 行);其余白名单(id/title/content 等)与 anon execute 不变。**同步改** `apps/web/lib/share/public-share.ts` 的 `PublicShareResult` 与 `parseRpcRow` 解析 `access_mode`。
4. **新 DEFINER `resolve_share_access(p_token text, p_resource_id uuid) returns text`**(stable,`set search_path=pg_catalog, public`):token 命中 shares 行 + `resource_id` 匹配 + 未过期(`expires_at is null or > now()`)→ `public_edit` 返回 `'editor'`、`public_read` 返回 `'viewer'`;其余一律 `null`(不区分不存在/无权)。EXECUTE 给 anon, authenticated。
5. **新 DEFINER `save_public_note(p_token, p_content jsonb, p_expected_note_revision int, p_title text default null, p_mutation_id uuid default null) returns jsonb`**(volatile):
   - 校验 token→未过期 `public_edit` 笔记分享;取 notes 行 `for update`;不满足 → `{status:'forbidden'}`(匿名统一 forbidden,不给 not_found 探针)。
   - **以属主 scope 写**(actor = share 的 owner_id,不是 auth.uid()):`update notes set content, title, content_revision=content_revision+1, last_edit_by=null`。
   - 乐观锁:`p_expected_note_revision` 非空且 `<> 当前 revision` → `{status:'conflict_note', current_revision, ...}`(与 v2 同形)。
   - **版本裁剪坑**:`save_note_version` 触发器(065)仅在 `auth.uid() is not null` 时调 `prune_note_versions_for`;匿名保存 `auth.uid()` 为 null → 不会裁剪。故本函数写完 notes 后**显式调用** `public.prune_note_versions_for(p_note_id, v_owner_id)`(该函数 internal-only,DEFINER 内可调)。
   - 幂等:可选用 `save_mutation_log`(按 token 而非 user 记账)或直接跳过——**建议跳过**,匿名快照本就是节流覆盖写。
   - EXECUTE 给 anon, authenticated。
6. **新 DEFINER token 版 ydoc RPC**(仿 067,**保持 collab-server 无密钥**):
   - `get_note_ydoc_by_token(p_token text, p_note_id uuid) returns text`:授权经 `resolve_share_access(p_token,p_note_id) in ('editor','viewer')`;沿用 067 **新鲜度规则**(`y.updated_at >= n.updated_at` 才返回 base64,否则 null);软删/无权/过期 → null。
   - `save_note_ydoc_by_token(p_token, p_note_id, p_ydoc_b64)`:授权须 `resolve_share_access = 'editor'`;判权用 `is distinct from`(NULL 陷阱);4MB 上限;upsert 覆盖。
   - EXECUTE 给 anon, authenticated。

### B2. collab-server `apps/collab-server/src/server.ts`

- `CollabContext` 加 `anonymous?: boolean`。
- **`onAuthenticate` 加匿名分支**:约定匿名连接的 provider `token` 以 `share:` 前缀携带分享令牌。
  ```
  if (token.startsWith('share:')) {
    const shareToken = token.slice(6);
    const { data: role } = await authClient.rpc('resolve_share_access',
      { p_token: shareToken, p_resource_id: parsed.noteId });   // authClient = anon key
    if (role !== 'editor' && role !== 'viewer') throw new Error('forbidden');
    connectionConfig.isAuthenticated = true;
    connectionConfig.readOnly = role === 'viewer';
    return { userId: 'anon', role, token: shareToken, anonymous: true };
  }
  // 否则走现有 auth.getUser(token) + resource_role 分支(不改)
  ```
- **`onLoadDocument`/`onStoreDocument`**:`context?.anonymous` 为真时改调 `get_note_ydoc_by_token`/`save_note_ydoc_by_token`(传 shareToken),否则现有 JWT 路径不变。
- 房间名仍 `note:<uuid>`,匿名与登录用户共享同一实时房间(匿名端从 `get_public_share` payload 拿 note id)。
- `onChange` 的 `lastWriterToken` 逻辑:匿名 token 也能作为写者凭证传给 `save_note_ydoc_by_token`。

### B3. 前端

- **`apps/web/hooks/use-note-collab.ts`**:`UseNoteCollabOptions` 加 `anonymousToken?: string`;`enabled` 时若提供该 token,**跳过** `supabase.auth.getSession()`(约 78-83 行),直接 `token = 'share:' + anonymousToken`,出席名/色用临时随机值(不查 `user_profiles`);其余(awareness/peers/synced)不变。
- **`apps/web/lib/share/public-share.ts`**:`PublicShareResult` 的 active-note 分支加 `access_mode: 'disabled'|'public_read'|'public_edit'`;`parseRpcRow` 解析。补 `public-share.test.ts` 断言。
- **`apps/web/app/s/[token]/page.tsx`**:按 `share.access_mode` 分支——`public_read`(及缺省)保持当前静态只读 HTML;`public_edit` 渲染新客户端组件 `<PublicShareEditor token={token} noteId={share.resource.id} seedContent={share.resource.content} />`。
- **新组件 `apps/web/components/share/public-share-editor.tsx`**(client):
  - 用 `useNoteCollab({ noteId, enabled: 真实后端 && NEXT_PUBLIC_COLLAB_WS_URL 已配, displayName:'访客', anonymousToken: token })`。
  - 渲染 `TiptapEditor`,`collab={{provider, user, seedContent}}`、`editable=true`;`onUpdate` 标脏 → 节流保存经 B4 路由。
  - **禁用 taskItem 勾选**(匿名不改任务):TiptapEditor 传只读任务交互或过滤该类事务(参照编辑器现有 `editable`/`filterTransaction` 用法)。
  - mock 后端 / WS 未配 → 降级为只读 + 顶部提示"当前环境不支持匿名实时编辑"。
- **`resource-share-dialog.tsx` 的 `PublicLinkSection`**(约 730-852 行):把"创建/撤销"升级为**三态模式选择**(关闭 disabled / 公开只读 public_read / 公开可编辑 public_edit)+ 过期时间输入 + 复制/打开/撤销。选"可编辑"时红字警示"任何持此链接者均可编辑,可随时改回只读或关闭"。创建走 `POST /api/share`(带 access_mode),改模式走 B4 的 `PATCH /api/share`。

### B4. API

- **改 `apps/web/app/api/share/route.ts`**:POST 接受并写入 `access_mode`(默认 public_read);**新增 PATCH**(属主 JWT,校验 `owner_id=user.id`)更新 `access_mode`/`expires_at`;GET/DELETE 返回体带上 `access_mode`。
- **新路由 `apps/web/app/api/public-share/[token]/save/route.ts`**:POST,做**按 token+IP 的内存限流**(简单 token-bucket,如每 token 每分钟 ≤ 30 次),再以 anon 客户端(`createClient` 无会话)调 `save_public_note`。匿名快照保存走此路由而非直暴 RPC,便于限流与滥用日志。body:`{content, expected_revision, title?}`,透传 RPC 的 jsonb 结果。

### B5. 测试

- **pgTAP `supabase/tests/072_public_edit_shares.test.sql`**:
  - access_mode 约束 + backfill(老行 = public_read);一致性约束生效。
  - `get_public_share` 返回 access_mode。
  - `resolve_share_access` 矩阵:public_edit→editor、public_read→viewer、disabled→null、过期→null、错 resource_id→null、伪造 token→null。
  - `save_public_note`:public_edit ok + `content_revision+1` + 写入属主行 + `last_edit_by is null`;public_read→forbidden;过期→forbidden;stale revision→conflict_note;错 note→forbidden;软删→forbidden。
  - token ydoc RPC:editor 读写、viewer 只读且写 raise forbidden、新鲜度规则(blob 落后→get 返回 null)。
  - 结构断言:`save_note_ydoc_by_token` 用 `is distinct from` 判权(可用 `prosrc` like 断言)。
- **Vitest**:`public-share.ts` 解析 access_mode;`useNoteCollab` 匿名 token 分支(mock getSession 不被调用);save 路由限流纯函数。
- **e2e `apps/web/e2e/`**(仿 `collab.spec.ts`,需真实后端 + collab-server):双浏览器打开同一 public_edit 链接并发输入不丢字 + 出席可见;public_read 链接不可编辑。

**Track B 验收**:属主把公开链接设为"可编辑" → 两个未登录浏览器打开 `/s/<token>` → 同时实时编辑、远端光标可见、刷新内容仍在(blob + 快照双通道);改回"只读/关闭"后匿名端立即失去写权;pgTAP 072 全绿、`tsc --noEmit` 0 err、`vitest run` 绿。

---

## 6. 安全非协商项(Track B 当初被推迟的原因,必须落实)

- **可撤销**:属主随时改 access_mode;`resolve_share_access`/`save_public_note`/token ydoc RPC 每次读**实时** shares 行 → 改回只读/关闭即刻断掉匿名写与实时连接。
- **过期**:public_edit 建议默认带过期(如 7 天),UI 显式提示。
- **限流**:B4 保存路由 + collab-server `onAuthenticate` 按 token/IP 限流,防刷。
- **最小权限**:collab-server **不引入 service role**,匿名一律走 token-scoped DEFINER RPC;所有 RPC `set search_path`、统一 forbidden/null(不泄漏存在性)。
- **已知缺口(写进 PR 描述与本文件 §3)**:匿名无 `last_edit_by` 归属;匿名不可改任务勾选。

---

## 7. 假设与外部依赖(执行前确认,缺则在 PR 说明)

- **生产 SMTP 必须配置**(Track A 邀请邮件投递;`supabase/config.toml` 的 `[auth.email.smtp]` 当前注释掉)。本地用 `local_smtp`(:54324)可看"发出的邮件"但不真发。
- `SUPABASE_SERVICE_ROLE_KEY` 已在 web 端(现有能力);collab-server **不需要**它。
- Track B 实时依赖已部署的 `apps/collab-server` + `NEXT_PUBLIC_COLLAB_WS_URL`(与现有协作一致)。
- 本地跑迁移/测试需 Docker:`supabase start` → `supabase migration up` → `supabase db test`。

---

## 8. 全局完成定义(DoD)

1. 三张卡分别成 PR、squash 合入 master,分支删除。
2. 每个 PR:`cd apps/web && npx tsc --noEmit` 0 error;`pnpm test`(vitest)绿;`supabase db test`(pgTAP 071/072)绿。
3. mock 后端下不假成功(邀请 503 / 匿名实时降级只读 + 提示)。
4. 新增/改动的 DEFINER 函数均自带 `auth.uid()`/token 守卫 + `set search_path`,判权用 `is distinct from`。
5. 更新文档:`docs/collaboration-plan.md` 分叉 2 标注"B 已落地";`docs/adr/0002`/`0003` 视需要追加修订段;`PROGRESS.md` 记录;`docs/ROADMAP.md` P5 增补对应条目。
6. 现有 Stage 0/1/2 的 e2e 与 pgTAP 仍全绿(不得回归登录用户的协作行为)。
