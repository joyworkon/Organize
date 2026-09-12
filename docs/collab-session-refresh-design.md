# A05 协作会话刷新与撤权——设计文档

编制：2026-09-12。代码基线：master `b9447ed`（A04 后）。
计划卡：[long-term-agent-plan-2026-09-11.md §5 A05](long-term-agent-plan-2026-09-11.md)（L 级：先设计，再拆串行 PR）。
A04 实测留下的三个产品缺陷（丢字窗口 / 播种 deny 无反馈 / 同步前恢复草稿致 CRDT 翻倍）一并纳入本设计。

## 1. 上游机制核实（推翻一条旧结论）

BLOCKED.md P5-03（2026-08-31）评估：「`@hocuspocus/provider` 4.6 无 `setToken`，协作连接内 token 无法刷新」。
**核实结论：字面属实，实质不成立。** 现装 `@hocuspocus/provider@4.6.0` / `@hocuspocus/server@4.6.0`（与 package.json `^4.6.0` 锁定一致）提供等价能力：

1. **客户端 token 函数**：provider 配置项 `token` 接受 `string | (() => string) | (() => Promise<string>)`。
   `getToken()`（`hocuspocus-provider.esm.js:858`）在 token 为函数时每次调用重新求值；调用点 `sendToken()`
   发生在 (a) 每次 WebSocket `onOpen`——首连与所有重连；(b) 服务端发来 TokenSync 请求时
   （`readAuthMessage` 的 `AuthMessageType.Token` 分支 → `sendToken()`）。
2. **服务端主动重验**：`connection.requestToken()`（server Connection 公开方法）向已建立的文档连接发送
   TokenSync 请求 → 客户端回 `Auth(Token)` 消息（token 函数重新求值）→ 服务端 `onTokenSync` hook 执行，
   其 contextAdditions 回调可合并更新 `hookPayload.context`（token / role / userId）；hook 抛错则
   `connection.close(Unauthorized)` 关闭该连接。
3. **readOnly 每消息生效**：`connection.readOnly` 是普通可变字段，服务端在每条 `SyncStep2` / `Update`
   消息处理时检查（`hocuspocus-server.esm.js:265–290`）：readOnly 连接的更新被丢弃并回
   `syncStatus(false)`。**editor→viewer 降级无需重连，改字段即生效。**
4. **文档级鉴权失败不关 socket**：`onAuthenticate` 抛错时服务端只发 `PermissionDenied` 消息并删除该文档
   的 hookPayload，多路复用的 WebSocket 保持打开。客户端 `permissionDeniedHandler` 只 emit
   `authenticationFailed` 事件——**当前 `use-note-collab.ts` 未监听该事件，会话会静默卡死**（现状缺陷）。

由此得出实现路径：**客户端改传 token 函数 + 监听 authenticationFailed；服务端加周期性 requestToken 重验。**
不需要销毁重建 provider 的粗暴方案（那是无 token 函数时的下策），也不引入 service_role。

## 2. 现状缺陷清单（本设计要修的）

| # | 缺陷 | 现状证据 | 影响 |
|---|---|---|---|
| D1 | 鉴权失败静默卡死 | `use-note-collab.ts` 无 `authenticationFailed` 监听 | token 过期/被撤权后编辑器永远「连接中」，无降级 |
| D2 | status 状态机失真 | provider 构造后立即 `setStatus("connected")`（`:153`），与 WS 实况无关 | 页面无法据 status 做门控 |
| D3 | 长会话 blob 持久化失败 | server `lastWriterToken` 连接建立时捕获，Supabase JWT 默认 1h 过期，`save_note_ydoc` 用旧 token 调 PostgREST → 401 → 只记日志 | 编辑 >1h 后 ydoc blob 静默停止更新（notes.content 有客户端快照兜底，可恢复但不该坏） |
| D4 | 协作建立前输入丢失 | A04 实测：编辑器先以非协作实例挂载，collab 会话建立后 `useEditor` deps 变化重建，期间输入随旧实例销毁 | 用户级丢字 |
| D5 | 播种 deny 无反馈 | A04 实测：`seed-deny` 后编辑器静默空白，无任何用户可见状态 | 用户以为笔记被清空 |
| D6 | 同步前恢复草稿致 CRDT 翻倍 | A04 实测（CI 慢机复现）：ydoc 同步完成前点「恢复本地草稿」，草稿插入空文档后房间内容合并进来，整篇翻倍 | 数据级破坏 |
| D7 | 存量连接撤权不生效 | 服务端无周期重验；合同是「下次连接才复核」 | 撤权后旧连接可继续收发未授权内容 |
| D8 | 退出账号连接残留 | 无 `onAuthStateChange` 监听 | 退出/切换账号后旧连接带着旧 token 继续活着 |

