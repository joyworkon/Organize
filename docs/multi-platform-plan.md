# Organize 多端发布计划：Windows / Android / iOS

> 状态：规划文档（2026-08-27 起草），是 roadmap X2/X3 的展开与执行清单；两者冲突时以本文为准，合并 PR 时需回写 roadmap 状态。
>
> 总策略一句话：**一个代码库、一个 Supabase 后端、三端壳层**——Windows 用 Tauri 2，Android/iOS 用 Capacitor 6，全部加载同一套 `apps/web` 应用（远程 URL 模式），数据与功能天然同步；端差异只收敛在「推送、分享接收、快捷键、自动更新、商店发布」五条原生桥上。

---

## 0. 为什么是「壳加载远程 Web」而不是本地打包

这是已两轮评估（roadmap X2/X3）后的既定结论，此处只记录约束，不再翻案：

1. `apps/web` 依赖 20+ 个 API 路由（`/api/scrape`、`/api/upload`、`/api/ai/*`、`/api/plugins`、`/api/cron/*`…）和 Supabase SSR cookie 中间件，`output: 'export'` 静态导出不可行。
2. 本地跑 Next server 需要 Node sidecar（Tauri 打包 +100MB、Capacitor 完全不支持），等离线协议成熟后再评估（见 §7）。
3. 远程模式下所有业务代码零分叉：编辑器、任务工作台、图谱、AI、离线队列全部直接复用，三端「功能同步」由架构保证，不靠移植。

代价与对策：

| 代价 | 对策 |
| --- | --- |
| 必须先有公网部署 | 里程碑 M0 把「Web 公网部署」列为三端共同前置（Vercel + 自定义域名，生产 Supabase 项目） |
| 断网时壳是白屏 | 启动失败页（本地内置离线提示 HTML + 重试按钮 + 「上次打开时间」）；深度离线能力属 X1 范畴，不阻塞发布 |
| WebView 兼容性 | Windows 锁 WebView2（Evergreen）；Android 锁 Chrome WebView ≥ 110；iOS 锁 WKWebView（系统级，无碎片） |

---

## 1. 功能同步矩阵（Web 功能 → 三端形态）

图例：✅ 直接可用（远程模式天然带过来）｜🔧 需适配｜🚫 Web 方案不可用，需原生替代（打 ★ 的在 P0 里程碑内，其余按需）

