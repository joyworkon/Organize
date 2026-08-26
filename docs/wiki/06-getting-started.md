# 06 · 运行方式

## 1. 环境要求

- Node.js **>= 18.17.0**（CI 用 Node 20）
- pnpm **9.10.0**（`packageManager` 字段锁定；统一用 pnpm，不要用 npm/yarn）
- Docker Desktop（本地 Supabase）
- Supabase CLI（`brew install supabase/tap/supabase`）

## 2. 快速开始

### 方式 A：一键脚本（macOS）

双击根目录 `start.command`，自动完成：检查 Docker → 启动 Supabase → 生成 `apps/web/.env.local` → `pnpm install`（如缺）→ `pnpm dev` → 打开浏览器。关闭窗口即停止 Web 服务，Supabase 保留后台。

### 方式 B：手动

```bash
# 1. 启动本地后端（首次约 1-2 分钟）
supabase start

# 2. 配置环境变量 apps/web/.env.local
#    从 supabase status -o json 取 JWT 格式 anon key（eyJ...）
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 3. 安装依赖并启动
pnpm install
pnpm dev                    # 或 pnpm --filter @organize/web dev
```

本地服务：

| 服务 | 地址 |
| --- | --- |
| Web | `http://localhost:3000`（被占自动递增） |
| Supabase API | `http://127.0.0.1:54321` |
| Supabase Studio | `http://127.0.0.1:54323` |

## 3. 常用命令

```bash
# 根目录（turbo 编排所有子包）
pnpm dev / build / lint / test / typecheck / clean

# 只操作 web
pnpm --filter @organize/web dev
pnpm --filter @organize/web build

# 改动后本地验证（与 CI 一致，建议提交前跑）
cd apps/web && npx tsc --noEmit
cd apps/web && pnpm test            # = npx vitest run

# 数据库
supabase migration up               # 应用新迁移
supabase status -o json             # 服务地址 + anon key
supabase test db                    # pgTAP 测试
supabase stop                       # 停止本地后端
```

## 4. 环境变量（apps/web/.env.local）

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase API 地址 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | **必须 JWT 格式（`eyJ...`）**；`@supabase/ssr@0.5.2` 不支持 `sb_publishable_` 格式 |
| `NEXT_PUBLIC_MOCK_BACKEND` | 可选 | `true` 启用假后端（内存数据，跳过鉴权）；**生产禁止** |
| `SCRAPER_ALLOW_SYNTHETIC_DNS` | 可选 | 本地透明代理导致 DNS 异常时放行抓取（默认 false） |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push | 任务提醒推送 |
| `SUPABASE_SERVICE_ROLE_KEY` | Web Push | cron 路由服务端写库 |
| `CRON_SECRET` | Web Push | 保护 `/api/cron/task-reminders` |

模板见 `apps/web/.env.example`。

## 5. 测试体系

| 层 | 工具 | 位置 | 运行 |
| --- | --- | --- | --- |
| 单元 | Vitest 4（node 环境，`@` 别名指向 apps/web 根） | `apps/web/**/(*.)test.ts(x)`，670+ 用例，集中在 lib 纯函数与编辑器扩展 | `cd apps/web && npx vitest run` |
| 数据库 | pgTAP | Supabase 测试 | `supabase test db` |
| E2E | Playwright（真实断网/联网切换） | `.tmp-e2e/*.test.cjs`（未入库） | `NODE_PATH=$(echo ~/.npm/_npx/e41f203b7505f1fb/node_modules) node .tmp-e2e/<脚本>` |

## 6. CI（.github/workflows/ci.yml）

PR 与 master push 触发，两个 job：

1. **verify**：`pnpm install --frozen-lockfile` → `tsc --noEmit` → `vitest run` → `next build`（build 用占位 env，仅需变量存在）；
2. **db-test**：`supabase db start` → `supabase test db`（pgTAP）。

检查不过不要合并；本地提前跑一遍可少一轮往返。

## 7. 分支与协作流程

`master` 是受保护分支（2026-07-27 起）：禁止直接 push、force push、删除。

```bash
# 开始新工作前必须先同步（本地 master 经常是旧的）
git checkout master && git pull origin master
git checkout -b feat/<短描述>        # 前缀：feat/ fix/ docs/ chore/ refactor/

# 改代码、提交（PR 标题：type(scope): description）
git push -u origin feat/<短描述>
gh pr create
gh pr merge --squash                # 单人项目自开自合；合并后删除特性分支
```

- 一次只在一条特性分支上工作；手上有未提交改动先 stash 或提交。
- **历史例外**：截至 PR #3 的早期历史是普通合并（含嵌套 merge），回滚该区间用 `git revert -m 1 <merge-commit>`；PR #4 起全部 squash。

## 8. 常见陷阱（踩坑记录）

1. **pnpm 严格模式**：`@tiptap/core` 必须是 `apps/web` 直接依赖，否则 `tsc` 报找不到模块且命令类型增强（如 `toggleCallout`）失效。
2. **Supabase 权限**：RLS 只管行级，新表必须额外 `GRANT`，否则一切写入 `permission denied`。
3. **anon key 格式**：只认 JWT（`eyJ...`），从 `supabase status -o json` 取。
4. **微信文章抓取**：必须用 `parseWechat` 专用解析（Readability 跳过 `#js_content`）。
5. **React 副作用**：DB 写入等副作用不得放在 `setState` 更新器内，放 `useEffect` 或事件处理器。
6. **Supabase 客户端单例**：客户端组件用模块级单例（`lib/supabase/client.ts`）或 `useMemo` 缓存，否则无限重渲染。
7. **Date 对象依赖**：不要在组件顶层创建 Date 作为 `useCallback` 依赖，放进函数内创建。
8. **Next 热更新缓存**：多 Agent 并发改文件出现缓存不一致时，清 `.next` 重启。
9. **`.pnpm-store/` 与 `.env.local`**：已入 `.gitignore`，不要提交；生产 `.env.local` 不得含 `NEXT_PUBLIC_MOCK_BACKEND=true`。

## 9. UI 约定

- 主题色用 CSS 变量（primary `hsl(16, 85%, 50%)`，accent `hsl(16, 70%, 95%)`），禁止硬编码颜色；
- 卡片统一 `hover:bg-accent transition-colors duration-150`，无阴影；
- 按钮用 shadcn 变体（ghost/outline/default）；
- 阅读页排版用 `.reader-content` 体系（17px/1.8），编辑器排版在 `globals.css` 的 `.organize-editor` 作用域；
- 顶层块间距统一 `margin-bottom: 8px; margin-top: 0`（注意 BFC/ margin 塌陷问题）。