## 3. 目标状态机

### 3.1 客户端会话（`use-note-collab.ts` 重写内部实现，对外返回形状兼容新增字段）

```
off（未配置 / mock）
  │ enabled=true（collabConfigured && 出席身份已解析）
  ▼
connecting ──WS onOpen→ onAuthenticate 通过──► connected ──SyncStep2 完成──► synced
  │   ▲                                                                    │
  │   │            WS 断开（服务端重验关闭 / 网络抖动）→ 指数退避重连◄──────┘
  │   │            重连时 token 函数重新求值 → 新鲜 JWT
  │   │
  │   ├─ authenticationFailed（reason: unauthorized/forbidden）
  │   │     └─ 重试 ≤3 次（2s/5s/10s 退避，disconnect+connect 触发 token 函数重取）
  │   │           ├─ 任一次通过 → connected（瞬时过期已自愈）
  │   │           └─ 3 次均败 → error
  │   ├─ GATE_TIMEOUT（10s）内未达 synced → error（服务端不可达/握手过慢）
  │   └─ SIGNED_OUT / 身份变化 → 立即 destroy → error
  │
  └─ error：页面降级——编辑器回退非协作实例（DB content + 乐观锁主链），
            本页生命周期内不再自动重试协作（刷新页面重新进入）；
            未提交内容仍走本地草稿/保存链，可导出
```

要点：

- **token 函数**：登录用户 `async () => (await supabase.auth.getSession()).data.session?.access_token ?? ""`
  （`createBrowserClient` 默认 autoRefresh 开启，getSession 每次返回当前有效 token）；
  匿名 `() => \`share:${anonymousToken}\``（恒定，无会话概念）。
- **重试语义**：`authenticationFailed` 后的 3 次重试用 `provider.disconnect()` + `provider.connect()`
  公开 API 触发完整重握手（onOpen → sendToken → token 函数取新值），不依赖内部 `sendToken`。
- **退出/切换**：`supabase.auth.onAuthStateChange` 监听 `SIGNED_OUT` 与 `SIGNED_IN`；
  身份相对会话建立时变化 → destroy 当前 provider。页面本身会因 SIGNED_OUT 走登出跳转，这里是防残留的兜底。
- **GATE_TIMEOUT 后不自动重试** 的理由：降级后用户在非协作实例输入，若后台协作再连上会触发编辑器重建
  （丢字窗口回归）。一次页面生命周期内只做一次「协作 → 降级」的单向转换；重新进入协作 = 刷新页面。
  （服务端恢复后新开页面即恢复协作，不做长轮询探测。）

### 3.2 服务端连接周期重验（新增）

```
连接建立（onAuthenticate 通过，context = {userId, role, token, anonymous?}）
  │
  ├─ 每 REAUTH_INTERVAL_MS（默认 300_000 = 5min，env COLLAB_REAUTH_INTERVAL_MS 可覆盖）：
  │     connection.requestToken()
  │       └─ 客户端回 Auth(Token)（token 函数 → 新鲜 JWT / share token）
  │          └─ onTokenSync 重验（与 onAuthenticate 同一判定链）：
  │             ├─ 身份一致 && 仍有权 && 角色不变：静默更新 context.token（修 D3：
  │             │   onStoreDocument 的 lastWriterToken 换新，长会话 blob 持久化不再过期失败）
  │             ├─ editor→viewer：更新 context + connection.readOnly = true
  │             │   （下一条更新消息即被丢弃，无需重连）
  │             └─ 失效（token 验不过 / 角色为 null / 身份变化）：throw →
  │                 connection.close(Unauthorized) → 客户端 socket 断开 →
  │                 重连 → onAuthenticate 重新判权 →
  │                 仍撤权 → PermissionDenied → 客户端 3 次重试后 error 降级
  └─ onDisconnect：清定时器；afterUnloadDocument：房间整体回收（既有）
```

判定链复用：匿名走 `resolve_share_access`，登录走 `getUser` + `resource_role`，**不新增第二套权限逻辑**。
身份一致 = 匿名恒成立（token 即身份）；登录 = 新验出的 user id 与 context.userId 相同，不同视为连接被
移花接木，关闭。

### 3.3 撤权生效窗口（定义与承诺）

| 撤权类型 | 存量连接生效上限 | 机制 |
|---|---|---|
| editor→viewer 降级 | ≤ REAUTH_INTERVAL（5min） | 周期重验改 `connection.readOnly`，消息级检查 |
| 移除访问（空间/资源 ACL） | ≤ 5min + 重试退避（≤17s，3 次后客户端降级） | 重验 throw → close → 重连再拒 |
| 公开链接关闭/过期/改只读 | 同上 | `resolve_share_access` 重验 |
| ydoc blob / notes.content 持久化 | 立即 | save RPC 按最后写者 token 调用，撤权即 401（既有行为，保留） |
| 房间内广播（内存 doc） | ≤ 5min | 窗口内撤权者的更新仍会广播给房间（CRDT 无法逐条回滚），但 (a) 降级后 readOnly 连接发不出更新 (b) 撤权连接在窗口末被关闭 (c) 持久化立即失败。此残留是声明边界，不是缺陷 |