| 功能域 | 功能点 | Windows | Android | iOS | 说明 |
| --- | --- | --- | --- | --- | --- |
| 认证 | 邮箱登录/登出 | ✅ | 🔧 cookie | 🔧 cookie | Capacitor `server.url` + `androidScheme: https` 下 Supabase SSR cookie 可用，但需验证第三方 cookie 策略；异常时改用 token 持久化方案 |
| 收集箱 | 粘贴 URL 抓取 | ✅ | ✅ | ✅ | 抓取在服务端 API，端无关 |
| 收集箱 | 系统分享「保存到 Organize」 | 🔧 | ★🚫 | ★🚫 | Android Intent Filter（ACTION_SEND）+ iOS Share Extension，见 §4.3 / §5.3 |
| 阅读 | 库/三态/进度/高亮/标签 | ✅ | ✅ | ✅ | 纯 Web 功能 |
| 笔记 | 编辑器全家桶（折叠/表格/公式/列/附件…） | ✅ | 🔧 触屏 | 🔧 触屏 | 拖拽手柄、BubbleMenu 需触屏适配（点按替代长按拖动、工具栏安全区）；附带上传 Web 端用拖入/粘贴，移动端补 `<input type=file>` 与相机入口 |
| 笔记 | 目录 TOC / 折叠标题 / 块搜索 ⌘F | ✅ | 🔧 | 🔧 | 快捷键在移动端不可用，需给 TOC 面板、搜索入口补可点按钮（搜索入口移动端常缺，列入适配清单） |
| 笔记 | 反链/子页面树/移动到/版本/评论/分享/收藏 | ✅ | ✅ | ✅ | 纯 Web 功能 |
| 任务 | 三栏工作台（列表/看板/月历）/子任务/依赖/倒数日 | ✅ | ✅ | ✅ | PR #65–#103 已含响应式手机布局与 MobileTabBar |
| 任务 | 提醒通知（Web Push + 15min cron） | 🔧 | ★🚫 | 🚫 | Windows WebView2 支持 Service Worker Push（需验证后台存活，兜底 Tauri notification 插件轮询）；移动端必须走 FCM/APNs，见 §3.4 |
| 工作台 | 今天/回顾/统计 | ✅ | ✅ | ✅ | 纯 Web 功能 |
| 图谱 | 笔记图谱/任务依赖图 | ✅ | ✅ | ✅ | canvas 交互需触屏手势适配（捏合缩放），P1 |
| AI | 问 AI/速记/标签推荐 | ✅ | ✅ | ✅ | 服务端 API；速记用 MediaRecorder，iOS Safari/WebView 支持（H.264/AAC 容器注意转码兼容） |
| 插件 | ai-summary / tag-suggest | ✅ | ✅ | ✅ | 配置走 API 持久化 |
| 离线 | 笔记/任务队列（X1） | ✅ | ✅ | ✅ | localStorage 队列在 WebView 内同样生效；在线回放机制不变 |
| 外观 | 主题色/明暗/全宽/字体 | ✅ | ✅ | ✅ | localStorage 偏好 |
| 数据 | 导出 JSON/Markdown、备份 | ✅ | 🔧 | 🔧 | 移动端浏览器下载文件体验差，P1 用 Share/Capacitor Filesystem 落「文件」应用 |
| 快捷键 | 全局快速保存 ⌘⇧S | ✅ | 🚫 不适用 | 🚫 不适用 | 移动端无全局快捷键概念，功能由分享接收替代 |
| 安全 | RLS 行级隔离 | ✅ | ✅ | ✅ | 后端侧，端无关 |

---

## 2. 共同前置：里程碑 M0（三端共用，1 周内可完成）

所有端发布的前置，做完才允许进入各端 M1：

- [ ] **M0-1 生产 Supabase 项目**：创建生产 project，按序回放 `supabase/migrations/001–050`（CI 的 db-test 已验证迁移可重放），配置 Auth 域名白名单（含未来的桌面 deep-link 回调域）。
- [ ] **M0-2 Web 公网部署**：Vercel 部署 `apps/web`（框架预设 Next.js，环境变量 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 指向生产）。`desktop/src-tauri/tauri.conf.json` 的 `frontendDist` 与 `mobile/capacitor.config.ts` 的 `server.url` 已指向 `https://organize-web.vercel.app`，部署后按实际域名统一替换。⚠️ 2026-08-28 核查：**该域名当前被一个不相干的第三方 CRA 应用占用**（葡语界面），在完成部署或更换域名之前，任何端壳都不得按现配置分发，否则等于把陌生应用装进用户设备。
- [ ] **M0-3 Cron 接线**：repo variables `TASK_REMINDER_BASE_URL`（指向生产域名）+ secret `CRON_SECRET`，验证 task-reminder-cron workflow 真正发出推送（当前未配置自动跳过）。
- [ ] **M0-4 冒烟清单**：登录 → 收集 → 阅读 → 建笔记（含折叠标题+TOC）→ 建任务+提醒 → 离线断网编辑/联网回放 → 导出。这份清单同时是各端 M3 验收的模板。

---

## 3. Windows 桌面端（Tauri 2）

现状：`desktop/src-tauri` 骨架已具备——`main.rs` 已注册 notification 插件与全局快捷键（⌘/Ctrl+Shift+S → `quick-save` 事件），`tauri.conf.json` 已配置 `devUrl: localhost:3000`、`frontendDist: 远程URL`、窗口 1200×800、`targets: ["app", "nsis"]`、tray-icon feature 已开。**阻塞项只剩 Rust 工具链与签名证书。**

