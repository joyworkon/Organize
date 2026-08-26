# Organize Code Wiki

> 本 Wiki 基于对仓库源码的实际分析生成，面向新加入的开发者与 Agent，帮助快速建立对代码库的整体认知。

## 项目简介

**Organize** 是一个跨平台的「稍后读 + 笔记」工具（Notion + Cubox 混合形态）：

- 用户粘贴网页链接，系统抓取正文进入阅读库（未读 / 在读 / 已读三态）
- 在 Notion 风格的块编辑器中做笔记，支持页面层级、数据库块、同步块、评论、版本历史
- 内置任务工作台（清单、日历、倒数日、重复任务、提醒、依赖）与经验总结（Lessons）
- 支持公开分享、备份恢复、软删除回收站、知识图谱、离线编辑与同步
- 插件系统提供工具栏操作、侧边栏面板、内容处理器、AI 操作四类扩展点

## 技术栈

| 层 | 技术 |
| --- | --- |
| Monorepo | pnpm@9.10.0 + Turborepo 2（Node >= 18.17.0） |
| 主应用 | `apps/web`：Next.js 14.2（App Router）+ React 18 + TypeScript 5.5 |
| 后端 | Supabase（Postgres + Auth + Storage），本地 Docker 运行 |
| 编辑器 | TipTap 2.x（ProseMirror），20+ 自定义扩展 |
| UI | Tailwind CSS 3.4 + Radix UI + shadcn 风格组件 + lucide-react |
| 状态 | zustand 4（插件注册表等），服务端状态以 Supabase 客户端直读为主 |
| 抓取 | @mozilla/readability + cheerio + jsdom（含微信公众号专用解析） |
| 测试 | Vitest 4（670+ 单测）+ Playwright E2E（脚本在 `.tmp-e2e/`，未入库）+ pgTAP（DB） |
| CI | GitHub Actions：tsc + vitest + next build + supabase db test |

## 仓库结构速览

```
Organize/
├── apps/web/            # Next.js 14 主应用（唯一已实现的产品端）
│   ├── app/             # App Router：页面路由 + API 路由
│   ├── components/      # React 组件（editor / tasks / notes / reading / database / ...）
│   ├── lib/             # 领域逻辑（scraper / offline / plugin / tasks / graph / ...）
│   ├── hooks/           # 通用 React hooks
│   ├── public/sw.js     # Service Worker（页面缓存 + Web Push）
│   └── middleware.ts    # 鉴权中间件
├── packages/
│   ├── shared/          # 跨包共享 TS 类型（ReadingItem / Note / Task / ...）
│   ├── plugin-sdk/      # 插件 SDK：definePlugin() / PluginContext / 扩展点类型
│   └── plugins/         # 内置插件：ai-summary、tag-suggest
├── supabase/
│   ├── config.toml      # 本地 Supabase 配置
│   └── migrations/      # 44 个增量迁移（001–044）
├── desktop/             # Tauri 桌面端骨架（未完整实现）
├── mobile/              # Capacitor 移动端骨架（未完整实现）
├── docs/                # 设计文档、ADR、路线图
└── .github/workflows/   # CI
```

## Wiki 导航

| 文档 | 内容 |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | 整体架构、核心链路、依赖关系、认证/离线/插件架构 |
| [02-modules.md](./02-modules.md) | 主要模块职责：页面路由、组件分组、lib 分组、packages |
| [03-database.md](./03-database.md) | 数据库 Schema：全部表、迁移编年史、RLS/GRANT 约定 |
| [04-api.md](./04-api.md) | API 路由参考：方法、路径、用途、特殊约定 |
| [05-key-functions.md](./05-key-functions.md) | 关键类与函数说明（按模块列出签名与职责） |
| [06-getting-started.md](./06-getting-started.md) | 运行方式：环境、命令、环境变量、测试、分支流程 |

## 关键事实速记

- 包管理器统一 **pnpm**，不要用 npm/yarn 安装依赖。
- `master` 是受保护分支，一切改动走 **特性分支 + PR（squash merge）**。
- 改动后本地验证：`cd apps/web && npx tsc --noEmit && npx vitest run`（与 CI 一致）。
- Supabase 每张新表除 RLS 外**必须额外 GRANT 表级权限**，否则写入报 `permission denied`。
- `@supabase/ssr@0.5.2` 只认 JWT 格式 anon key（`eyJ...`），不支持 `sb_publishable_` 格式。
- `@tiptap/core` 必须是 `apps/web` 的直接依赖（pnpm 严格模式），否则类型增强失效。
