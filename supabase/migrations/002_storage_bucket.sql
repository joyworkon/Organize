-- 创建图片存储 bucket
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

-- 允许用户上传到自己的目录
create policy "Users can upload own images"
on storage.objects for insert
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 允许所有人查看图片（公开 bucket）
create policy "Public can view images"
on storage.objects for select
using (bucket_id = 'images');

-- 允许用户删除自己的图片
create policy "Users can delete own images"
on storage.objects for delete
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
