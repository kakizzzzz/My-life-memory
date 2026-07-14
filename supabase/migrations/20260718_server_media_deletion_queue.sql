-- Server-owned media deletion queue.
--
-- Browser maintenance remains a best-effort accelerator, but this queue and
-- the media-retention Edge Function provide the final deletion guarantee for
-- Storage objects whose database references have expired.

begin;

create table if not exists public.memory_media_deletion_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'life-media',
  path text not null,
  reason text not null default 'retention',
  not_before timestamptz not null default now(),
  attempts integer not null default 0,
  claimed_until timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_media_queue_bucket_valid check (bucket = 'life-media'),
  constraint memory_media_queue_path_scoped check (path like user_id::text || '/%'),
  constraint memory_media_queue_path_not_blank check (length(path) > 0),
  constraint memory_media_queue_attempts_nonnegative check (attempts >= 0),
  unique (user_id, bucket, path)
);

create index if not exists memory_media_queue_due_idx
  on public.memory_media_deletion_queue (not_before, id)
  where claimed_until is null;
create index if not exists memory_media_queue_claim_idx
  on public.memory_media_deletion_queue (claimed_until, id)
  where claimed_until is not null;

alter table public.memory_media_deletion_queue enable row level security;
revoke all on public.memory_media_deletion_queue from public, anon, authenticated, service_role;

