# 工作学习待办 + 经验总结功能实现计划

## 一、需求分析与功能设计

### 核心理念
基于现有 Organize "稍后读 + 笔记" 的定位，扩展为**个人知识与任务管理一体化工具**：
- **任务管理**：跟踪工作/学习/生活待办，支持优先级、截止日期、时间预估与记录
- **经验总结**：两种模式——任务完成后的复盘总结 + 独立的经验/灵感沉淀，使用富文本编辑器
- **无缝关联**：任务可以关联阅读文章和笔记，经验也可以关联任务/文章/笔记，形成知识闭环

### 我补充的增强设计（除了你选的之外）
1. **任务状态四态**：待办 / 进行中 / 已完成 / 已取消（比简单的勾选更灵活）
2. **经验类型三种**：复盘总结 / 经验教训 / 灵感想法（方便后续筛选回顾）
3. **双视图**：任务支持**列表视图**和**看板视图**（待办→进行中→已完成）切换
4. **完成提示**：任务标记为完成时，弹出对话框询问是否写经验总结
5. **标签系统扩展**：现有标签系统支持标记任务和经验（只需扩展 `TaggableResource` 类型）
6. **固定分类**：工作 / 学习 / 生活三个固定分类（颜色区分）

---

## 二、数据模型设计

### 新增数据库表

#### 1. `tasks` 任务表
```sql
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  description text,                    -- 简单文字描述（非富文本）
  status text default 'todo' 
    check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text default 'medium' 
    check (priority in ('high', 'medium', 'low')),
  category text default 'work' 
    check (category in ('work', 'study', 'life')),
  due_date timestamptz,                -- 截止日期
  estimated_minutes integer,           -- 预估时间（分钟）
  actual_minutes integer,              -- 实际耗时（分钟）
  reading_item_id uuid references reading_items on delete set null,
  note_id uuid references notes on delete set null,
  is_pinned boolean default false,
  completed_at timestamptz,            -- 完成时间
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- RLS + 索引 + GRANT 同现有表模式
```

#### 2. `lessons` 经验总结表
```sql
create table lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text,
  content jsonb,                       -- TipTap 富文本内容
  lesson_type text default 'reflection' 
    check (lesson_type in ('reflection', 'lesson', 'insight')),
  task_id uuid references tasks on delete set null,
  reading_item_id uuid references reading_items on delete set null,
  note_id uuid references notes on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- RLS + 索引 + GRANT
```

#### 3. 标签关联表扩展
新增：
- `task_tags(task_id, tag_id)` 任务-标签多对多
- `lesson_tags(lesson_id, tag_id)` 经验-标签多对多

（参考现有 `item_tags` / `note_tags` 结构）

### 共享类型扩展（packages/shared/src/index.ts）
```typescript
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";
export type TaskCategory = "work" | "study" | "life";
export type LessonType = "reflection" | "lesson" | "insight";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  reading_item_id: string | null;
  note_id: string | null;
  is_pinned: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  reading_item?: ReadingItem;
  note?: Note;
}

export interface Lesson {
  id: string;
  user_id: string;
  title: string | null;
  content: Record<string, unknown> | null;
  lesson_type: LessonType;
  task_id: string | null;
  reading_item_id: string | null;
  note_id: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

// 扩展 TaggableResource
export type TaggableResource = "note" | "reading_item" | "task" | "lesson";
```

---

## 三、需要修改/新增的文件清单

### 1. 数据库迁移（supabase/migrations/）
- **新增** `012_tasks_and_lessons.sql`
  - 创建 `tasks` 表 + RLS + 索引 + GRANT
  - 创建 `lessons` 表 + RLS + 索引 + GRANT
  - 创建 `task_tags`、`lesson_tags` 关联表 + RLS
  - 自动更新 `updated_at` 触发器

### 2. 共享类型（packages/shared/src/index.ts）
- 添加 Task / Lesson 相关类型定义
- 扩展 TaggableResource 类型
- 添加状态/优先级/分类配置常量（类似 READING_STATUS_CONFIG）

