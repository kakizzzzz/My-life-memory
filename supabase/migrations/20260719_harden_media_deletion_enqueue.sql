-- Harden the authenticated media deletion handoff without weakening the
-- database-owned deletion triggers. Client requests must reference a real,
-- account-scoped Storage object and cannot postpone deletion indefinitely.

begin;

-- Keep an old client call from inserting another far-future row between the
-- cleanup below and the function replacement in this transaction.
lock table public.memory_media_deletion_queue in share row exclusive mode;

update public.memory_media_deletion_queue
set not_before = now() + interval '7 days',
    updated_at = now()
where not_before > now() + interval '7 days';

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
  v_not_before timestamptz := least(
    greatest(coalesce(p_not_before, now()), now()),
    now() + interval '7 days'
  );
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
      and char_length(candidate.path) between 1 and 1024
      and candidate.path ~ '^[A-Za-z0-9_./-]+$'
      and candidate.path !~ '(^|/)[.]{1,2}(/|$)'
      and strpos(candidate.path, '//') = 0
  ), queued as (
    insert into public.memory_media_deletion_queue (
      user_id, bucket, path, reason, not_before, claimed_until, last_error, updated_at
    )
    select
      p_user_id,
      'life-media',
      valid.path,
      left(coalesce(nullif(p_reason, ''), 'retention'), 80),
      v_not_before,
      null,
      null,
      now()
    from valid_paths valid
    on conflict (user_id, bucket, path) do update
    set not_before = least(
          public.memory_media_deletion_queue.not_before,
          excluded.not_before,
          now() + interval '7 days'
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
  v_not_before timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(p_bucket, '') <> 'life-media' then
    raise exception 'Unsupported media bucket' using errcode = '22023';
  end if;
  if p_path is null
    or char_length(p_path) not between 1 and 1024
    or p_path !~ '^[A-Za-z0-9_./-]+$'
    or p_path ~ '(^|/)[.]{1,2}(/|$)'
    or strpos(p_path, '//') > 0
  then
    raise exception 'Invalid media path' using errcode = '22023';
  end if;
  if p_path not like v_user_id::text || '/%' then
    raise exception 'Media path is outside the current account' using errcode = '42501';
  end if;

  -- A missing object is already in the desired end state. Do not let clients
  -- fill the private queue with invented paths.
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'life-media'
      and object.name = p_path
  ) then
    return false;
  end if;

  v_not_before := least(
    greatest(coalesce(p_not_before, now()), now()),
    now() + interval '7 days'
  );

  perform public.memory_enqueue_media_paths_for_user(
    v_user_id,
    jsonb_build_object('provider', 'supabase', 'path', p_path),
    '',
    v_not_before,
    'client_deferred_delete'
  );
  return true;
end;
$$;

comment on function public.enqueue_memory_media_deletion(text, text, timestamptz) is
  'Queues an existing auth.uid()-scoped Storage path, capped to seven days, for reference-checked deletion.';

revoke all on function public.enqueue_memory_media_deletion(text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.enqueue_memory_media_deletion(text, text, timestamptz)
  to authenticated;

commit;
