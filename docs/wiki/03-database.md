# 03 · 数据库 Schema（Supabase / Postgres）

> 所有表均启用 RLS，按 `auth.uid() = user_id` 行级隔离；**每张新表必须额外 GRANT 表级权限**给 anon / authenticated（003 覆盖初始表，004 起各迁移内自带 GRANT），否则写入报 `permission denied for table`。

## 1. 表清单（按域分组）

### 阅读域

| 表 | 迁移 | 说明 |
| --- | --- | --- |
| `reading_items` | 001 | 阅读条目：url/title/content/excerpt/cover_image、`reading_status`(unread/reading/read)、`reading_progress`；019 增加生命周期时间戳（started/completed_reading_at），021 软删除（deleted_at），008 置顶，044 全宽偏好 |
| `highlights` | 014 | 文章划线：content/note/color(yellow/green/blue/pink/purple)、anchor_path/offset 定位；042 增加 note_id/task_id 引用链接 |
| `item_tags` | 001 | 阅读条目 ↔ 标签（多对多，007 修 RLS） |

### 笔记域

| 表 | 迁移 | 说明 |
| --- | --- | --- |
| `notes` | 001 | 笔记：title、`content` jsonb（TipTap 文档）、reading_item_id 关联；023 增加 icon/cover_url/cover_position/parent_note_id（页面层级），025 增加 full_width/font_family/small_font，038 原子保存元数据，043 链接状态 |
| `note_comment_threads` / `note_comments` | 004 | 块级评论线程与评论（block_id 定位，resolved_at 解决态） |
| `note_suggestions` | 004 | 编辑建议（original/proposed_block，pending/accepted/rejected） |
| `note_tags` | 005 | 笔记 ↔ 标签 |
| `note_versions` | 010 | 历史版本快照；036 保存节流 |
| `synced_blocks` | 027 | 同步块（跨页面共享内容的单一数据源） |

### 任务域

| 表 | 迁移 | 说明 |
| --- | --- | --- |
| `tasks` | 012 | 任务：title/description/status(todo/in_progress/done/cancelled)/priority/category、due_date、估时/实际工时、关联 reading_item/note；015 sort_order，033 增加 list_id/排程/重复规则/series，035 清日期，040 parent_task_id 层级子任务 |
| `task_checklists` | 013 | 任务内检查清单 |
| `task_tags` / `lesson_tags` | 012 | 任务/经验 ↔ 标签 |
| `task_lists` | 033 | 任务清单（工作台分组，is_default） |
| `task_reminders` | 033 | 任务提醒（anchor start/end + offset_minutes，每任务 ≤3；039 可靠化） |
| `task_attachments` | 033 | 任务附件元数据（二进制在 attachments bucket） |
| `task_activities` | 033 | 任务动态（DB 触发器自动产生） |
| `task_templates` | 033 | 任务模板（template jsonb 快照） |
| `task_item_refs` | 030 | 任务 ↔ 笔记/阅读双链引用 |
| `save_mutation_log` | 030 | 原子保存变更日志（配合 031 RPC） |
| `task_dependencies` | 041 | 任务依赖（task_id 后置，depends_on_task_id 前置） |
| `web_push_subscriptions` | 039 | 浏览器 Web Push 订阅（endpoint/p256dh/auth_secret） |
| `task_reminder_deliveries` | 039 | 提醒投递记录（幂等防重） |
| `countdown_days` | 034 | 倒数日（target_date、repeat_annually） |

### 经验/收藏/分享/其他

| 表 | 迁移 | 说明 |
| --- | --- | --- |
| `lessons` | 012 | 经验总结：lesson_type(reflection/lesson/insight)，可关联 task/reading_item/note |
| `favorites` | 016 | 收藏：target_type(reading/note/task) + target_id + 备注 |
| `shares` | 006 | 分享：resource_type(note/reading_item)、token、is_public、expires_at；018 安全加固 |
| `tags` | 001 | 标签（user_id+name 唯一；011 created_at，017 color） |
| `plugins` | 001 | 插件注册（package_name 唯一、config jsonb、enabled） |

### 数据库块（Notion 式 Database）

| 表 | 迁移 | 说明 |
| --- | --- | --- |
| `db_databases` | 028 | 逻辑表：parent_note_id 归属、schema jsonb（属性定义）、views jsonb（视图配置）；029 软删除 |
| `db_rows` | 028 | 数据行：database_id、sort、values jsonb（propertyId → value） |

### 关键函数/特性迁移