### 3.1 M1-本机可跑（预计 1 周，前置：装 Rust）

- [x] 安装 rustup + MSVC toolchain（Windows）或 Rust for macOS（开发机交叉验证用 `cargo check`），解锁条件达成后从 roadmap X2 摘除阻塞标记。（2026-08-28：macOS 侧 rustc/cargo 1.98 已就绪，`cargo check` 一次通过；Windows MSVC 待装机出包时处理）
- [ ] `pnpm --filter @organize/desktop dev` 验证：壳内加载本地 dev server，登录 → 冒烟清单 M0-4 全过。（未执行：需要 GUI 会话；M1 已用 `cargo check` + 代码审查代替，GUI 冒烟顺延）
- [ ] 验证 `frontendDist`（远程 URL）构建产物 `tauri build` 可出 `.msi`/.exe（NSIS），本机安装自测。
- [x] 确认 `quick-save` 前端监听链路：编辑器或全局注册 `listen("quick-save")` → 打开快速保存弹层（若前端无监听则补，位置：`apps/web` 新增 `components/desktop/quick-save.tsx`，仅在 Tauri 环境动态注册——用 `window.__TAURI_INTERNALS__` 存在性判断）。（2026-08-28 完成：顺带修复 `main.rs` 只挂 handler、未 `with_shortcuts` 注册快捷键导致事件永不触发的 bug；桥接经 window CustomEvent 复用 QuickAdd 面板，`@tauri-apps/api` 动态 import，非 Tauri 环境零加载）

### 3.2 M2-桌面体验补齐（1–2 周）

- [ ] **系统托盘**（tray-icon feature 已开，代码未写）：`main.rs` 补 tray 菜单（显示主窗/快速保存/退出）；关窗默认最小化到托盘而非退出（`on_window_event` 拦截 CloseRequested）。
- [ ] **通知**：WebView2 支持 SW Web Push → 优先沿用现有 Web Push（M0-3 验证）；若 WebView 后台被挂起导致推送丢失，兜底方案为 Tauri 侧轻轮询 `/api/cron/task-reminders` 同源接口（新增 `/api/tasks/due-soon` 返回当前用户 15 分钟内到期任务），经 `tauri_plugin_notification` 弹系统通知。两条路径都以真机「锁屏 30 分钟后收到提醒」为验收。
- [ ] **自动更新**：接入 tauri-plugin-updater（签名密钥 `tauri signer generate`，更新清单放 GitHub Releases / 自托管 JSON），发布节奏与版本号对齐 `package.json` 0.1.0 → 0.2.0。
- [ ] **Deep link**：tauri-plugin-deep-link 注册 `organize://` scheme（`organize://note/<id>`、`organize://task/<id>`），为后续分享/外链跳转预留；登录回调若使用 OAuth 也走此通道。
- [ ] **CSP**：`tauri.conf.json` 的 `csp: null` 收紧为允许自域名 + Supabase 域名的最小策略。

### 3.3 M3-Windows 发布（1 周 + 商店审核）

- [ ] **代码签名**：购买 OV 代码签名证书（个人项目可用 self-signed + SmartScreen 提示过渡，但要在 README 说明），NSIS 安装包签名；签名是 SmartScreen 拦截的主因，不签则首装体验差。
- [ ] 构建机：GitHub Actions `windows-latest` runner + tauri-action，tag `desktop-v*` 触发，产物挂 Release。
- [ ] 分发：直接下载（首选）+ 可选提审 Microsoft Store（MSIX 打包，非阻塞项）。
- [ ] 验收 = 冒烟清单 M0-4 在 Windows 10/11 实机全绿 + 托盘/快捷键/更新/通知四项专项。

---

## 4. Android 端（Capacitor 6）

