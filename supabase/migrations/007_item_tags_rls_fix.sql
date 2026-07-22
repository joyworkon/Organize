-- 修复 item_tags 的 INSERT RLS 漏洞
-- 原来的 policy 只校验 reading_items 归属，没校验 tags 归属
-- 导致用户可以把别人的 tag_id 挂到自己的 reading_item 上（IDOR）
-- 与 note_tags（005 迁移）对齐

drop policy if exists "Users can insert own item_tags" on item_tags;

create policy "Users can insert own item_tags" on item_tags
  for insert with check (
    exists (select 1 from reading_items where id = item_id and user_id = auth.uid())
    and exists (select 1 from tags where id = tag_id and user_id = auth.uid())
  );
