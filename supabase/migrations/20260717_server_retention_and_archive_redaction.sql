-- Server-enforced memory retention and one-time legacy credential redaction.
--
-- The normalized rows remain the source of truth. This migration does not
-- remove the v1 app_states recovery archive; it only strips credential-like
-- keys that should never have been retained there.

begin;

create or replace function public.purge_expired_memory_trash_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '7 days';
  v_note_keys text[] := array[]::text[];
  v_track_keys text[] := array[]::text[];
  v_star_keys text[] := array[]::text[];
  v_deleted_notes integer := 0;
  v_deleted_tracks integer := 0;
  v_deleted_stars integer := 0;
  v_deleted_history integer := 0;
  v_capped_history integer := 0;
begin
  if p_user_id is null then
    raise exception 'User ID is required' using errcode = '22023';
  end if;

  -- Serialize maintenance with apply_memory_mutations for this account.
  perform 1
  from public.memory_settings settings
  where settings.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Normalized memory settings are missing' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(note.star_id || '/' || note.id), array[]::text[])
  into v_note_keys
  from public.memory_notes note
  where note.user_id = p_user_id
    and note.deleted_at < v_cutoff;

  delete from public.memory_notes note
  where note.user_id = p_user_id
    and note.deleted_at < v_cutoff;
  get diagnostics v_deleted_notes = row_count;

  select coalesce(array_agg(track.id), array[]::text[])
  into v_track_keys
  from public.memory_tracks track
  where track.user_id = p_user_id
    and track.deleted_at < v_cutoff;

  delete from public.memory_tracks track
  where track.user_id = p_user_id
    and track.deleted_at < v_cutoff;
  get diagnostics v_deleted_tracks = row_count;

  select coalesce(array_agg(star.id), array[]::text[])
  into v_star_keys
  from public.memory_stars star
  where star.user_id = p_user_id
    and star.deleted_at < v_cutoff
    and not exists (
      select 1
      from public.memory_notes child
      where child.user_id = star.user_id
        and child.star_id = star.id
    );

  delete from public.memory_stars star
  where star.user_id = p_user_id
    and star.id = any(v_star_keys);
  get diagnostics v_deleted_stars = row_count;

  delete from public.memory_entity_history history
  where history.user_id = p_user_id
    and (
      history.changed_at < v_cutoff
      or (history.entity_type = 'note' and history.entity_key = any(v_note_keys))
      or (history.entity_type = 'track' and history.entity_key = any(v_track_keys))
      or (history.entity_type = 'star' and history.entity_key = any(v_star_keys))
    );
  get diagnostics v_deleted_history = row_count;

  delete from public.memory_entity_history history
  where history.user_id = p_user_id
    and history.id in (
      select ranked.id
      from (
        select item.id, row_number() over (
          partition by item.entity_type, item.entity_key
          order by item.changed_at desc, item.id desc
        ) as position
        from public.memory_entity_history item
        where item.user_id = p_user_id
      ) ranked
      where ranked.position > 20
    );
  get diagnostics v_capped_history = row_count;

  return jsonb_build_object(
    'userId', p_user_id,
    'cutoff', v_cutoff,
    'deletedNotes', v_deleted_notes,
    'deletedTracks', v_deleted_tracks,
    'deletedStars', v_deleted_stars,
    'deletedHistory', v_deleted_history + v_capped_history
  );
end;
$$;

revoke all on function public.purge_expired_memory_trash_for_user(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.purge_expired_memory_trash()
returns jsonb
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
  return public.purge_expired_memory_trash_for_user(v_user_id);
end;
$$;

comment on function public.purge_expired_memory_trash() is
  'Purges only auth.uid() expired memory trash and history after seven days.';

revoke all on function public.purge_expired_memory_trash() from public, anon, service_role;
grant execute on function public.purge_expired_memory_trash() to authenticated;

create or replace function public.purge_expired_memory_trash_all_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_processed integer := 0;
  v_failed integer := 0;
  v_deleted_notes integer := 0;
  v_deleted_tracks integer := 0;
  v_deleted_stars integer := 0;
  v_deleted_history integer := 0;
begin
  for v_user_id in
    select distinct candidate.user_id
    from (
      select note.user_id
      from public.memory_notes note
      where note.deleted_at < now() - interval '7 days'
      union all
      select track.user_id
      from public.memory_tracks track
      where track.deleted_at < now() - interval '7 days'
      union all
      select star.user_id
      from public.memory_stars star
      where star.deleted_at < now() - interval '7 days'
      union all
      select history.user_id
      from public.memory_entity_history history
      where history.changed_at < now() - interval '7 days'
    ) candidate
  loop
    begin
      v_result := public.purge_expired_memory_trash_for_user(v_user_id);
      v_processed := v_processed + 1;
      v_deleted_notes := v_deleted_notes + coalesce((v_result ->> 'deletedNotes')::integer, 0);
      v_deleted_tracks := v_deleted_tracks + coalesce((v_result ->> 'deletedTracks')::integer, 0);
      v_deleted_stars := v_deleted_stars + coalesce((v_result ->> 'deletedStars')::integer, 0);
      v_deleted_history := v_deleted_history + coalesce((v_result ->> 'deletedHistory')::integer, 0);
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'Memory retention failed for user %: %', v_user_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'processedUsers', v_processed,
    'failedUsers', v_failed,
    'deletedNotes', v_deleted_notes,
    'deletedTracks', v_deleted_tracks,
    'deletedStars', v_deleted_stars,
    'deletedHistory', v_deleted_history,
    'completedAt', now()
  );
end;
$$;

comment on function public.purge_expired_memory_trash_all_users() is
  'Owner-only daily retention task for expired normalized memory rows.';

revoke all on function public.purge_expired_memory_trash_all_users()
  from public, anon, authenticated, service_role;

-- Remove credential-like fields without deleting the legacy recovery data.
update public.app_states archive
set state = public.memory_strip_sensitive_json(archive.state)
where public.memory_json_has_sensitive_keys(archive.state);

-- Supabase Cron uses pg_cron. PGlite and local test databases may not expose
-- that extension, so installation and scheduling are intentionally guarded.
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
  end if;

  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is unavailable; schedule the owner-only purge manually.';
    return;
  end if;

  for v_job_id in execute
    'select jobid from cron.job where jobname = ''my-life-memory-expired-trash-daily'''
  loop
    execute 'select cron.unschedule($1)' using v_job_id;
  end loop;

  execute $schedule$
    select cron.schedule(
      'my-life-memory-expired-trash-daily',
      '23 3 * * *',
      'select public.purge_expired_memory_trash_all_users();'
    )
  $schedule$;
end;
$$;

commit;