现状：`mobile/capacitor.config.ts` 已配好 `server.url` 远程加载 + `androidScheme: https` + SplashScreen + Share 插件显示文案；**阻塞项是 Android Studio / SDK 工具链与原生工程初始化（`android/` 目录不存在）**。

### 4.1 M1-工程初始化与壳可跑（1 周）

- [x] 安装 Android Studio（含 JDK 17、SDK Platform 34+、build-tools），`ANDROID_HOME` 就绪。（2026-08-28：经 brew 命令行工具链装齐——openjdk@17 + android-commandlinetools + platform-tools + platforms;android-35 + build-tools;35.0.0 + emulator + default/arm64-v8a 镜像 + medium_phone AVD，未装 Android Studio GUI）
- [x] `cd mobile && npx cap add android`（生成原生工程，**android/ 目录入库**，`.gitignore` 排除 build 产物）。（2026-08-28 完成并入库；根 .gitignore 移除了骨架期的 mobile/android、mobile/ios 预排除）
- [x] `npx cap sync android` + Android Studio 打开 → Run 到真机/模拟器：登录 → 冒烟清单 M0-4。（2026-08-28 模拟器实机验证：登录闭环 ✓、冷启动 cookie 保持登录 ✓、笔记创建/编辑/自动保存 ✓；收集/阅读/导出等 M0-4 其余项待走。本地验证需 `adb reverse tcp:54321 tcp:54321`——web 把 Supabase URL 编译为 127.0.0.1，模拟器内不可达；生产 https 域名无此问题。debug 构建已加 cleartext 放行以便加载 http dev server）
- [ ] **认证专项**：验证 Supabase SSR cookie 在 `https` scheme WebView 内的持久化（Android WebView 默认接受 cookie；若 `server.url` 远程域与 scheme 冲突导致 cookie 丢失，回退方案：Capacitor HTTP 拦截注入或改 `@supabase/ssr` token 模式——此项是 Android 端最大技术风险，M1 内必须出结论）。**✅ 2026-08-28 出结论：force-stop 冷启动后仍保持登录，`androidScheme: https` + Capacitor WebView cookie 持久化可用，回退方案无需启用；结论复用到 iOS。**
- [ ] **触屏适配第一轮**：编辑器 BubbleMenu/拖拽手柄/块菜单在真机的可用性走查，记录不可用项清单（预期：拖拽手柄小、悬浮菜单易误触）；最小修复集 = 点按选择 + 底部弹出菜单（复用现有 DropdownMenu 组件即可，多数无需新代码）。（2026-08-28 完成主干冒烟：TabBar 导航、新建笔记、编辑器输入、自动保存、块手柄渲染均正常；BubbleMenu 选区交互与拖拽移动待深测）

### 4.2 M2-Android 原生能力（1–2 周）

- [ ] **分享接收（★P0）**：`android/app/src/main/AndroidManifest.xml` 给 MainActivity 加 `intent-filter`（`android.intent.action.SEND`，`text/plain` + `image/*`）；自定义 Capacitor 插件 `ShareReceiver`（~100 行 Java：onNewIntent 取 `EXTRA_TEXT/EXTRA_STREAM` → emit 到 WebView）→ 前端监听后跳转收集箱并预填 URL，或直接调 `/api/scrape`。冷启动（intent 落在 getIntent）与热启动（onNewIntent）两条路径都要测。
- [ ] **推送（★P0）**：Firebase 项目 + `google-services.json`；`@capacitor/push-notifications` 获取 FCM token；**后端改造**：新表 `push_tokens(user_id, platform, token, created_at)` + `POST /api/push/register`；`/api/cron/task-reminders` 改为按用户订阅渠道分发——Web 订阅走现有 Web Push，Android/iOS 订阅走 FCM HTTP v1 API（服务帐号密钥放 GitHub secret）。同一条提醒去重逻辑不变（现有 cron 幂等键机制继续用）。
- [ ] **返回键**：Capacitor 默认返回键=浏览器 back，编辑器内会误退出丢焦点——监听 `backButton` 事件，编辑器有未保存改动时先确认（复用现有冲突对话框文案）。
- [ ] **安全区/键盘**：`@capacitor/status-bar` + viewport-fit=cover 核查顶栏遮挡；键盘弹出时底部 MobileTabBar 收起（`ion-keyboard` 类问题用 `window.visualViewport` 监听处理）。
- [ ] **应用内文件**：导出 JSON/MD 用 `@capacitor/filesystem` 写到 Downloads + `@capacitor/share` 弹系统分享（P1）。

