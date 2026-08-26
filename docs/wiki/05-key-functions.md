# 05 · 关键类与函数说明

> 按模块列出核心导出（路径相对 `apps/web/`，除非特别说明）。完整签名以源码为准，此处为导读性质。

## 1. 网页抓取 `lib/scraper/`

| 导出 | 说明 |
| --- | --- |
| `scrapeUrl(url, options?: ScrapeOptions): Promise<{ data?: ScrapeResult; error?: ScrapeError }>` | 抓取主编排：safeFetchHtml → 解析（微信走专用解析）→ 清洗 → `ScrapeResult` |
| `parseWechat(html: string, url: URL): ScrapeResult \| null` | 微信公众号专用解析：正文在 `visibility:hidden` 的 `#js_content`，Readability 会跳过；同时把图片 `data-src` 还原为 `src` |
| `safeFetchHtml(input, options): Promise<{ html, finalUrl }>` | 安全抓取：重定向、大小限制、最终 URL（`safe-fetch.ts`） |
| `validatePublicUrl(input, lookup, options): Promise<ValidatedUrl>` | SSRF 防护：协议/凭据/host/DNS/IP 校验（`url-safety.ts`） |
| `isBlockedAddress(address, options): boolean` | IP 黑名单判断（IPv4/IPv6 保留地址） |
| `sanitizeContent(html: string): string` | 正文 HTML 白名单清洗（`lib/sanitize/sanitize-html.ts`） |

## 2. 离线同步 `lib/offline/`

| 导出 | 说明 |
| --- | --- |
| `enqueueNoteCreate / removeNoteCreate / findNoteCreate / noteCreatesCount / makeNoteCreateOp` | 笔记离线创建队列的读写（localStorage 持久化，客户端 UUID） |
| `replayNoteCreates(writer, ops): Promise<NoteReplayResult>` | 恢复在线后按序回放：成功/幂等冲突（服务端已存在）/网络错误/服务端拒绝分类处理 |
| `task-queue.ts`（read/write/enqueue 系列） | 任务 create/update 离线排队，离线新建用客户端 UUID |
| `nextRetryDelay(retries): number` | 指数退避（base 1s，上限 60s，`MAX_SAVE_RETRIES = 10`） |
| `isNetworkSaveError(error): boolean` | 区分网络错误与服务端错误 |
| `planSaveFailure(input): SaveFailureAction` | 保存失败决策：重试/入队/放弃（`note-sync.ts`） |

## 3. 插件系统 `lib/plugin/`

| 导出 | 说明 |
| --- | --- |
| `bootstrapPlugins(deps: BootstrapDeps): Promise<BootstrapResult>` | 启动编排：拉取 `/api/plugins` → 为缺失的内置插件建记录 → 返回激活清单；失败文案常量 `MSG_CONFIG_LOAD_FAILED` / `MSG_CONFIG_SAVE_FAILED` |
| `pluginDefaultConfig(plugin): Record<string, unknown>` | 由 `configFields` 生成默认配置 |
| `PluginLoader({ userId })` | 动态 import 内置插件、注册并激活（`loader.tsx`） |
| `usePluginStore` | zustand 注册表：register/activate/deactivate、扩展点查询（`store.ts`） |
| `definePlugin(plugin): OrganizePlugin` | SDK 侧插件声明辅助函数（`@organize/plugin-sdk`） |
| `PluginContext`（接口） | 插件运行时上下文：`userId` / `getCurrentItem()` / `getConfig<T>()` / `setConfig()` / `notify()` / `getCurrentNote()` / `getCurrentBlock()` |

## 4. 任务域 `lib/tasks/`