create or replace function public.memory_enqueue_media_paths_for_user(
  p_user_id uuid,
  p_value jsonb,
  p_html text,
  p_not_before timestamptz,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_user_id is null then return 0; end if;

  with candidate_paths as (
    select media.path
    from public.memory_media_paths_from_json(coalesce(p_value, 'null'::jsonb), p_user_id) media(path)
    union
    select match[1]
    from regexp_matches(
      coalesce(p_html, ''),
      'data-(?:media|storage)-(?:path|key)=["'']([^"'']+)["'']',
      'g'
    ) match
  ), valid_paths as (
    select distinct candidate.path
    from candidate_paths candidate
    where candidate.path like p_user_id::text || '/%'
  ), queued as (
    insert into public.memory_media_deletion_queue (
      user_id, bucket, path, reason, not_before, claimed_until, last_error, updated_at
    )
    select
      p_user_id,
      'life-media',
      valid.path,
      left(coalesce(nullif(p_reason, ''), 'retention'), 80),
      coalesce(p_not_before, now()),
      null,
      null,
      now()
    from valid_paths valid
    on conflict (user_id, bucket, path) do update
    set not_before = greatest(
          public.memory_media_deletion_queue.not_before,
          excluded.not_before
        ),
        reason = excluded.reason,
        claimed_until = null,
        last_error = null,
        updated_at = now()
    returning 1
  )
  select count(*)::integer into v_count from queued;

  return v_count;
end;
$$;

revoke all on function public.memory_enqueue_media_paths_for_user(uuid, jsonb, text, timestamptz, text)
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_memory_media_deletion(
  p_bucket text,
  p_path text,
  p_not_before timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(p_bucket, '') <> 'life-media' then
    raise exception 'Unsupported media bucket' using errcode = '22023';
  end if;
  if coalesce(p_path, '') not like v_user_id::text || '/%' then
    raise exception 'Media path is outside the current account' using errcode = '42501';
  end if;

  perform public.memory_enqueue_media_paths_for_user(
    v_user_id,
    jsonb_build_object('provider', 'supabase', 'path', p_path),
    '',
    coalesce(p_not_before, now()),
    'client_deferred_delete'
  );
  return true;
end;
$$;

comment on function public.enqueue_memory_media_deletion(text, text, timestamptz) is
  'Queues one auth.uid()-scoped Storage path for server-side reference-checked deletion.';

revoke all on function public.enqueue_memory_media_deletion(text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.enqueue_memory_media_deletion(text, text, timestamptz)
  to authenticated;

create or replace function public.memory_queue_deleted_row_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Account deletion already removes the whole user Storage folder before the
  -- Auth cascade. Do not create new queue rows while that parent is vanishing.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;

  if tg_table_name = 'memory_notes' then
    perform public.memory_enqueue_media_paths_for_user(
      old.user_id,
      jsonb_build_array(old.images, old.image_urls, to_jsonb(old.image_url)),
      coalesce(old.title_html, '') || coalesce(old.content_html, ''),
      greatest(now(), coalesce(old.deleted_at, now()) + interval '7 days'),
      'expired_note'
    );
  elsif tg_table_name = 'memory_entity_history' then
    perform public.memory_enqueue_media_paths_for_user(
      old.user_id,
      old.before_data,
      coalesce(old.before_data ->> 'titleHtml', old.before_data ->> 'title_html', '')
        || coalesce(old.before_data ->> 'contentHtml', old.before_data ->> 'content_html', ''),
      greatest(now(), old.changed_at + interval '7 days'),
      'expired_history'
    );
  end if;
  return old;
end;
$$;

revoke all on function public.memory_queue_deleted_row_media()
  from public, anon, authenticated, service_role;

drop trigger if exists memory_notes_queue_media_before_delete on public.memory_notes;
create trigger memory_notes_queue_media_before_delete
before delete on public.memory_notes
for each row execute function public.memory_queue_deleted_row_media();

drop trigger if exists memory_history_queue_media_before_delete on public.memory_entity_history;
create trigger memory_history_queue_media_before_delete
before delete on public.memory_entity_history
for each row execute function public.memory_queue_deleted_row_media();

create or replace function public.memory_media_path_is_protected(
  p_user_id uuid,
  p_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_protected boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or coalesce(p_path, '') not like p_user_id::text || '/%' then
    return true;
  end if;

  with json_sources as (
    select settings.profile_metadata as value
    from public.memory_settings settings
    where settings.user_id = p_user_id
    union all
    select settings.profile_conflicts
    from public.memory_settings settings
    where settings.user_id = p_user_id
    union all
    select note.images
    from public.memory_notes note
    where note.user_id = p_user_id
    union all
    select note.image_urls
    from public.memory_notes note
    where note.user_id = p_user_id
    union all
    select to_jsonb(note.image_url)
    from public.memory_notes note
    where note.user_id = p_user_id
    union all
    select history.before_data
    from public.memory_entity_history history
    where history.user_id = p_user_id
  ), metadata_paths as (
    select media.path
    from json_sources source
    cross join lateral public.memory_media_paths_from_json(source.value, p_user_id) media(path)
  ), html_paths as (
    select match[1] as path
    from public.memory_notes note
    cross join lateral regexp_matches(
      coalesce(note.title_html, '') || coalesce(note.content_html, ''),
      'data-(?:media|storage)-(?:path|key)=["'']([^"'']+)["'']',
      'g'
    ) match
    where note.user_id = p_user_id
    union all
    select match[1] as path
    from public.memory_entity_history history
    cross join lateral regexp_matches(
      coalesce(history.before_data ->> 'titleHtml', history.before_data ->> 'title_html', '')
        || coalesce(history.before_data ->> 'contentHtml', history.before_data ->> 'content_html', ''),
      'data-(?:media|storage)-(?:path|key)=["'']([^"'']+)["'']',
      'g'
    ) match
    where history.user_id = p_user_id
  )
  select exists (
    select 1 from metadata_paths where path = p_path
    union all
    select 1 from html_paths where path = p_path
  ) into v_protected;

  return v_protected;
end;
$$;

revoke all on function public.memory_media_path_is_protected(uuid, text)
  from public, anon, authenticated;
grant execute on function public.memory_media_path_is_protected(uuid, text)
  to service_role;

create or replace function public.claim_due_memory_media_deletions(p_limit integer default 100)
returns table (
  queue_id bigint,
  user_id uuid,
  bucket text,
  path text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with due as (
    select item.id
    from public.memory_media_deletion_queue item
    where item.not_before <= now()
      and (item.claimed_until is null or item.claimed_until < now())
    order by item.not_before, item.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ), claimed as (
    update public.memory_media_deletion_queue item
    set attempts = item.attempts + 1,
        claimed_until = now() + interval '15 minutes',
        last_attempt_at = now(),
        updated_at = now()
    from due
    where item.id = due.id
    returning item.id, item.user_id, item.bucket, item.path, item.attempts
  )
  select claimed.id, claimed.user_id, claimed.bucket, claimed.path, claimed.attempts
  from claimed;
end;
$$;

revoke all on function public.claim_due_memory_media_deletions(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_memory_media_deletions(integer)
  to service_role;

create or replace function public.complete_memory_media_deletion(p_queue_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  delete from public.memory_media_deletion_queue where id = p_queue_id;
  return found;
end;
$$;

revoke all on function public.complete_memory_media_deletion(bigint)
  from public, anon, authenticated;
grant execute on function public.complete_memory_media_deletion(bigint)
  to service_role;

create or replace function public.fail_memory_media_deletion(
  p_queue_id bigint,
  p_error text,
  p_retry_after_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.memory_media_deletion_queue
  set claimed_until = null,
      not_before = now() + make_interval(
        secs => least(greatest(coalesce(p_retry_after_seconds, 3600), 60), 86400)
      ),
      last_error = left(coalesce(p_error, 'Unknown media deletion error'), 1000),
      updated_at = now()
  where id = p_queue_id;
  return found;
end;
$$;

revoke all on function public.fail_memory_media_deletion(bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_memory_media_deletion(bigint, text, integer)
  to service_role;

create or replace function public.run_server_memory_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return public.purge_expired_memory_trash_all_users();
end;
$$;

comment on function public.run_server_memory_retention() is
  'Service-only entry point used by the scheduled media-retention Edge Function.';

revoke all on function public.run_server_memory_retention()
  from public, anon, authenticated;
grant execute on function public.run_server_memory_retention()
  to service_role;

commit;
