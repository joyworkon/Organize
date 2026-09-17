-- 新建笔记默认非全宽：仅把 notes.full_width 的列默认值翻回 false（052 曾翻为 true）。
-- 只改默认，不更新存量行——已存在的笔记保持各自当前宽度，页面菜单仍可逐篇切换。

alter table notes alter column full_width set default false;
