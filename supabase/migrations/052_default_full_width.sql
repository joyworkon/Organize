-- 所有界面宽度自适应：笔记与文章的 full_width 默认值翻为 true（与前端默认全宽一致），
-- 并把存量 false 行一并置为 true；页面内的「默认宽度」开关仍可逐条切回窄栏。

alter table notes alter column full_width set default true;
update notes set full_width = true where full_width = false;

alter table reading_items alter column full_width set default true;
update reading_items set full_width = true where full_width = false;
