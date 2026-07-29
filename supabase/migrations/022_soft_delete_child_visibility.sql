-- Child records stay stored while their parent is in trash, but normal APIs hide them.

drop policy if exists "Users manage own note comment threads" on public.note_comment_threads;
create policy "Users can view active note comment threads"
  on public.note_comment_threads for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can insert active note comment threads"
  on public.note_comment_threads for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can update active note comment threads"
  on public.note_comment_threads for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can delete active note comment threads"
  on public.note_comment_threads for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );

drop policy if exists "Users manage own note comments" on public.note_comments;
create policy "Users can view active note comments"
  on public.note_comments for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.note_comment_threads thread
      join public.notes n on n.id = thread.note_id
      where thread.id = thread_id
        and thread.user_id = auth.uid()
        and n.user_id = auth.uid()
        and n.deleted_at is null
    )
  );
create policy "Users can insert active note comments"
  on public.note_comments for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.note_comment_threads thread
      join public.notes n on n.id = thread.note_id
      where thread.id = thread_id
        and thread.user_id = auth.uid()
        and n.user_id = auth.uid()
        and n.deleted_at is null
    )
  );
create policy "Users can update active note comments"
  on public.note_comments for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.note_comment_threads thread
      join public.notes n on n.id = thread.note_id
      where thread.id = thread_id
        and thread.user_id = auth.uid()
        and n.user_id = auth.uid()
        and n.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.note_comment_threads thread
      join public.notes n on n.id = thread.note_id
      where thread.id = thread_id
        and thread.user_id = auth.uid()
        and n.user_id = auth.uid()
        and n.deleted_at is null
    )
  );
create policy "Users can delete active note comments"
  on public.note_comments for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.note_comment_threads thread
      join public.notes n on n.id = thread.note_id
      where thread.id = thread_id
        and thread.user_id = auth.uid()
        and n.user_id = auth.uid()
        and n.deleted_at is null
    )
  );

drop policy if exists "Users manage own note suggestions" on public.note_suggestions;
create policy "Users can view active note suggestions"
  on public.note_suggestions for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can insert active note suggestions"
  on public.note_suggestions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can update active note suggestions"
  on public.note_suggestions for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );
create policy "Users can delete active note suggestions"
  on public.note_suggestions for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = auth.uid() and n.deleted_at is null
    )
  );

drop policy if exists "Users can view own highlights" on public.highlights;
drop policy if exists "Users can insert own highlights" on public.highlights;
drop policy if exists "Users can update own highlights" on public.highlights;
drop policy if exists "Users can delete own highlights" on public.highlights;
create policy "Users can view highlights on active reading"
  on public.highlights for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.reading_items r
      where r.id = reading_item_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );
create policy "Users can insert highlights on active reading"
  on public.highlights for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.reading_items r
      where r.id = reading_item_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );
create policy "Users can update highlights on active reading"
  on public.highlights for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.reading_items r
      where r.id = reading_item_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.reading_items r
      where r.id = reading_item_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );
create policy "Users can delete highlights on active reading"
  on public.highlights for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.reading_items r
      where r.id = reading_item_id
        and r.user_id = auth.uid()
        and r.deleted_at is null
    )
  );

drop policy if exists "Users can view own favorites" on public.favorites;
drop policy if exists "Users can insert own favorites" on public.favorites;
drop policy if exists "Users can delete own favorites" on public.favorites;
create policy "Users can view favorites for active targets"
  on public.favorites for select
  using (
    auth.uid() = user_id
    and case target_type
      when 'reading' then exists (
        select 1 from public.reading_items r
        where r.id = target_id and r.user_id = auth.uid() and r.deleted_at is null
      )
      when 'note' then exists (
        select 1 from public.notes n
        where n.id = target_id and n.user_id = auth.uid() and n.deleted_at is null
      )
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = target_id and t.user_id = auth.uid() and t.deleted_at is null
      )
      else false
    end
  );
create policy "Users can insert favorites for active targets"
  on public.favorites for insert
  with check (
    auth.uid() = user_id
    and case target_type
      when 'reading' then exists (
        select 1 from public.reading_items r
        where r.id = target_id and r.user_id = auth.uid() and r.deleted_at is null
      )
      when 'note' then exists (
        select 1 from public.notes n
        where n.id = target_id and n.user_id = auth.uid() and n.deleted_at is null
      )
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = target_id and t.user_id = auth.uid() and t.deleted_at is null
      )
      else false
    end
  );
create policy "Users can delete favorites for active targets"
  on public.favorites for delete
  using (
    auth.uid() = user_id
    and case target_type
      when 'reading' then exists (
        select 1 from public.reading_items r
        where r.id = target_id and r.user_id = auth.uid() and r.deleted_at is null
      )
      when 'note' then exists (
        select 1 from public.notes n
        where n.id = target_id and n.user_id = auth.uid() and n.deleted_at is null
      )
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = target_id and t.user_id = auth.uid() and t.deleted_at is null
      )
      else false
    end
  );
