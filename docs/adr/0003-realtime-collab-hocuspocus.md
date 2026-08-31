# ADR 0003: 实时协作 = Yjs CRDT + 自托管 Hocuspocus（P5-03）

- 状态: 已接受（P5-03 技术验证随本 ADR 落地，`apps/collab-server` + 编辑器协作模式）
- 日期: 2026-08-31
- 相关: `docs/collaboration-plan.md` §3 分叉 3 / §6、`docs/ROADMAP.md` P5-03、
  `apps/collab-server/`、`apps/web/hooks/use-note-collab.ts`、`docs/adr/0002-collaboration-acl-model.md`

## 背景

Stage 0（乐观锁 + 冲突对话框）交付的是「无实时推送的多人编辑」。用户目标升级为
飞书级体验：多人**同时**编辑、字符级合并且**不卡顿**，远端光标/出席可见。
允许自备常驻进程（租服务器或 Mac mini）。

## 决策

**Yjs CRDT + Hocuspocus（自托管 WebSocket 协作服务）**，一笔一房间
（documentName = `note:<uuid>`）。

| 层 | 选择 | 说明 |
|---|---|---|
| 合并算法 | Yjs（y-prosemirror） | 字符级 CRDT，断线缓冲离线合并，Tiptap 官方 Collaboration 扩展直连 |
| 传输 | Hocuspocus 4.6（独立 Node 进程，`apps/collab-server`） | 二进制 y-update 直推，延迟最低；连接级鉴权 + viewer 只读连接 |
| 鉴权 | Supabase access token → `auth.getUser` 验签 | 不信任客户端自报 uid |
| 授权 | 以用户 JWT 调 `resource_role('note', id)` | **唯一判定链复用**（ADR 0002），服务端不自建权限；viewer 连接服务端置 readOnly |
| 持久化（本期） | 客户端节流快照：`save_note_with_tasks_v2(expected_revision = null)` | 可读快照进 notes.content，版本触发器/任务链/last_edit_by 全部复用；CRDT 合并使乐观锁无意义 |
| 持久化（生产化卡） | 服务端 ydoc blob（`encodeStateAsUpdate`）+ 服务端按需播种 | 解决「服务器重启丢内存文档」「空房间并发播种竞态」 |

## 否决的替代方案

1. **Supabase Realtime Broadcast 转 y-protocol**：不引新服务看似省事，但官方无生产级
   y-transport 封装（房间管理/断线缓冲/awareness 全要自写）；本项目本地 Realtime 有已知
   `signature_error` 问题（notes/[id]/page.tsx 注释在案），验证环境本身不可靠。若将来
   客户端全都极小化（无自托管进程诉求），可再评估。
2. **y-webrtc（PeerJS）**：NAT/跨网段成功率不可控，signaling 仍需服务，不适合生产。
3. **Stage 1（Postgres Changes + 整页刷新）作为终点**：整页刷新会打断输入焦点，达不到
   「不卡顿」的验收；仅作为 CRDT 不可用时的降级路径保留（即现状 Stage 0 主链）。

## 编辑器接线合同

1. **transactionSource**：y-sync 远端事务 → `remote-sync`（G3 预留枚举启用）——
   不进 Undo、不生成 task mutation、**不标脏不排队保存**；本地编辑照旧 `user`。
2. **History**：协作模式下 StarterKit 的 History 关闭，Undo 由 Collaboration 的
   Yjs UndoManager 接管（撤销不回滚别人的输入）。
3. **UniqueID**：协作模式加 `filterTransaction: tr => !tr.getMeta("y-sync$")`，
   只给本地事务补 id，远端节点自带 id。
4. **空房间播种**：首次同步后若 Y.Doc 为空，用 DB 内容播种一次（不产生保存）。
   已知边界：两客户端同时首次进入空房间会各自播种——生产化卡（服务端播种）解决。
5. **降级**：`NEXT_PUBLIC_COLLAB_WS_URL` 未配置 / mock 后端 / 会话断开时，编辑器与保存
   回到 Stage 0 乐观锁主链（owner→v1，editor→v2 带锁），功能不缺失、只少实时性。

## 验证口径（P5-03 学习目标 → `apps/web/e2e/collab.spec.ts`）

- 双浏览器并发输入不丢字（不同段落并发 + 同段落追加）
- 双向可见性与出席栏（对方名字/颜色可见）
- 断线重连：关页→另一端继续输入→重开，内容经内存文档 + 快照双通道合并
- 快照落库：刷新后内容仍在（复用版本触发器，历史面板可用）

## 部署形态（用户已确认可自备服务器）

- Mac mini / 租用服务器上跑 `apps/collab-server`（常驻进程，端口 1420 或反代 `/collab` ws 升级），
  Supabase 与 web 同机或同网；`NEXT_PUBLIC_COLLAB_WS_URL` 指向该地址。

---

## 修订（2026-08-31，067 生产化卡）：持久化落地 + 播种改为「服务端仲裁的客户端播种」

原「生产化卡」两项已在 067 落地，其中第二项的实现与本 ADR 原文不同，修订留档：

1. **blob 持久化（按原文落地）**：`note_ydocs`（迁移 067，bytea、notes 级联）+
   `get_note_ydoc` / `save_note_ydoc` 两个 DEFINER RPC（权限经 `resource_role`：
   读 owner/editor/viewer，写 owner/editor）；collab-server `onLoadDocument` 回放、
   `onStoreDocument`（内置防抖）以最后写者 JWT 落库。
   - **新鲜度规则（数据安全关键）**：正文存在非协作写入路径（离线 v1/v2、
     move-block API、恢复），只动 notes 行。RPC 仅在 `blob.updated_at >=
     notes.updated_at` 时返回 blob，否则返回 null 走播种路径——防止重启后旧 CRDT
     状态遮蔽新内容并被客户端快照反向覆盖（丢数据）。
2. **播种（修订：不把 schema 搬上服务端）**：原文设想服务端从 notes.content 生成
   Y.Doc，这要求 collab-server 持有与编辑器完全一致的 ProseMirror schema。实测不可行
   也不可取：自定义扩展深度耦合 React/Next/数据库 UI（`database-block.tsx` 引六个视图
   组件等），平行维护第二份 schema 必然漂移，而 schema 漂移的播种失败仍要回退客户端
   播种——等于两条路径都要维护。修订为**服务端仲裁的客户端播种**：编辑器空房间时经
   无状态消息申请租约（`{"t":"seed-req"}` → `seed-grant/wait/deny`），服务端单线程
   判定天然原子，同一房间只发一份 grant（`apps/collab-server/src/seed-lease.ts`）；
   播种实现只有一条（客户端，持真实 schema），竞态同样根除。
   - 否决备选：DB 租约（survive 重启的持久化对纯互斥无意义，blob 缺席已说明一切）
     、客户端先到先得（无原子原语，Yjs 操作可加不可撤）。
3. **blob 定位**：派生缓存，不进备份合同 v4（`EXPORT_EXCLUSIONS` 声明 `note_ydocs`），
   不进 mock（协作层在 mock 下整体不启用）。blob 可随时从 content 重建。
