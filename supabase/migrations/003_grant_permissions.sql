-- 修复：授予 anon 和 authenticated 角色表级权限
-- RLS 策略控制行级访问，但角色首先需要有表级 GRANT

grant usage on schema public to anon, authenticated, service_role;

-- reading_items
grant select, insert, update, delete on public.reading_items to authenticated;
grant select on public.reading_items to anon;

-- notes
grant select, insert, update, delete on public.notes to authenticated;
grant select on public.notes to anon;

-- tags
grant select, insert, update, delete on public.tags to authenticated;
grant select on public.tags to anon;

-- item_tags
grant select, insert, delete on public.item_tags to authenticated;
grant select on public.item_tags to anon;

-- plugins
grant select, insert, update, delete on public.plugins to authenticated;
grant select on public.plugins to anon;
