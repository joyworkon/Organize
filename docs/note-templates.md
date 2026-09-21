# 笔记模板与背景分块

默认使用红蓝改版前的简洁笔记排版：中性纸面、普通标题和正文。红蓝样式作为单篇笔记可选模板，在右上角「更多 → 笔记模板」切换。切换只改变显示，不替换或清空正文；未选择模板的旧笔记也显示默认样式。

## 使用

- 顶部标签页右侧「＋」创建一篇笔记，并打开对应标签页。这里的标签页与内容分类标签不同。
- 红蓝模板取消页面大标题的红色底和右侧短横线；蓝色画布铺满内容区，正文卡片左右等距。
- 一级标题仍兼容原来的章节分卡。标题左侧文字可正常输入；右侧英文默认 `Title`，点击后可编辑，离开输入框或回车保存，Esc 取消。英文与标题顶部对齐，左指箭头与标题底部对齐。
- 点击编辑器底部「＋ 新背景块」新增空白卡片；在顶层段落输入 `/`，选「新背景块」，可从当前位置分卡。普通回车继续当前卡片。
- 背景分块是内容上的边界标记，不是嵌套编辑器。正文、引用、代码和列表仍使用原有编辑行为；引用和代码在卡片里有灰底。
- 默认模板中分块标记不显示，切回红蓝后恢复分组。要合并，删除分界处的空段落，或把该段文字接回上一段。
- 未设置页面图标时，导航使用产品统一的线性笔记图标；用户自己选过的图标保留。

## 保存与兼容

`notes.page_template` 为 `default | red-blue`，通过与字体/全宽相同的原子保存、权限检查、修订号冲突与本地草稿管线持久化。复制笔记和备份恢复保留模板。部署前应用 `088_note_page_template.sql`；旧客户端缺省此字段时保留数据库现值。

内容块用 `sectionStart` 标记分界，章节标题用 `sectionLabel` 保存英文。两者均进入笔记内容 JSON，支持保存、协作内容同步和撤销；英文装饰与箭头本身不混入正文文本。模板本身与已有字体/全宽设置一样属于页面元数据。

字重修复：移除全局固定的 `font-variation-settings: "wght" 330`，改为普通 `font-weight: 330`，从而允许粗体与标题使用各自字重。

## 验证入口

- `pnpm --filter @organize/web typecheck`
- `pnpm --filter @organize/web test`
- `supabase test db --local supabase/tests/058_backup_v4.test.sql supabase/tests/066_note_last_edit_by.test.sql supabase/tests/088_note_page_template.test.sql`
- `NEXT_PUBLIC_MOCK_BACKEND=true ORGANIZE_E2E=true pnpm --filter @organize/web build`
- 在 mock 生产服务上运行 `pnpm --filter @organize/web exec playwright test e2e/note-templates.spec.ts`；截图在根目录 `.tmp-e2e/`。
