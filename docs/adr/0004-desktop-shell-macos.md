# ADR 0004: macOS 桌面壳 = Tauri v2 远程壳 + 托盘常驻（P4-01 真机验证）

- 状态: 已接受（macOS 真机验证随本 ADR 落地，`desktop/src-tauri`）
- 日期: 2026-09-01
- 相关: `docs/multi-platform-plan.md` §0/§3、`docs/ROADMAP.md` P4-01、
  `desktop/src-tauri/`、`.github/workflows/desktop.yml`、`docs/notch-trigger-plan.md`

## 背景

ROADMAP P4-01 要求桌面端先做有时限的真机验证、结论写成 ADR。此前 `desktop/`
只有骨架（全局快捷键 ⌘⇧S → quick-save 桥 + 通知插件），从未在 macOS 上完整
跑通登录与核心链路；`tray-icon` feature 已开但无托盘代码。用户决策（2026-09-01）：
**先交付 macOS 开发版 + 托盘常驻**，刘海激发器另出规划（见 notch-trigger-plan）。

## 决策

1. **维持「壳加载远程 Web」既定架构**（multi-platform-plan §0，两轮评估结论，
   本文不再翻案）：dev 加载 `http://localhost:3000`（`beforeDevCommand` 自动拉起
   web dev server），生产加载线上部署 URL。静态导出与 Node sidecar 两条路
   此前已否决，不重复。

2. **关窗驻留 + 托盘常驻**：主窗口 `CloseRequested` 一律拦截改为隐藏（Mac
   常驻习惯，对齐 Docker/_raycast 类工具），托盘菜单「显示主窗口 / 打开速记 /
   退出 Organize」；macOS 点击 Dock 图标（`RunEvent::Reopen`）恢复主窗口。
   「打开速记」经 `navigate` 事件通知前端路由跳转 `/memos`，web 侧
   `NavigateBridge` 接桥并对事件载荷做应用内路径白名单校验
   （`lib/platform/navigate.ts`）。全局快捷键 ⌘⇧S 现在会先唤回主窗口再弹层。

3. **⚠️ 发布产物在加载源解决前不得分发**：`frontendDist`（生产加载地址）现指
   `https://organize-web.vercel.app`，2026-08-28 核查该域名被无关第三方 CRA
   应用占用。本次按用户决策只交付开发版；**把生产 URL 换成真实部署域名前，
   `tauri build` 产物（.app / NSIS）一律不得对外分发**。desktop.yml 的
   master-push 构建产物仅作内部冒烟用途。

## 真机验证记录（2026-09-01，macOS arm64）

- Rust 工具链经 rustup 安装（此前文档记载的工具链阻塞项已消除）。
- `cargo check` 本地通过（8min 冷编译）；CI 在 macos + windows 双平台复核。
- `pnpm --filter @organize/desktop dev` 真机运行确认：窗口正常渲染、壳内加载
  web 并被 middleware 正确重定向到 `/login`（壳→web→鉴权重定向链路通）、
  登录页完整可交互渲染、菜单栏出现 Organize 托盘图标。
- **待人工过一遍（自动化无辅助功能权限，未驱动 UI）**：托盘三项菜单实际点击、
  关窗驻留、Dock 图标重开、⌘⇧S 唤回主窗口、登录后「打开速记」跳 `/memos`。
  逐项验收命令与预期见 `docs/notch-trigger-plan.md` 之前的本节——即：启动后
  依次点托盘菜单、点红关闭、点 Dock、按 ⌘⇧S 即可全部覆盖。
- CI 门禁：desktop.yml 在 PR 触碰 `desktop/**` 时跑 macos + windows 双平台
  `cargo check`；master push 出 .app / NSIS 产物（未签名，macOS 首开需右键
  绕 Gatekeeper）。

## 已知坑

1. **turbo 双启动**：`desktop/package.json` 的 `dev` 是 turbo 任务，根目录
   `pnpm dev` 会同时起 web dev 和 `tauri dev`（后者又拉起第二个 web dev，
   端口竞争）。桌面端开发一律用 `pnpm --filter @organize/desktop dev`。
2. `tauri.conf.json` 的 `$schema` 曾指向第三方 fork，已改官方
   `https://schema.tauri.app/config/2`；改生产域名时须同步
   `capabilities/default.json` 的 `remote.urls`，两处缺一不可。
3. 托盘图标暂用彩色应用图标（非 template image，深浅色菜单栏不自动反色），
   视觉打磨项，不阻塞功能。

## 后续

- ~~生产部署 URL 就绪后：改 `frontendDist` + `remote.urls`~~（切换步骤已固化在
  `docs/deploy-runbook.md` §6.4；当前仍为占位域名，desktop-release.yml 分发门
  强制 draft，公开分发前必须人工完成三处切换）。
- ~~评估 tauri-plugin-updater 自动更新与 deep link~~（✅ 2026-09-03 落地，见修订段；
  multi-platform-plan §3 M2 清单全部勾销）。
- 刘海激发器（hover 弹出速记面板）按 `docs/notch-trigger-plan.md` 推进，
  原型讨论后再实现。

## 修订（2026-09-03）：Windows 发布链路 + M2 能力全量

1. **发布链路**：`.github/workflows/desktop-release.yml`（tag `desktop-v*`）在
   windows-latest 用 tauri-action 出 NSIS；**分发门**（publish 作业）判定
   `WEB_PROD_URL` 变量、`frontendDist` 占位域名与两者一致性，未就绪一律
   draft + prerelease——本 ADR 决策 3「产物不得分发」由 CI 强制执行，
   不再依赖人工自觉。
2. **自动更新**：tauri-plugin-updater/process 已接入，端点指 Release 的
   `latest.json`；ed25519 密钥对已生成——**公钥入库**（tauri.conf.json）、
   **私钥只在本地** `desktop/src-tauri/keys/`（gitignored，`*.key` 全局排除），
   经 `gh secret set TAURI_SIGNING_PRIVATE_KEY`（+`_PASSWORD`，当前空口令）
   人工配置；密钥缺失时发布管线跳过签名而非失败。
3. **Deep link**：`organize://note/<id>`、`organize://task/<id>`，Rust 侧白名单
   解析（单测钉住）后仍走本 ADR 决策 2 的 `navigate` 事件通道，前端
   `sanitizeNavigatePath` 二次校验——导航事实源未新增。single-instance 把
   二次启动转发首实例并唤起主窗，与关窗驻留（决策 2）配套。
4. **已知坑 2 补充**：三处同步（`frontendDist` / `remote.urls` / Auth 回调白名单）
   之外，desktop-release.yml 的 `WEB_PROD_URL` 变量是第四处，四者一致分发门
   才放行。
