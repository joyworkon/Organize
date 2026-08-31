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
