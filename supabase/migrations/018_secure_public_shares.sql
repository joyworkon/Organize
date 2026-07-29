-- Public shares are capabilities: the token RPC is the only anonymous read path.

drop policy if exists "Public can read shared notes via token" on public.notes;
drop policy if exists "Public can read shared reading_items via token" on public.reading_items;

drop policy if exists "Owners can view own shares" on public.shares;
create policy "Owners can view own shares" on public.shares
  for select using (auth.uid() = owner_id);

revoke all on table public.shares from anon;
revoke select on table public.notes from anon;
revoke select on table public.reading_items from anon;

create or replace function public.get_public_share(p_token text)
returns table (
  status text,
  resource_type text,
  expires_at timestamptz,
  resource jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  selected_share public.shares%rowtype;
  payload jsonb;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 256 then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  select s.*
    into selected_share
    from public.shares s
    where s.token = p_token
    limit 1;

  if not found or not selected_share.is_public then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  if selected_share.expires_at is not null and selected_share.expires_at <= now() then
    return query
      select 'expired'::text, selected_share.resource_type, selected_share.expires_at, null::jsonb;
    return;
  end if;

  if selected_share.resource_type = 'note' then
    select jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'content', n.content
    )
      into payload
      from public.notes n
      where n.id = selected_share.resource_id
        and n.user_id = selected_share.owner_id;
  elsif selected_share.resource_type = 'reading_item' then
    select jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'content', r.content,
      'excerpt', r.excerpt,
      'cover_image', r.cover_image,
      'url', r.url
    )
      into payload
      from public.reading_items r
      where r.id = selected_share.resource_id
        and r.user_id = selected_share.owner_id;
  end if;

  if payload is null then
    return query select 'missing'::text, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  return query
    select 'active'::text, selected_share.resource_type, selected_share.expires_at, payload;
end;
$$;

revoke all on function public.get_public_share(text) from public;
grant execute on function public.get_public_share(text) to anon, authenticated;