| 迁移 | 内容 |
| --- | --- |
| 031 | RPC `save_note_with_tasks`：笔记内容 + 任务变更（TaskItemLinked 勾选）单事务落库 |
| 032 | `tasks` 表加入 Realtime publication |
| 009 / 037 | 搜索索引 / 笔记全文搜索 |
| 020 / 024 | 备份恢复支持（含笔记页面结构） |
| 021 / 022 | 软删除及子资源可见性级联 |

## 2. 迁移编年史（supabase/migrations）

| 编号 | 名称 | 主题 |
| --- | --- | --- |
| 001 | initial_schema | 核心五表 + RLS + 索引 |
| 002 | storage_bucket | `images` bucket（笔记图片） |
| 003 | grant_permissions | 初始表 GRANT |
| 004 | note_block_features | 评论/建议三表 |
| 005 | tags_extension | note_tags |
| 006 | sharing | shares |
| 007 | item_tags_rls_fix | item_tags RLS 修复 |
| 008 | pinned_items | 阅读/笔记置顶 |
| 009 | search_index | 搜索索引 |
| 010 | note_versions | 版本历史 |
| 011 | tags_created_at | 标签时间戳 |
| 012 | tasks_and_lessons | 任务/经验/关联标签 |
| 013 | task_checklists | 任务清单 |
| 014 | highlights | 文章高亮 |
| 015 | task_sort_order | 任务排序 |
| 016 | favorites | 收藏 |
| 017 | tag_colors | 标签颜色 |
| 018 | secure_public_shares | 公开分享加固 |
| 019 | reading_lifecycle | 阅读生命周期时间戳 |
| 020 | backup_restore | 备份恢复 |
| 021 | soft_delete | 软删除（deleted_at） |
| 022 | soft_delete_child_visibility | 子资源可见性级联 |
| 023 | note_page_structure | 笔记图标/封面/父页面 |
| 024 | note_page_backup_restore | 页面结构纳入备份 |
| 025 | note_page_settings | full_width/font_family/small_font |
| 026 | attachments_bucket | `attachments` bucket（非图片附件） |
| 027 | synced_blocks | 同步块 |
| 028 | database_core | db_databases/db_rows |
| 029 | database_trash | 数据库块软删除 |
| 030 | task_note_links | task_item_refs + save_mutation_log |
| 031 | save_note_with_tasks_rpc | 原子保存 RPC |
| 032 | realtime_tasks_publication | 任务 Realtime |
| 033 | task_workspace | task_lists/reminders/attachments/activities/templates + tasks 扩展列 |
| 034 | countdown_days | 倒数日 |
| 035 | task_clear_dates | 任务清日期 |
| 036 | note_versions_throttle | 版本快照节流 |
| 037 | note_fulltext_search | 笔记全文搜索 |
| 038 | note_atomic_save_metadata | 原子保存元数据 |
| 039 | reliable_task_reminders | Web Push 订阅 + 投递记录 |
| 040 | hierarchical_subtasks | parent_task_id 层级子任务 |
| 041 | task_dependencies | 任务依赖 |
| 042 | highlight_reference_links | 高亮 → 笔记/任务引用 |
| 043 | note_content_link_states | 笔记内部链接状态 |
| 044 | reading_full_width | 阅读全宽偏好 |

## 3. Storage Buckets

| Bucket | 用途 | 写入路径 |
| --- | --- | --- |
| `images` | 笔记内图片（002） | `/api/upload` 按 MIME 分流 |
| `attachments` | 非图片附件：音视频、文件（026）；任务附件（033） | `/api/upload` / 任务附件上传 |

## 4. 类型映射

TS 侧类型集中在 `packages/shared/src/index.ts`，与表一一对应（`ReadingItem`/`Note`/`Task`/`Lesson`/`Tag`/`Highlight`/`Favorite`/`Share`/`PluginRecord`/`Database`/`DatabaseRow`/`TaskList`/`TaskReminder`/`TaskDependency`/`TaskAttachment`/`TaskActivity`/`TaskTemplate`/`CountdownDay`/`WebPushSubscription` 等），字段注释标注了引入该字段的迁移编号。

## 5. 本地数据库操作

```bash
supabase start              # 拉起 Postgres/Auth/Storage/Studio
supabase migration up       # 应用新迁移
supabase status -o json     # 查看服务地址与 JWT 格式 anon key
supabase test db            # pgTAP 数据库测试（CI 同款）
```

本地端口：API `http://127.0.0.1:54321`，Studio `http://127.0.0.1:54323`。