写路径每消息均检 readOnly：Yjs SyncStep2/Update 在 readOnly 时被丢弃并回 `syncStatus(false)`（上游行为），
客户端编辑器同步表现为「打不上字」——配合 5min 内的降级/关闭，不会长期出现。

### 3.4 A04 三个产品缺陷的修法

| # | 修法 | 细节 |
|---|---|---|
| D4 丢字窗口 | **编辑门控**：协作配置时 `editable = canEdit && collabResolved`。`collabResolved = !collabConfigured \|\| collab.synced \|\| 已降级`。门控期间编辑器只读展示 DB content（立即可读，不白屏），synced 后重建为协作实例——期间无输入，重建无损失。降级（error）后同样 resolved，编辑器回非协作可编辑 | 门控由页面层做（page.tsx 传 editable），hook 提供 `collabResolved`；GATE_TIMEOUT=10s 与 3.1 一致 |
| D5 deny 无反馈 | 编辑器收 `seed-deny` 且文档持续为空超过 12s（覆盖 3×wait 重试与租约封顶）→ toast「协作内容加载受阻，请刷新重试」；内容到达则静默。**不自动播种不写房间**（deny 语义 = 播种阶段结束/封顶，强行写会制造重复内容） | 放 tiptap-editor.tsx 播种 effect 内，计时器随内容到达/组件卸载清除 |
| D6 草稿翻倍 | `NoteRecoveryDialog` 渲染条件加 `collabResolved`：协作未就绪不弹窗，synced 后再弹。恢复动作 = `setContent` 整体替换房间内容，是用户显式选择的破坏性操作，对话框文案注明「将覆盖当前协作内容」 | 门控与 D4 共用 `collabResolved` |

### 3.5 不做的事（边界）

- 不引入 service_role / 自建第二套权限判定。
- 不改播种租约协议、不改 ydoc blob 存储结构（067/073 合同不动）。
- 不做多实例共享限流（A06）、不动 HTTP 侧匿名限流。
- 降级后不自动探测协作恢复（单向转换，刷新重新进入）。
- 房间内撤权窗口期的内存广播残留不试图回滚（上表声明）。

## 4. 实现拆分（串行 PR）

| 子卡 | 内容 | 验证 |
|---|---|---|
| A05-1（本 PR） | 本设计文档 + 账本 A05 行更新（候选→进行中，记录上游核实结论） | 纯文档：链接与结论核对 |
| A05-2 | 客户端：token 函数 / authenticationFailed 重试与 error / SIGNED_OUT 销毁 / status 状态机修正 / `collabResolved` 与 GATE_TIMEOUT / D4 门控 / D5 toast / D6 对话框门控 | `use-note-collab.test.tsx` 扩展（mock provider 事件序列）；typecheck / vitest / lint / build；真实后端手测一轮 |
| A05-3 | 服务端：周期重验 + onTokenSync 判定链复用 + context.token 刷新（修 D3）+ REAUTH_INTERVAL env | collab-server vitest（重验纯逻辑抽出可测）；build/test |
| A05-4 | E2E：撤权场景三则（editor→viewer 降级打不上字、移除访问存量连接关闭降级、公开链接关闭匿名连接关闭）+ token 过期重连不丢字；进 CI collab-e2e job | 本地完整栈实跑两轮 + CI |

依赖顺序：A05-2 与 A05-3 可各自独立合并（客户端重试在服务端无重验时已是有损改进；服务端重验在客户端
无重试时靠 WS 退避重连兜底），A05-4 依赖两者齐备。按仓规串行执行：2 → 3 → 4。

## 5. 验收对照（计划卡原文）

- token 过期前后继续编辑无丢字 → A05-2 token 函数 + A05-4 E2E。
- 旧账号连接关闭 → A05-2 SIGNED_OUT 销毁 + A05-3 身份变化关闭。
- 撤权后存量连接无法继续收发未授权内容 → A05-3 周期重验 + A05-4 三场景；窗口定义见 §3.3。
- 本地未提交内容仍可导出 → 降级路径回非协作编辑器 + 既有草稿链（D4 门控保证降级时无输入损失）。
- 无重复播种/重复监听器 → A04 已守卫（种子脚本清 note_ydocs、openNote 等播种），A05-2 重试路径
  `disconnect+connect` 不重建 provider 对象，监听器不重复注册（单测覆盖）。
