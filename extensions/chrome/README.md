# Organize 剪藏（Chrome 扩展）

把当前网页一键保存到 Organize 稍后读；自动识别页面内的视频 / 音频，以链接形式
附带进条目，并可在阅读详情页在线预览（YouTube / Bilibili / Vimeo 嵌入播放器、
直链视频音频原生播放）。

纯 Manifest V3、无构建步骤，直接以未打包扩展加载。

## 加载方式

1. 打开 `chrome://extensions`，右上角开启「开发者模式」；
2. 点「加载已解压的扩展程序」，选择本目录（`extensions/chrome/`）；
3. 启动 Organize（`pnpm --filter @organize/web dev`，默认 `http://localhost:3000`）；
4. 点击工具栏的 Organize 图标，填写服务地址与 Organize 的邮箱密码登录；
5. 在任意网页点击图标 → 「保存到稍后读」。

## 工作方式

- **权限最小化**：只申请 `activeTab` / `scripting` / `storage`。检测页面媒体时
  才向当前标签页注入脚本（activeTab 授权），不常驻任何站点；跨域调用 Organize
  API 依赖服务端返回的 CORS 头，不需要 host 权限。
- **认证**：扩展只配置 Organize 站点地址，登录走 `/api/extension/auth`（服务端
  代理 Supabase 邮箱密码登录与 token 刷新），扩展侧不接触 Supabase 配置。
- **保存**：`POST /api/extension/collect`（Bearer JWT），复用稍后读统一收集语义
  （URL 规范化 → 去重 → 服务端抓取正文 → 固定 8 字段插入），见
  `apps/web/lib/extension/collect.ts`。mock 后端模式下不可用（返回 501）。
- **媒体检测**（`popup.js` 的 `extractPageMedia`，注入页面执行）：
  - `<video>` / `<audio>` 及其 `<source>` 的直链（.mp4 / .mp3 等）；
  - 播放器 iframe（YouTube / Bilibili / Vimeo）归一成标准视频页 URL；
  - 正文中的媒体链接。检测结果在保存前逐项勾选，上限 10 条。
- **在线预览**：保存的媒体链接以「页面媒体」小节进入条目正文；阅读详情页的
  「本页媒体」区块（`apps/web/components/reading/media-embeds.tsx`）把其中可
  预览的链接升级为播放器。iframe 渲染与编辑器嵌入块同一份安全约束
  （sandbox 禁止 `allow-same-origin`）。

## 与 web 端的同步约定

`extractPageMedia` 的直链扩展名表与 `apps/web/lib/extension/media.ts` 的
`VIDEO_EXTENSIONS` / `AUDIO_EXTENSIONS` 保持一致；改动判定规则时两边都要改。

## 文件结构

```
extensions/chrome/
├── manifest.json      # MV3 清单（activeTab + scripting + storage）
├── popup.html/.css/.js  # 登录、媒体勾选、保存与结果展示
├── icons/             # 生成的图标（勿手改）
└── scripts/gen-icons.mjs  # 图标生成脚本：node scripts/gen-icons.mjs
```
