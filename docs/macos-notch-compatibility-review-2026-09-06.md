# macOS 桌面逻辑与 MacBook 刘海适配复审

审查日期：2026-09-06。基线：`7b6d1db`，已包括上一轮审查的修复 PR #246–#254。本文是新的复审结果和实施规格，未修改业务逻辑，也不代表已完成机型适配。

## 结论

保留“主窗口 + 菜单栏常驻 + 快捷速记面板”的产品结构。刘海作为可选的快捷入口是合理的，但目前仍不能称为覆盖各种 MacBook：屏幕身份、摄像头遮挡、混合缩放、窗口生命周期及输入状态没有形成一致的模型。

**应按每块屏幕当下的能力和可用区域适配，不维护一张 MacBook 型号与刘海宽度对照表。** 同一台 MacBook 在外接屏、合盖、缩放、镜像和摄像头兼容模式下就会呈现不同几何条件。无刘海设备保留同样的速记能力，通过菜单栏和快捷键进入；顶部把手作为可选项。

上一轮 K01–K04 有实质改进：快捷键 sticky、关闭后的重新激活限制、窗口补建尝试、独立任务勾选和详情入口都值得保留。但本次发现多处仍是代码层面的未完成项，不能仅归为“等真机测一下”。下面按 12 组事项记录。

## Apple 官方依据及应用方式