### 3. Mock 客户端（apps/web/lib/supabase/mock-client.ts）
- 添加 `tasks`、`lessons`、`task_tags`、`lesson_tags` 内存数据
- 添加示例mock数据（几个示例任务 + 1-2个示例经验）
- 支持对应表的 select/insert/update/delete 操作
- 支持标签关联查询

### 4. 侧边栏导航（apps/web/components/layout/sidebar.tsx）
- 在 navItems 中添加：
  - 📋 `/tasks` 待办任务
  - 💡 `/lessons` 经验总结
  - （放在"笔记"之后，"标签"之前）

### 5. 任务列表页（新增 apps/web/app/(main)/tasks/page.tsx）
功能：
- 顶部筛选栏：分类筛选（全部/工作/学习/生活）、状态筛选、标签筛选、视图切换（列表/看板）
- 新建任务按钮
- 任务卡片/列表项组件：
  - 复选框快速标记完成
  - 标题、描述摘要、优先级标识（颜色点）、分类标签
  - 截止日期（过期标红）
  - 标签显示
  - 关联文章/笔记图标
  - 置顶标记
  - hover显示操作按钮（编辑/删除/开始计时）
- 看板视图：三列（待办/进行中/已完成），卡片可拖拽（先用简单实现，不做dnd-kit复杂拖拽，MVP阶段点击按钮移动状态）
- 新建/编辑任务Dialog：表单包含所有字段
- 完成任务后弹出"写经验总结"提示框

### 6. 任务详情/编辑不需要单独页面，用Dialog即可（MVP简化）

### 7. 经验总结页（新增 apps/web/app/(main)/lessons/page.tsx）
功能：
- 顶部：新建经验按钮 + 类型筛选（全部/复盘/经验/灵感）+ 标签筛选 + 搜索
- 经验卡片列表：
  - 类型图标（📝复盘/💡经验/✨灵感）
  - 标题、内容摘要（纯文本提取）
  - 关联图标（关联任务/文章/笔记时显示）
  - 标签、创建时间
  - hover操作：编辑/删除
- 经验编辑页（新增 apps/web/app/(main)/lessons/[id]/page.tsx）：
  - 复用 TipTap 编辑器
  - 可选择关联任务/文章/笔记
  - 类型选择、标签选择
- 新建经验直接在列表页Dialog中或跳转编辑器页（MVP跳转编辑器页，复用编辑器模式）

### 8. 组件文件（新增）
- `apps/web/components/tasks/task-card.tsx` 任务卡片
- `apps/web/components/tasks/task-dialog.tsx` 新建/编辑任务对话框
- `apps/web/components/tasks/complete-task-dialog.tsx` 完成任务提示写总结对话框
- `apps/web/components/tasks/kanban-view.tsx` 看板视图组件
- `apps/web/components/lessons/lesson-card.tsx` 经验卡片
- `apps/web/components/lessons/lesson-editor.tsx` 经验编辑器（复用现有编辑器模式）

### 9. 统计页面扩展（apps/web/app/(main)/stats/page.tsx）
- 添加任务统计卡片：总任务、已完成、进行中、待办、本周完成
- 添加任务完成率环形进度
- 添加按分类统计（工作/学习/生活时间投入）
- 经验数量统计

### 10. 首页/收集箱/阅读库/笔记页可选集成（后续扩展，MVP不做）
- 在文章/笔记详情页可以"创建待办"、"添加经验"

---

## 四、实现步骤（按顺序）

1. **Step 1: 数据库迁移**
   - 创建 012_tasks_and_lessons.sql
   - 创建表、RLS、索引、触发器、GRANT权限

2. **Step 2: 共享类型定义**
   - 在 packages/shared/src/index.ts 添加所有类型和配置常量

3. **Step 3: Mock 客户端扩展**
   - 添加 tasks/lessons 内存表和CRUD支持
   - 添加示例mock数据
   - 添加标签关联支持

4. **Step 4: 侧边栏导航添加入口**
   - 修改 sidebar.tsx 添加两个导航项
   - 图标使用 ListChecks（任务）和 Lightbulb（经验）