| 导出 | 说明 |
| --- | --- |
| `useTaskRepository()` | 任务数据访问 hook：按 `TaskScope` + `TaskFilters` 查询、增删改（`repository.ts`） |
| `fetchTaskWorkspace(...)` / `useTaskWorkspaceData()` | 工作台聚合数据（清单、任务、模板等一次取齐，`workspace.ts`） |
| `filterTasksByScope / searchTasks / quickAddDueDate` | 范围过滤（今天/近 7 天/逾期…）、搜索、快速新增默认日期 |
| `nextOccurrence(start, freq): Date` / `clampMonthEnd(day, target)` | 重复规则推算（日/周/月/年，月末钳制，`recurrence.ts`） |
| `generateNextRecurringTask(...)` | 完成重复任务时生成下一期（`recurring.ts`） |
| `reminderFireAt(reminder, task)` / `reminderLabel / formatOffset` | 提醒触发时刻计算与展示（`reminders.ts`；预设 `TASK_REMINDER_PRESETS`） |
| `buildDueReminders(task, now)` / `buildOverdueSummary(tasks, now)` / `effectiveDueDate(task)` | 本地到期通知与逾期汇总（`notifications.ts`） |
| `normalizeTaskTemplate / buildTaskTemplateSnapshot / buildTaskFromTemplate` | 任务模板快照与应用（`templates.ts`） |
| `reorderIds / moveIdByOffset / computeSortOrderUpdates / applyReorderedGroup` | 拖拽排序与键盘位移（`reorder.ts`） |
| `computeDragReschedule(opts)` | 日历拖拽改期（`reschedule.ts`） |
| `validateTaskAttachment / buildTaskAttachmentPath / getAttachmentPreviewKind / formatAttachmentSize` | 附件校验（50MB 上限）与预览分类（`attachments.ts`） |
| `buildTaskNoteContent(...)` | 任务关联笔记的预填内容（`note-prefill.ts`） |
| `extractTaskMutations(doc)` | 从 TipTap 文档提取 TaskItemLinked 勾选变更，配合 031 RPC 原子保存（`lib/task-link.ts`） |

## 5. 笔记域 `lib/notes/`、`lib/note-links.ts`

| 导出 | 说明 |
| --- | --- |
| `tree.ts`（buildTree 等） | `parent_note_id` → 页面层级树，侧边栏笔记树用 |
| `noteDraftStorageKey(userId, noteId)` / `readLocalNoteDraft / writeLocalNoteDraft / clearLocalNoteDraft(ForNote)` / `areNoteDraftsEqual` | 本地草稿（断网/刷新兜底，localStorage） |
| `findNoteSearchMatch(...)` | 文内搜索匹配定位（⌘F 搜索对话框用，`search-match.ts`） |
| `extractLinksFromContent(content): ExtractedLink[]` | 提取文档内链（`lib/note-links.ts`） |
| `internalLinkKey(type, id)` / `internalLinkKeyFromHref(href)` | 内链 key 规范与解析（active/deleted/missing 状态装饰的基础） |

## 6. 知识图谱 `lib/graph/`

| 导出 | 说明 |
| --- | --- |
| `buildNoteGraph(notes: NoteGraphRow[]): GraphData` | 笔记 → 节点（note）/ 边（link 双链、parent 层级） |
| `buildTaskGraph(tasks, deps): GraphData` | 任务依赖图（边 kind = dependency） |
| `filterIsolatedNodes(graph): GraphData` | 过滤孤立节点 |
| `computeForceLayout(nodes, edges, options)` | 自研力导向布局（斥力/引力/中心力迭代，无第三方依赖，`force-layout.ts`） |

## 7. 导入导出 `lib/export/`、`lib/import/`

| 导出 | 说明 |
| --- | --- |
| `tiptapJsonToMarkdown(json): string` / `downloadMarkdown(filename, content)` | 笔记 → Markdown 导出（`tiptap-to-md.ts`） |
| `tiptapJsonToHtml(json): string` / `tiptapJsonToPlainText(json): string` / `wrapClipboardHtml(bodyHtml, title?)` | 笔记 → HTML/纯文本，剪贴板包装（`tiptap-to-html.ts`） |
| `copyNoteContent(...)` / `supportsClipboardItem()` / `supportsWriteText()` | 富文本复制（ClipboardItem 优先，降级 writeText，`clipboard.ts`） |
| `markdownToTiptapDoc(md, options?): MarkdownImportResult` | Markdown 导入（marked 解析 → PM 文档，`import/markdown-to-tiptap.ts`） |

## 8. 备份与回收站 `lib/backup/`、`lib/trash/`

| 导出 | 说明 |
| --- | --- |
| `inspectBackupV2(input): BackupInspection` | 备份文件校验：版本（接受 V2/V3）、表集合、行数限额（单表 1 万 / 总量 5 万 / 10MB） |
| `createBackupV2(...)` | 生成备份文件（`BACKUP_VERSION = 3`） |
| `prepareRestorePayload(...): RestorePayload` | 恢复前的载荷准备（`restore.ts`） |
| `listTrash(fetcher?): Promise<TrashItem[]>` / `mutateTrash(...)` | 回收站读取与恢复/彻底删除（`trash/client.ts`） |
| `parseTrashMutation(body): TrashMutation \| null` | 请求体契约校验（`trash/contracts.ts`：`TRASH_RESOURCE_TYPES` / `TRASH_ACTIONS`） |