### 4.3 M3-Play Store 发布（1 周 + 审核）

- [ ] 生成上传密钥库（keystore 入 GitHub secret），App Bundle（.aab）签名构建接入 CI（`ubuntu-latest` + JDK 17）。
- [ ] Play Console：开发者账号（一次性 $25）、隐私政策页（部署在 web 域 `/privacy`，说明数据存 Supabase、AI 功能数据发送披露——X4 已有文案可复用）、数据安全表单。
- [ ] 内部测试轨道先行 → 封闭测试 → 正式发布。目标 API level 满足 Play 当年政策（提交时以 Play Console 提示为准）。
- [ ] 验收 = 冒烟清单 + 分享接收 + 推送 + 返回键三项专项真机测试（建议覆盖一台国产 ROM——后台推送与自启动策略差异大）。

---

## 5. iOS 端（Capacitor 6）

现状：无原生工程、无 Xcode/CocoaPods；`capacitor.config.ts` 同样是远程 URL 模式，可直接复用。

### 5.1 M1-工程初始化与壳可跑（1 周，需 macOS + Xcode）

- [ ] App Store Connect 账号（$99/年）+ 开发证书；安装 Xcode（含 CocoaPods，`sudo gem install cocoapods` 或 brew）。（本机 Xcode 26.6 + brew CocoaPods 就绪；ASC 账号与证书未确认）
- [x] `npx cap add ios`（生成 `ios/` 工程入库）→ `cap sync` → Xcode 签名（自动管理签名 + 个人团队先跑通）→ 模拟器跑冒烟清单。（2026-08-28：工程生成 + pod install ✓；iPhone 17 Pro 模拟器 xcodebuild 构建/安装/启动 ✓，登录页渲染 ✓、安全区正常；Info.plist 加 NSAllowsLocalNetworking 以便加载本地 http dev server。登录闭环自动化被阻：ZCode 桌面控制缺屏幕录制授权，需在系统设置授予后补验）
- [ ] **认证专项**：WKWebView 对 `server.url` 远程域的 cookie 隔离策略验证（同 §4.1 风险项，与 Android 共用结论与回退方案）。
- [ ] **安全区/滚动**：刘海屏 safe-area、橡皮筋滚动与编辑器内部滚动的冲突处理（`.organize-editor` 容器 `overscroll-behavior`）、键盘 `keyboard-resizes` 模式选择（建议 `body` 缩放模式保持 TOC 面板可见）。

### 5.2 M2-iOS 原生能力（2 周，含 Swift）

- [ ] **推送（★P0）**：APNs Key（.p8 入 secret）→ 经 FCM 通道复用 §4.2 的推送后端（FCM 支持下发 APNs），前端同样 `@capacitor/push-notifications`；Xcode 开 Push Notifications + Background Modes(remote-notification) capability。
- [ ] **Share Extension（★P0，iOS 最大原生工作量）**：Safari/其他 App 分享菜单出现「保存到 Organize」。方案：Xcode 新增 Share Extension target（Swift，~200 行）：读取 `NSExtensionItem` 的 URL/文本 → 写 App Group 容器或直接 `GET` 唤起主 App custom scheme（`organize://share?url=...`）→ 主 App 前端监听处理。注意 Extension 不能直接加载远程 WebView，只做转发。审核时需演示该功能。
- [ ] **Universal Links**：关联域名（apple-app-site-association 部署在 web 域 `/.well-known/`），`organize://note/<id>` 同款路由对 https 链接生效，方便笔记外链在手机上直达。
- [ ] 导出文件走 `Files` 应用（同 §4.2 Filesystem 方案，P1）。