5. **Step 5: 任务列表页（MVP 列表视图先行）**
   - 创建 tasks/page.tsx
   - 创建 task-card.tsx
   - 创建 task-dialog.tsx
   - 实现基本CRUD、状态切换、筛选
   - 适配mock模式

6. **Step 6: 完成任务总结提示**
   - 创建 complete-task-dialog.tsx
   - 点击完成时弹出，可选择直接写总结或跳过

7. **Step 7: 经验总结列表页**
   - 创建 lessons/page.tsx
   - 创建 lesson-card.tsx
   - 实现列表展示、筛选、删除功能

8. **Step 8: 经验编辑器页**
   - 创建 lessons/[id]/page.tsx
   - 创建 lesson-editor.tsx
   - 复用 TipTap 编辑器，支持富文本编辑

9. **Step 9: 看板视图（可选增强，MVP可先只做列表）**
   - 如果时间充裕，添加简单看板视图（不做拖拽，点击移动状态）

10. **Step 10: 统计页面扩展**
    - 添加任务统计卡片和图表

11. **Step 11: 主题色与深色模式适配**
    - 确保所有新组件使用主题色变量
    - 分类颜色：工作-橙红、学习-蓝色（保持主题协调？或都用橙红系深浅区分？）
    - 优先级颜色：高-红橙、中-黄橙、低-灰

12. **Step 12: 类型检查 + 测试**
    - npx tsc --noEmit 验证
    - 测试mock模式下所有功能正常

---

## 五、技术要点与注意事项

1. **编辑器复用**：经验的content字段和notes一样使用TipTap JSON格式，最大程度复用现有编辑器代码，但简化（不需要块菜单等复杂功能？或者直接复用？建议直接复用现有tiptap-editor的简化版本，或提取共享编辑器组件）

2. **标签系统扩展**：现有 `TagBadge`、`AutoTagDialog`、`TagFilter` 组件需要支持 "task" 和 "lesson" 资源类型，需要检查并修改这些组件的 `resourceType` prop 类型

3. **mock模式**：和其他页面一样，所有数据操作直接使用supabase客户端，不调用API路由，确保mock模式可用

4. **单例问题**：createClient() 已做单例化，不会再出现无限重渲染问题

5. **颜色方案**：为了保持橙红色主题统一：
   - 工作分类：主橙红色 primary
   - 学习分类：橙红色偏浅 primary/80
   - 生活分类：accent 橙粉色
   - 高优先级：更饱和的橙红/红
   - 中优先级：橙色
   - 低优先级：灰色

6. **避免冲突**：所有改动在 `feature/other-improvements` 分支，不碰笔记编辑器核心文件（tiptap-editor.tsx等另一个Agent在改的文件）

---

## 六、风险与应对

| 风险 | 应对 |
|------|------|
| TipTap编辑器复用问题 | 经验编辑器先做最小功能，或直接用简单textarea做MVP，后续再升级富文本 |
| 看板拖拽复杂度高 | MVP阶段不做拖拽，只做状态切换按钮，拖拽作为后续增强 |
| 标签组件需要修改多处 | 先最小修改让其支持新类型，后续再统一重构 |
| 统计页面数据量问题 | 统计直接在客户端聚合（和现有阅读统计一样），不写复杂SQL |

---

## 七、MVP 范围确认

**第一版必须实现（MVP）：**
- ✅ 任务CRUD、状态、优先级、分类、截止日期、标签、关联阅读/笔记、置顶
- ✅ 任务列表视图 + 筛选
- ✅ 任务完成时写总结提示
- ✅ 经验列表页 + 富文本编辑页（创建/编辑/查看）
- ✅ 经验标签、关联任务/文章/笔记
- ✅ 侧边栏导航入口
- ✅ mock模式支持
- ✅ 深色主题适配

**后续增强（本次不做）：**
- ⏳ 看板视图拖拽排序
- ⏳ 番茄钟计时功能
- ⏳ 任务模板
- ⏳ 周报/日报自动生成
- ⏳ 时间统计图表
- ⏳ 全文搜索经验
