-- 创建附件存储 bucket（笔记内拖入的视频 / 音频 / 文档等非图片文件）
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- 允许用户上传到自己的目录
create policy "Users can upload own attachments"
on storage.objects for insert
with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 允许所有人查看附件（公开 bucket，分享页面可访问）
create policy "Public can view attachments"
on storage.objects for select
using (bucket_id = 'attachments');

-- 允许用户删除自己的附件
create policy "Users can delete own attachments"
on storage.objects for delete
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