### 5.3 M3-App Store 发布（1 周 + 审核 1–7 天）

- [ ] 图标/启动屏（`@capacitor/assets` 一键生成全套尺寸）、截图 6.7"/6.1"/iPad（如启用 iPad 支持，先锁 iPhone-only 降低审核面）。
- [ ] 审核合规自查：Web 内容为主的 App 说明（4.2 最低要求：功能不依赖 Safari 打开、无空壳嫌疑——Organize 全功能在 WebView 内闭环，风险低）；隐私营养标签（Supabase 存储邮箱+内容）；账号删除入口（App Store 硬性要求：设置页补「删除账号」功能——**这是三端通用的 Web 功能缺口，列入 M0-5**）。
- [ ] TestFlight 内测 → 正式提审。首次审核被拒常见原因是分享扩展崩溃/隐私标签不完整，预留一轮返工时间。
- [ ] 验收 = 冒烟清单 + Share Extension + 推送 + 安全区三项专项（iPhone 实机 + 模拟器各一轮）。

---

## 6. 统一工程与发布链路

- [ ] **CI/CD**（GitHub Actions，三端一个 workflow 矩阵）：
  - `desktop-release.yml`：tag `desktop-v*` → tauri-action（windows-latest + macos-later 可扩展 macOS 包）
  - `android-release.yml`：tag `android-v*` → JDK 17 + gradle bundleRelease → 挂 Release / fastlane supply 内轨
  - `ios-release.yml`：tag `ios-v*` → Xcode build + TestFlight 上传（fastlane 或 xcodebuild + altool）
  - 三者均依赖现有 CI（tsc + vitest）通过后再跑。
- [ ] **版本策略**：单版本号（根 `package.json`）驱动三端；端壳版本独立小版本递增（壳改动 ≠ Web 改动），移动端 Web 与壳兼容问题用「壳最低版本」校验接口预留（`/api/app-version` P2）。
- [ ] **错误监控**：三端都跑同一 Web 代码，接一套前端 Sentry（或自托管 GlitchTip）即可覆盖端差异（WebView UA 可区分平台），P1。
- [ ] **开发约定**：涉及端差异的前端代码统一走 `lib/platform.ts`（`isTauri()` / `isNative()` / `getPlatform()` 判定），禁止散落的 UA 嗅探。

## 7. 明确不做 / 后续评估

- 本地 Node sidecar 打包 Next server（等 X1 离线协议覆盖主要实体后再评估成本收益）。
- Tauri 的 iOS/Android 支持（实验阶段，不采用；移动端统一 Capacitor）。
- macOS / Linux 打包（Tauri 构建矩阵天然支持，等 Windows 版验证后按需开启，无额外开发量）。
- Widget / 小组件、watchOS、桌面小组件：X2/X3 收官后的增强项。

## 8. 里程碑总览与依赖

```text
M0 Web 生产化（三端共同前置）─────────────┐
                                          ├── Windows M1 → M2 → M3（签名是唯一外部采购项）
M0 ── Android M1 → M2 → M3（工具链最易就绪，先做）
        iOS    M1 → M2 → M3（依赖 M0 + Apple 账号；Share Extension 与推送后端与 Android 共享设计）
```

建议执行顺序：**M0 → Android 全程 → Windows 全程 → iOS 全程**（Android 工具链成本最低、可最快验证「远程壳 + 认证 cookie」这一最大共同风险；结论直接复用到 iOS；Windows 独立性好随时可插队）。

三端 P0 验收底线（功能同步的最低承诺）：登录、收集（含系统分享）、阅读、笔记编辑（含折叠标题/TOC）、任务（含提醒推送）、离线队列回放，全部真机可用。
