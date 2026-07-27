-- 标签增加颜色字段
alter table tags add column if not exists color text default 'blue' check (color in ('gray', 'red', 'orange', 'amber', 'yellow', 'green', 'emerald', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose')) not null;