| 官方资料 | 对本项目的约束或启发 |
| --- | --- |
| [NSScreen.main](https://developer.apple.com/documentation/AppKit/NSScreen/main) | 指键盘焦点所在屏；不能用它代表系统主显示器或内建屏 |
| [NSScreen.screens](https://developer.apple.com/documentation/appkit/nsscreen/screens?language=objc) | 屏幕集合会变化；主屏、当前交互屏、内建屏必须分别处理；响应显示参数变更通知 |
| [safeAreaInsets](https://developer.apple.com/documentation/appkit/nsscreen/safeareainsets?changes=_2_5&language=objc)、[auxiliaryTopLeftArea](https://developer.apple.com/documentation/AppKit/NSScreen/auxiliaryTopLeftArea-uglc) | 读取遮挡及顶部两侧可用空间；系统全屏窗口与自定义浮窗不是同一条布局路径 |
| [visibleFrame](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe?changes=_6%2C_6%2C_6%2C_6) | 普通桌面内容应避开菜单栏、Dock 等占用；该矩形随设置变化，不应当作永久常量 |
| [HIG：Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/) | 临时浮层保持少量相关操作；自动关闭时保全用户工作；不要堆叠多层浮层 |
| [HIG：Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/) | 尊重窗口管理、键盘操作和应用切换习惯 |
| [NSStatusBar](https://developer.apple.com/documentation/appkit/nsstatusbar?changes=_5) | 菜单栏空间有限，状态项并非始终可见，因此菜单栏也需要快捷键/主窗口兜底 |
| [NSWindow.CollectionBehavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct?changes=_7%2C_7) | Spaces、Mission Control、Stage Manager 和全屏有各自的窗口行为，不能只设置一个置顶标记 |
| [摄像头兼容模式键](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSPrefersDisplaySafeAreaCompatibilityMode?changes=_2_10&language=objc)、[Apple 支持说明](https://support.apple.com/zh-cn/102125) | 兼容模式会调整显示活动区域；完成适配审计后才决定显式声明，不用关闭兼容模式掩盖问题 |

Apple 文档将摄像头外壳描述为遮挡区域。本文提出的“靠近预览、显式进入编辑”和“无刘海屏默认菜单栏入口”是本项目的产品建议，不是 Apple 要求所有 App 实现的标准刘海组件。

## 本轮验证和边界

- 已同步 master；读取 Rust 壳、React 面板、事件桥、离线队列、显示配置、发布工作流，以及锁定依赖 Tauri 2.11.5 / Tao 0.35.3 的 macOS 实现。
- `cargo check --locked --offline` 通过。
- `cargo test --locked --offline` 通过，只有 **2 个 deep-link 测试**；没有刘海状态机或几何测试。
- `notch.test.ts`、`memo-queue.test.ts`、`draft.test.ts` 共 **22 个测试通过**；这些不能证明 Rust↔WebView 通知、焦点及热插拔正确。
- 通过 AppKit 做了只读屏幕测量：当前系统只报告一块**非内建屏**，1920×1080 pt、2× backing scale、safeAreaInsets.top=0；visibleFrame 为 x=0、y=78、1920×972 pt，顶部余量为 30 pt。此结果不能代表 MacBook 内建刘海屏，也不能据此推断用户是否合盖。
- 提供了可重复执行的[屏幕快照脚本](/Users/k/Documents/ZCode/Organize/scripts/diagnostics/macos-screen-snapshot.swift)。它不采集屏幕图像、窗口标题、序列号或账户数据。[本轮屏幕数据](/Users/k/Documents/ZCode/Organize/docs/audit-evidence/macos-2026-09-06/display-snapshot.json)、[Rust 编译记录](/Users/k/Documents/ZCode/Organize/docs/audit-evidence/macos-2026-09-06/cargo-check.txt)、[Rust 测试记录](/Users/k/Documents/ZCode/Organize/docs/audit-evidence/macos-2026-09-06/cargo-test.txt)和[前端测试记录](/Users/k/Documents/ZCode/Organize/docs/audit-evidence/macos-2026-09-06/web-tests.txt)已保存。
- 本轮未运行真实账户下的 Tauri 面板输入操作，未切换用户的显示布局、分辨率或系统设置，未验证多台 MacBook、Intel 运行、旧 macOS、全屏/Stage Manager 和多屏热插拔。

## 具体问题

### MC01 · P1 · macOS 最低版本与实际调用的 API 不匹配

**代码证据：** [detect_notch](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:734)直接调用 `safeAreaInsets()`。本机 Apple SDK 的 `NSScreen.h` 声明该 API 及两个 auxiliary area 从 macOS 12.0 才可用；objc2 生成的方法不会自动替调用方做系统版本判断。[tauri.conf.json](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/tauri.conf.json:33)未指定 minimumSystemVersion，当前 tauri-utils 默认值是 10.13。

**影响：** 老款无刘海 MacBook 运行旧系统时，也会进入这段检测，存在调用不存在 selector 的启动风险。新系统上 cargo check 通过不能排除它。

**修复：** 显式定义支持的 macOS 范围。若覆盖 12 以前的系统，必须在运行时守卫新 API，不可用时走无刘海模式；同时验证 WKWebView 所需能力。若暂定 12+，同步包元数据、文档和 CI，不能暗示支持所有历史 MacBook 系统。不要把新版 `NSScreen.CGDirectDisplayID` 当作旧系统方案：本机 SDK 标注它从 macOS 26 才可用，旧版可从 deviceDescription 的 NSScreenNumber 映射显示器。

**验收：** 最低支持系统实际启动、菜单栏和面板输入通过；API 不可用或返回空屏列表时主功能仍可运行。

### MC02 · P1 · 刘海结果绑定错屏，显示器名称也不是身份

**代码证据：** [detect_notch](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:734)读取 `NSScreen.mainScreen`，而 [reposition](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:607)将结果只分配给 `index == 0`；内建屏当副屏时始终得到 false。`ordered_monitors` 用 `monitor.name()` 识别主屏；当前 Tao 的 name 实际来自显示器 model_number，同型号显示器可能同名，不是稳定身份。

**复现条件：** 外接屏为主屏、内建屏仍打开；或键盘焦点在副屏；或连接两块同型号外接屏。即使排序统一，布尔值仍可能来自错误屏幕。

**修复：** 在主线程枚举每块 NSScreen，将遮挡信息与该屏身份一起生成快照。运行期使用 display ID，必要时用显示器 UUID 保存选择；显示名仅用于展示。主屏、鼠标所在屏、内建屏分开存储。保留 `unknown` 状态，API/识别失败不伪装成“确认无刘海”。

**验收：** 外接屏设主屏时内建刘海屏仍正确；同型号两屏不会误认；快捷键唤起优先当前操作屏，目标消失时回退有效屏。

### MC03 · P1 · 固定尺寸没有真正使用摄像头遮挡和桌面可用区

**代码证据：** [几何常量](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:44)固定 trigger 180×40、capsule 高 28、panel 380×520；[定位](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:618)永远放屏幕顶部正中，面板距顶部为 28+8 pt，与真实 safeAreaInsets、auxiliary areas、visibleFrame 均无关。前端箭头固定 top=28；胶囊 hover 设为 186px，而窗口只有 180px，存在裁切/收缩不一致。命中区域使用整个 40pt 窗口，透明留白也触发悬停。

**影响：** 有刘海时胶囊和提示可能画进被摄像头遮挡的区域；无刘海时会占用系统菜单栏。低可用高度、放大缩放和不同 Dock 位置下，面板没有完整留在可操作范围内的保证。不能凭“14/16 英寸”选择固定宽度修正。

**修复：** 动态计算顶部遮挡矩形；可见提示放在确认可见的下缘或另一个安全入口，不能把文字放在摄像头里面。普通面板限制在 safe-area 与 visibleFrame 的交集中，宽高按可用区域缩小，并让 React 使用实际窗口尺寸和内部滚动。触发区独立于装饰窗口，避免透明 40pt 热区误触。无刘海屏默认菜单栏入口，可选择开启顶部把手。

**验收：** 屏幕几何决定布局；保存、关闭和最后一行始终可达；菜单栏展开/隐藏、Dock 四种状态、不同缩放均不遮挡。用合成几何夹具覆盖极端值，再做真机截图；合成值不能冒充某型号实测。

### MC04 · P1 · 混合缩放屏幕的“物理坐标”并不共用同一基准

**代码与依赖证据：** [hit_trigger / cursor_in_panel](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:429)直接比较 `app.cursor_position()` 与窗口 outer_position/outer_size。锁定的 Tao 0.35.3 中，cursor_position 用**主屏缩放**换算；outer_position 用**窗口所在屏缩放**换算。set_outer_position 将传入 physical position 按窗口当前 scale 转回 logical，而本项目预先按目标屏 scale 计算坐标。

**可推导例子（非真机测量）：** 主屏 2×、副屏 1×，鼠标与副屏窗口同处全局 x=1500 pt。鼠标返回 x=3000，窗口坐标约为 x=1500，直接比较会漏判。窗口首次跨屏定位还可能用旧 scale 解码新 scale 计算的坐标。

**修复：** macOS 几何和命中全部统一为 AppKit 全局 points，并在同一快照中读取鼠标与屏幕 frame；只在渲染像素对齐边界使用 backingScale。定位采用明确的原生 points 接口或经过验证的 Tauri LogicalPosition 适配，不能简单把整个桌面乘以某一个 scale。

**验收：** 2×→1×、1×→2×，左右/上下/负坐标排列均能命中；面板一次定位正确，不靠再次打开或再次轮询修正。

### MC05 · P1 · 热插拔回收和重新定位仍不完整

**代码证据：** [reposition](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:582)拔屏调用 `extra.close()`；Tauri close 会发 CloseRequested，但 [main.rs](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/main.rs:168)对所有窗口 prevent_close，只隐藏，因此窗口没有被回收。后续“显示所有激发器”还可能再次显示这些过期窗口。

新增屏幕时异步创建窗口，却继续在旧窗口集合上定位；创建完成后没有立即布局的后续步骤。如果几何随后不变，轮询不会再次 reposition。`panel_monitor` 保留数组索引，屏幕移除后没有有效性回退；快捷键继续沿用它。轮询比较的几何键不包括 scale、safeArea、visibleFrame；重算刘海结果后也没有保证再次定位和广播 notch-info。

**修复：** 主窗口关闭隐藏；临时 trigger 允许销毁；panel 关闭进入统一状态机。用主线程串行执行“获取快照→增删窗口→定位→发布几何”，版本号丢弃过时任务。监听显示参数变更、唤醒和必要的空间/设置变化，轮询仅作低频兜底。按稳定身份保持面板目标，失效时回退当前有效屏。

**验收：** 启动后插入屏幕立即定位；拔屏后窗口数减少、没有幽灵热区；两屏变一屏后快捷键可见；合盖/开盖、主屏变化、同几何不同缩放都能更新。

### MC06 · P1 · 输入保护是短 TTL，尚未形成完整交互状态机

**代码证据：** [show_panel](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:529)悬停和快捷键都 set_focus；[活动保持](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:394)只有 1.5s。React 只在主速记 onChange 和少数动作开始时上报，没有报告中描述的“输入法组合/保存中周期心跳”；快捷输入、编辑已有速记、设置弹层没有持续保护。失焦 120ms 后的 [blur_collapse](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:275)不检查 busy/session。

**影响：** 悬停会抢其他 App 焦点；想一句话停顿超过 1.5s 或慢网络保存时，鼠标在外仍会收起；旧关闭计时器可能影响刚重新打开的面板。此处无需等多机型测试才承认代码未闭环。

**修复：** 用明确状态 Hidden/Preview/Editing/Saving/Settings，加会话 generation。Preview 不激活 App；点击、菜单栏或快捷键进入 Editing。正在编辑、组合输入、保存和设置时保持面板；离开应用时先保全草稿再按明确规则关闭。只有 Preview 用鼠标离开计时。所有关闭及保存延迟绑定 session/version，重开后旧计时器无效。恢复此前焦点不能无条件抢回正在被用户使用的另一 App。

**验收：** 鼠标在屏幕中央，用快捷键持续输入；悬停后停顿 5s、10s 保存延迟、中文候选、剪贴板操作、设置 Tab/Esc、迅速关开均无意外收起或抢焦。

### MC07 · P1 · 刘海草稿和离线“已保存”仍有数据丢失风险

**代码证据：** [save](/Users/k/Documents/ZCode/Organize/apps/web/components/desktop/notch/notch-panel.tsx:125)中 `rawInput` 与 `input` 都来自调用时的同一次 render。await 之后 `rawInput === input` 仍为真，不能检测后续 render 的新输入；成功后依旧清空并安排 500ms 收起。离线分支即使 persisted=false，也先清空、显示“已保存”并收起。离线回放只在 `/memos` 页面挂载，单独使用刘海时没有独立同步执行器。

**修复：** 用递增草稿版本或 current ref 检查真实当前值；只清理对应已确认版本，并取消过期收起任务。持久化失败保留文字、禁止显示已保存。区分“本机待同步”和“服务器已保存”；同步执行器与主窗口当前路由解耦，支持账号隔离和多窗口互斥。401/403 等拒绝不能默默删除离线内容，应进入可恢复失败项。

**验收：** 保存 A 时续写 B，B 不丢；存储满/不可用不清空；只开刘海、主窗口停在笔记页，联网后仍会同步；重启后待同步记录可见且只入库一次。

### MC08 · P1 · 跨窗口通知载荷错误，账号切换缺少完整隔离

**代码证据：** [Rust 数据桥](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/notch.rs:201)执行 `handle.emit("organize-data-changed", event.payload())`。event.payload 已经是 JSON 字符串，Emitter::emit 再序列化成字符串；前端期待对象并访问 `.origin/.topic`，因此过滤不到有效变更。当前依赖的 Emitter/EmitArgs 实现确认了该合同，不是只推测事件能否跨 WebView。

此外面板没有订阅 subscribeDataChanged，反向更新仅靠再打开时 refresh；任务读取仍是全量取回后本地截三条。`notchDraftLoadedRef` 一生只恢复一次，账号变化不重置；getUser 返回空时没有清空原有输入和列表，未登录状态的顶部输入仍在。若切换到另一账号或旧请求迟到，存在草稿/展示串账号风险，未做真实账号复现。

**修复：** Rust 反序列化成受限类型，再 emit 对象；前端运行时校验 payload，不靠 TS 泛型假定。事件携带用户和变更版本，各端订阅对应领域，补账号生命周期及请求 generation/abort。任务服务端按今天/逾期筛选、排序后 limit；未认证或身份切换中禁用提交。普通撤销完成也应保留原状态和版本，不使用无版本校验的强制 todo 覆盖远端新修改；重复任务撤销要定义对子实例的行为。

**验收：** 实际 Rust→两个 WebView 的对象载荷可读，双向变化可见；用户 A→退出→B 不显示/发送 A 草稿；延迟响应不会串号；任务撤销不覆盖其他窗口新状态。

### MC09 · P1 · Dock 重开及快捷键失败的降级不可靠

**代码证据：** [Reopen](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/main.rs:185)仅在 has_visible_windows=false 时显示主窗，胶囊作为可见 NSWindow 可能让该值持续为 true。Apple [Reopen 文档](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/applicationshouldhandlereopen%28_%3Ahasvisiblewindows%3A%29)也说明该值涵盖可见/最小化窗口，不能代表主窗口已可用。

[快捷键注册](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/src/main.rs:90)把注册错误通过 `?` 传到 setup，再由 build.expect 结束启动。快捷键被其他 App 占用时，增强入口失败不应拖垮主程序。托盘目前“打开速记”打开完整页面，没有直接打开紧凑面板的等价入口。

**修复：** Dock 重开直接恢复主窗口，或按 main 的真实隐藏/最小化状态判断。快捷键逐项注册，失败可继续启动并提示更换；托盘提供“快速记录”和“显示主窗口”。导航采用前端 ready/ack 和最后一次意图，替代冷启动反复投递旧路径的延时策略。

**验收：** 主窗口关闭、只剩胶囊时点击 Dock 能返回；冲突快捷键不阻止启动；隐藏顶部入口后仍能从菜单栏打开同一面板；慢加载导航不把用户后来的操作拉回旧页面。

### MC10 · P2／原生验证项 · 全屏与系统窗口管理策略不明确

**代码证据：** 两类小窗只设置 always_on_top + visible_on_all_workspaces；当前 Tao 将后者映射为 CanJoinAllSpaces，不能据此证明兼容其他 App 全屏、Stage Manager 和 Mission Control。触发窗使用数值 25 状态层级，但提高层级并不会产生刘海安全区，也不会赋予规范的面板行为。

**建议行为：** 全屏时默认不因无意悬停唤起；快捷键仍可显式打开。Preview 不激活应用，编辑可以获键盘焦点；评估合适的 NSPanel 或原生窗口配置，不机械叠加所有 collectionBehavior。Mission Control/锁屏/睡眠隐藏临时 UI，恢复后重新获取屏幕快照，不能带着旧自动展开计时继续执行。菜单栏自动显示时不覆盖菜单控件。

**验收：** 系统全屏、自定义全屏 App、两屏分别处于不同 Space、Stage Manager 开/关、Mission Control、锁屏唤醒。没有上述设备运行记录时保留待验收，不声称一定可覆盖所有系统版本。

### MC11 · P2 · 减少动态效果、可访问性和常驻能耗需完善

**代码证据：** [CSS](/Users/k/Documents/ZCode/Organize/apps/web/app/globals.css:5028)仅停止提示箭头动画，面板进出仍位移/缩放；没有针对系统“减少透明度”的原生状态处理。设置手工 Tab 循环只管理键盘，关闭后未显式恢复焦点；全局 Esc 也没有覆盖所有按钮位置。[设置开关](/Users/k/Documents/ZCode/Organize/apps/web/components/settings/notch-trigger-setting.tsx:63)缺少明确的 accessible name。

光标每 80ms 采样，折叠态每轮都广播 hover，即使隐藏热区且光标状态未变也继续唤醒多个 WebView。代码注释“CPU 可忽略”没有测量支持；这对电池供电的 MacBook 应实测。

**修复：** 全面尊重 Reduce Motion；通过 NSWorkspace 获取 Reduce Transparency / Increase Contrast 等可用偏好并传给 WebView（[Apple Reduce Transparency](https://developer.apple.com/documentation/appkit/nsworkspace/accessibilitydisplayshouldreducetransparency)）。设置尽量就地替换面板内容或进入主设置页，保留明确返回和焦点恢复。隐藏/锁屏时暂停无用采样，远离时降低频率，只广播变化；必要时采用无需额外权限的原生 tracking 方案。

**验收：** VoiceOver、只用键盘、增大文字、减少动画/透明度均可用；电池供电下记录基线与修改后的 CPU、唤醒次数和进程内存，不预先承诺耗电数字。

### MC12 · P1（发布前）· Intel/Apple Silicon 产物及 Mac 更新链不完整

**代码证据：** [desktop.yml](/Users/k/Documents/ZCode/Organize/.github/workflows/desktop.yml:17)按 macos-latest 构建，未显式区分 arm64/x86_64 或 Universal，PR 仅 cargo check。[desktop-release.yml](/Users/k/Documents/ZCode/Organize/.github/workflows/desktop-release.yml:32)只发布 Windows，latest.json 也只有 windows-x86_64。Mac 壳已有 updater 配置，但不能凭此证明 Mac 更新可用。

[远程权限配置](/Users/k/Documents/ZCode/Organize/desktop/src-tauri/capabilities/default.json:4)仍将生产域名描述为占位地址，并给它原生能力；本轮未重新核验该域名归属，也没有访问该远程页面。正式分发前必须确认实际受控地址并统一 frontendDist、权限白名单和发布门。

**修复：** 明确产出 arm64 和 x86_64，或 Universal 并分别运行验证；Mac 更新清单覆盖对应架构，完成签名、公证和实际安装/更新验收。将纯几何/状态机 Rust tests 纳入 macOS CI，Node 版本与仓库约定一致。区分 Developer ID 公证与 Tauri updater 签名，两者目的不同。

**验收：** Intel 和 Apple Silicon 真机都能安装、启动和更新；最低系统校验；已签名产物上的透明窗口与菜单栏行为和开发版一致；无可控生产地址时不正式发布。

## 推荐适配结构

### 1. 屏幕能力层

`ScreenSnapshot` 至少包含运行期 display ID、可选持久身份、builtIn、primary、framePt、visibleFramePt、safeInsetsPt、auxiliaryAreasPt、backingScale 和 generation。纯 Rust 几何代码消费值，不在后台线程随意访问 AppKit 对象。显示事件进入主线程，生成新快照，再原子更新窗口及 WebView 布局。

当 safeAreaInsets.top > 0 且两个顶部辅助矩形有效，可从两侧之间的缺口推导摄像头区域；这不是从型号推测。辅助矩形缺失或矛盾时走保守的普通面板入口。

### 2. 几何层

所有运算使用 AppKit 全局 points（主屏左下为原点）。普通桌面的 `usable = intersection(frame inset safeArea, visibleFrame)`；面板 top 不超过 usable.maxY，留出可配置间距；宽高不超过 usable 的可用大小，x/y 都 clamp。快捷键使用明确的当前交互屏策略，hover 使用具体被命中的屏。

摄像头区域只作为定位锚点，不作为可读文字和按钮区域。主窗口继续使用系统窗口/系统全屏的安全布局；单独审核自定义置顶窗，不对主窗口重复扣除一遍刘海高度。

### 3. 交互层

| 状态 | 进入方式 | 焦点与退出 |
| --- | --- | --- |
| Hidden | 启动、显式关闭、系统暂时隐藏 | 无焦点；遵守 rearm 和系统可用性 |
| Preview | 启用该功能且在有效热区停留 | 不抢焦；离开可延迟关闭；点击进入编辑 |
| Editing | 点击、菜单栏、快捷键 | 可输入；鼠标离开不关闭；逐层 Esc；失焦前保存草稿 |
| Saving | 提交已锁定版本 | 保护当前输入；失败回编辑；旧响应不改新 session |
| Settings | 显式设置动作 | 使用面板内设置页或主设置窗口；返回原焦点 |

所有入口进入同一个速记服务，避免悬停、快捷键、菜单栏各有保存规则。关闭面板和取消内容是两件事；只有明确取消才丢弃草稿。

## 覆盖机型的方式

| 设备/运行环境 | 目标行为 |
| --- | --- |
| 有摄像头外壳的 MacBook Air / Pro 内屏 | 动态读取该屏遮挡，在可见下缘提供可选入口；正文面板留在安全可用区 |
| 无刘海的 Apple Silicon MacBook | 同一速记面板，默认菜单栏与快捷键；可选顶部把手 |
| Intel MacBook Air / Pro、旧款 MacBook | 不按“MacBook”名称假定有刘海；以支持的系统版本、x86_64 产物和 WebView 能力为边界 |
| 合盖、只剩外接屏 | 不保留内屏热区；当前有效外接屏打开普通速记面板 |
| 内外屏混合、外屏为主屏 | 每屏独立判断，当前操作屏负责唤起；不把刘海跟随“主屏”标记移动 |
| 镜像、虚拟或远程显示屏 | 只依据系统提供的可绘制屏集合；信息不足时用普通入口，不重复造热区 |
| 未来型号 | 合法 API 几何自动适配；遇未知值降级，不能因为型号表未更新而崩溃 |

“尽量适配所有 MacBook”应解释为覆盖受支持操作系统下的 Intel/Apple Silicon、所有有效屏幕形态，并有明确降级；不能承诺所有历史型号和旧系统都已验证。

## 分批修复与验收矩阵

| 批次 | 范围 | 交付和完成门槛 |
| --- | --- | --- |
| A | MC01、MC02、MC03、MC04 | 屏幕快照、API 守卫、points 几何和动态尺寸；合成单屏/多屏/混合 scale/无辅助区域测试通过，随后内屏+外屏实测 |
| B | MC05、MC09 | 窗口角色生命周期、显示事件串行处理、Dock/快捷键降级；插拔、合盖、重开、冲突快捷键通过 |
| C | MC06、MC07、MC08 | 显式状态机、版本化草稿、独立同步、类型化跨窗口事件及账号隔离；延迟/断网/双窗口/账号切换验证通过 |
| D | MC10、MC11 | 全屏/Spaces 策略、辅助技术、减少动画/透明度、状态变化广播与能耗测量；实际系统操作矩阵完成 |
| E | MC12 | 双架构发行与更新，最低系统、签名公证、真实安装验收；更新完成复核所有条目并修正旧报告状态 |

每批遵循 AGENTS.md 的特性分支与 PR 流程；实际业务修复另开代码分支。本复审不把上述事项标记为已经实现。

需要的最小验收组合：

- 有刘海 Air 与 Pro 的代表设备，至少两个内屏尺寸；无刘海 Apple Silicon；Intel x86_64。
- 默认/更大文字/更多空间缩放，1×/2× 混合；左、右、上、下排列，外屏主屏，同型号双外屏。
- 单屏→多屏→单屏、合盖/开盖、睡眠/唤醒；显示器镜像和摄像头兼容模式可用时的开/关。
- 菜单栏自动隐藏、Dock 不同边/自动隐藏、全屏、Stage Manager、Mission Control、独立 Spaces。
- 中文输入法、长文本、停顿、慢保存、断网、存储失败、重开面板、退出/换账号、跨窗口修改。
- 最低支持系统及当前支持系统、Intel/arm64 发行包、实际更新；每项记录设备、系统、几何快照、步骤和结果。

只有真实运行过的组合标记“通过”。未覆盖的机型按能力规则解释预期行为，并保留验证状态，不用“能编译”或“像素尺寸差不多”替代适配证据。
