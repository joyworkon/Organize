begin;
select plan(11);
insert into auth.users (id, email) values
 ('88000000-0000-4000-8000-000000000001', 'template-owner@test'),
 ('88000000-0000-4000-8000-000000000002', 'template-restore@test');
insert into public.notes (id, user_id, title, content) values
 ('88000000-0000-4000-8000-000000000003', '88000000-0000-4000-8000-000000000001', 'Template', '{"type":"doc","content":[{"type":"paragraph"}]}');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000003'), 'default', 'New notes default to the simple template');
set role authenticated;
set request.jwt.claim.sub to '88000000-0000-4000-8000-000000000001';
select is((public.save_note_with_tasks(
 p_note_id := '88000000-0000-4000-8000-000000000003', p_content := '{"type":"doc","content":[{"type":"paragraph"}]}',
 p_expected_note_revision := 0, p_note_snapshot := '{"page_template":"red-blue"}'))->>'status', 'ok', 'v1 saves the template atomically');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000003'), 'red-blue', 'Template survives a database read');
select is((public.save_note_with_tasks_v2(
 p_note_id := '88000000-0000-4000-8000-000000000003', p_content := '{"type":"doc","content":[{"type":"paragraph"}]}',
 p_expected_note_revision := 1, p_note_snapshot := '{}'))->>'status', 'ok', 'An old client can still save');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000003'), 'red-blue', 'Old clients do not reset the template');
select is((public.save_note_with_tasks_v2(
 p_note_id := '88000000-0000-4000-8000-000000000003', p_content := '{"type":"doc","content":[{"type":"paragraph"}]}',
 p_expected_note_revision := 0, p_note_snapshot := '{"page_template":"default"}'))->>'status', 'conflict_note', 'Stale template change conflicts');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000003'), 'red-blue', 'Conflict preserves the template');
select is((public.save_note_with_tasks_v2(
 p_note_id := '88000000-0000-4000-8000-000000000003', p_content := '{"type":"doc","content":[{"type":"paragraph"}]}',
 p_expected_note_revision := 2, p_note_snapshot := '{"page_template":"default"}'))->>'status', 'ok', 'v2 switches back to default');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000003'), 'default', 'Default is persisted too');
reset role;
set role authenticated;
set request.jwt.claim.sub to '88000000-0000-4000-8000-000000000002';
create temp table template_restore as
select public.restore_backup_v2_full(jsonb_build_object('restore_payload_version', 1, 'data',
 (select jsonb_object_agg(name, '[]'::jsonb) from unnest(array[
 'reading_items','notes','tags','item_tags','note_tags','tasks','task_dependencies','task_checklists','task_tags',
 'lessons','lesson_tags','highlights','favorites','note_versions','note_comment_threads','note_comments','note_suggestions',
 'synced_blocks','db_databases','db_rows','task_lists','task_reminders','task_attachments','task_activities',
 'task_templates','countdown_days','memos','memo_notes','task_item_refs','canvas_documents'
 ]) name) || jsonb_build_object('notes', jsonb_build_array(jsonb_build_object(
 'id','88000000-0000-4000-8000-000000000004','title','Restored template',
 'content','{"type":"doc","content":[{"type":"paragraph","attrs":{"sectionStart":true}}]}'::jsonb,
 'page_template','red-blue','is_pinned',false,'created_at',now(),'updated_at',now()
 )))
)) as result;
select is((select result->>'status' from template_restore), 'restored', 'Restore completes');
select is((select page_template from public.notes where id='88000000-0000-4000-8000-000000000004'), 'red-blue', 'Backup restore preserves the template');
select * from finish();
rollback;