## 9. 分享与 oEmbed

| 导出 | 说明 |
| --- | --- |
| `getPublicShare(token): Promise<PublicShareResult>` | 公开分享读取：校验存在性/is_public/过期，返回资源内容（`lib/share/public-share.ts`，服务端用） |
| `resolveOEmbed(rawUrl): Promise<{ data, error }>` | oEmbed 发现与解析，`OEmbedError` 含错误码（`lib/oembed/index.ts`） |
| `parseLinkCard(html, url)` | 无 oEmbed 时退化为 OG 链接卡片 |

## 10. AI `lib/ai/`

| 导出 | 说明 |
| --- | --- |
| `askAI(instruction, text)` | 通用 AI 调用网关（`server.ts`，仅服务端） |
| `transcribeAudio(file)` / `summarizeTranscript(transcript): Promise<AIBlockResult>` | 音视频转写与结构化总结（summary/keyPoints/actionItems） |
| `keywordTagGenerator` / `aiTagGenerator` / `getTagGenerator()` | 标签生成器策略：关键词词频 / AI，运行时选择（`tag-generator.ts`） |

## 11. 编辑器核心（components/editor/）

| 导出 | 说明 |
| --- | --- |
| `TiptapEditor`（`tiptap-editor.tsx`） | 主编辑器组件：装配 30+ 扩展、BubbleMenu、斜杠命令、块多选、演示模式、自动保存（原子保存 + 本地草稿兜底） |
| `BLOCK_COMMANDS`（`block-commands.ts`） | 全部块命令定义（id/label/category/keywords/shortcut），斜杠菜单与块命令面板共用 |
| `findBlockById / moveBlockTransaction / nodeText / isSameNodeSnapshot / BLOCK_ID_TYPES`（`block-utils.ts`） | 块定位、移动事务、文本提取、快照对比；块 ID 覆盖的节点类型集合 |
| `createSyncedBlockAt`（`extensions/synced-block-client.ts`） | 把选中内容转为同步块并落库 |
| `insertInlineDatabase / insertPageDatabase / insertLinkedDatabase`（`extensions/database-block-client.ts`） | 三种数据库块插入方式 |
| `useHotkey(handlers)` / `useHotkeySequence(...)` / `hasOpenDialog()`（`lib/hooks/use-hotkey.ts`） | 全局快捷键（含 G L / G G 等序列），弹层打开时自动屏蔽 |

## 12. 通用工具

| 导出 | 说明 |
| --- | --- |
| `cn(...inputs)`（`lib/utils.ts`） | clsx + tailwind-merge 类名合并 |
| `formatDueDate / formatTimeAgo / getDueDateColorClass / isSameDay`（`lib/date-utils.ts`） | 日期展示与逾期着色 |
| `noteDateGroupKey / groupNotesByDate / taskDateGroupKey / groupTasksByDate`（`lib/date-groups.ts`） | 今天/昨天/本周/更早 分组（笔记列表、任务列表共用） |
| `estimateReadingTime(html, lang?)` / `formatReadingTime(min)`（`lib/reading-time.ts`） | 阅读时长估算（中英文不同速率） |
| `prepareReadingContent(html)`（`lib/reading-images.ts`） | 阅读页图片懒加载/防错处理 |
| `getReferenceLabel(state)`（`lib/reading/highlight-references.ts`） | 高亮引用 active/deleted/missing 展示文案 |
| `serverError(err, fallbackStatus?)`（`lib/api/error.ts`） | API 路由统一错误响应 |

## 13. 共享类型 `@organize/shared`

全部领域类型（详见 [03-database.md](./03-database.md) §4）及展示常量：

- `READING_STATUS_CONFIG`：unread/reading/read → label/color
- `TASK_STATUS_CONFIG` / `TASK_PRIORITY_CONFIG` / `TASK_CATEGORY_CONFIG`：任务四态、三级优先级（含色点）、三类目（含图标）
- `LESSON_TYPE_CONFIG`：reflection/lesson/insight → label/icon/description
- `EditorBlockContext` / `BlockCommand` / `CommentThread` / `BlockComment` / `EditSuggestion` / `AIBlockResult`：编辑器与插件 SDK 共用契约
