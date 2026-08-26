# 04 · API 路由参考（apps/web/app/api）

> 均为 Next.js App Router Route Handler。除特别说明外，均要求登录（middleware 鉴权），服务端用 `lib/supabase/server.ts` 创建客户端，RLS 保证行级隔离。统一错误处理见 `lib/api/error.ts` 的 `serverError()`。

## 阅读与抓取

| 方法              | 路径                             | 用途                                                           |
| --------------- | ------------------------------ | ------------------------------------------------------------ |
| POST            | `/api/scrape`                  | 抓取 URL 正文（`lib/scraper`）；内存缓存（ISR 风格），`force` 参数强制刷新；SSRF 防护 |
| GET/POST/DELETE | `/api/reading-items/[id]/tags` | 阅读条目标签的查询/绑定/解绑                                              |
| PATCH/POST      | `/api/reading-items/batch`     | 阅读条目批量操作（状态流转、删除等）                                           |

> 阅读条目本身的增删改查多由前端 Supabase 客户端直读直写（RLS 保护），不走 API。

## 笔记

| 方法                    | 路径                                     | 用途                                 |
| --------------------- | -------------------------------------- | ---------------------------------- |
| GET/POST              | `/api/notes`                           | 笔记列表 / 创建                          |
| GET/PATCH/DELETE      | `/api/notes/[id]`                      | 详情 / 更新（原子保存、版本快照、链接状态维护）/ 删除（软删除） |
| GET/POST/DELETE       | `/api/notes/[id]/tags`                 | 笔记标签查询/绑定/解绑                       |
| GET/POST/PATCH/DELETE | `/api/notes/[id]/comments`             | 块级评论线程与评论管理（含解决）                   |
| GET/POST/PATCH        | `/api/notes/[id]/suggestions`          | 编辑建议的列表/提交/接受或拒绝                   |
| GET                   | `/api/notes/[id]/versions`             | 版本历史列表                             |
| GET/POST/DELETE       | `/api/notes/[id]/versions/[versionId]` | 版本详情 / 恢复到该版本 / 删除版本               |
| POST                  | `/api/notes/[id]/move-block`           | 跨笔记移动块                             |

## 数据库块（Database）

| 方法               | 路径                                 | 用途                         |
| ---------------- | ---------------------------------- | -------------------------- |
| GET/POST         | `/api/databases`                   | 数据库列表 / 创建（schema + views） |
| GET/PATCH/DELETE | `/api/databases/[id]`              | 详情 / 更新（属性、视图配置）/ 删除（软删除）  |
| GET/POST         | `/api/databases/[id]/rows`         | 行列表 / 新增行                  |
| PATCH/DELETE     | `/api/databases/[id]/rows/[rowId]` | 更新行值 / 删除行                 |

## 同步块

| 方法           | 路径                        | 用途                |
| ------------ | ------------------------- | ----------------- |
| GET/POST     | `/api/synced-blocks`      | 同步块查询 / 创建        |
| PATCH/DELETE | `/api/synced-blocks/[id]` | 内容更新（所有引用处联动）/ 删除 |

## 标签

| 方法           | 路径               | 用途              |
| ------------ | ---------------- | --------------- |
| GET/POST     | `/api/tags`      | 标签列表（含使用计数）/ 创建 |
| PATCH/DELETE | `/api/tags/[id]` | 重命名/改色 / 删除     |

## 分享

| 方法              | 路径                   | 用途                                              |
| --------------- | -------------------- | ----------------------------------------------- |
| POST/GET/DELETE | `/api/share`         | 创建分享（note/reading\_item）/ 我的分享列表 / 撤销           |
| GET             | `/api/share/[token]` | 公开访问（免登录）：按 token 取资源，校验 is\_public/expires\_at |

## 插件

| 方法           | 路径                  | 用途                           |
| ------------ | ------------------- | ---------------------------- |
| GET/POST     | `/api/plugins`      | 当前用户插件配置列表 / 注册新插件记录         |
| PATCH/DELETE | `/api/plugins/[id]` | 配置持久化（`setConfig`）、启用开关 / 移除 |

## 回收站与备份

| 方法       | 路径                    | 用途                                                 |
| -------- | --------------------- | -------------------------------------------------- |
| GET/POST | `/api/trash`          | 回收站列表（多资源聚合）/ 恢复或彻底删除（`lib/trash/contracts.ts` 契约） |
| POST     | `/api/backup/restore` | 备份恢复（`lib/backup`：V2/V3 格式校验、限额控制、逐表 upsert）       |

## 文件与嵌入

| 方法   | 路径            | 用途                                                                   |
| ---- | ------------- | -------------------------------------------------------------------- |
| POST | `/api/upload` | 编辑器文件上传：图片 → `images` bucket，其他 → `attachments` bucket；图片失败回退 base64 |
| POST | `/api/oembed` | 解析 oEmbed/链接卡片元数据（`lib/oembed`，复用 safe-fetch 防护）                     |

## AI

| 方法   | 路径                     | 用途                                                   |
| ---- | ---------------------- | ---------------------------------------------------- |
| POST | `/api/ai/ask`          | 通用 AI 问答/指令处理（`lib/ai/server.ts` 的 `askAI`，插件与编辑器共用） |
| POST | `/api/ai/notes`        | 笔记相关 AI 能力（如音视频转写总结，产出 AIBlockResult）                |
| POST | `/api/ai/tags/suggest` | AI 标签推荐（`lib/ai/tag-generator.ts`，关键词/AI 双实现）        |

## 统计 / 推送 / 定时任务

| 方法          | 路径                         | 用途                                                                                                         |
| ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET         | `/api/stats`               | 统计页聚合数据                                                                                                    |
| POST/DELETE | `/api/push/subscriptions`  | Web Push 订阅登记/注销（web\_push\_subscriptions）                                                                 |
| POST        | `/api/cron/task-reminders` | 到期提醒扫描并推送（web-push）；**需** **`CRON_SECRET`** **鉴权**，由外部 cron 周期调用；需配置 VAPID 密钥与 `SUPABASE_SERVICE_ROLE_KEY` |

## 特殊约定

- **缓存**：`/api/scrape` 使用进程内内存缓存，多实例部署不共享；其余路由无缓存。
- **鉴权豁免**：`/api/share/[token]` 公开；`/api/cron/task-reminders` 走 secret 而非用户会话。
- **Mock 模式**：`NEXT_PUBLIC_MOCK_BACKEND=true` 时前端绕过 API 直用 mock 客户端，API 路由不参与（避免 401）。

