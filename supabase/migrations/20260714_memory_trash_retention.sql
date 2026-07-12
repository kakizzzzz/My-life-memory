-- My Life Memory seven-day trash and history retention.
--
-- This migration is intentionally separate from normalized storage v2. It
-- physically removes only the authenticated user's expired soft-deleted rows
-- and their obsolete history. app_states remains an untouched archive.

begin;

create index if not exists memory_stars_user_deleted_idx
  on public.memory_stars (user_id, deleted_at) where deleted_at is not null;
create index if not exists memory_notes_user_deleted_idx
  on public.memory_notes (user_id, deleted_at) where deleted_at is not null;
create index if not exists memory_tracks_user_deleted_idx
  on public.memory_tracks (user_id, deleted_at) where deleted_at is not null;
create index if not exists memory_history_user_changed_idx
  on public.memory_entity_history (user_id, changed_at);

create or replace function public.record_memory_history(
  p_user_id uuid,
  p_entity_type text,
  p_entity_key text,
  p_operation text,
  p_before_data jsonb,
  p_revision bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.memory_entity_history (
    user_id, entity_type, entity_key, operation, before_data, dataset_revision
  ) values (
    p_user_id, p_entity_type, p_entity_key, p_operation, p_before_data, p_revision
  );

  delete from public.memory_entity_history history
  where history.user_id = p_user_id
    and history.changed_at < now() - interval '7 days';

  delete from public.memory_entity_history history
  where history.id in (
    select old.id
    from public.memory_entity_history old
    where old.user_id = p_user_id
      and old.entity_type = p_entity_type
      and old.entity_key = p_entity_key
    order by old.changed_at desc, old.id desc
    offset 20
  );
end;
$$;

revoke all on function public.record_memory_history(uuid, text, text, text, jsonb, bigint)
  from public, anon, authenticated;

create or replace function public.purge_expired_memory_trash()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
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
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Serialize maintenance with apply_memory_mutations for this account.
  perform 1
  from public.memory_settings settings
  where settings.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Normalized memory settings are missing' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(note.star_id || '/' || note.id), array[]::text[])
  into v_note_keys
  from public.memory_notes note
  where note.user_id = v_user_id
    and note.deleted_at < v_cutoff;

  delete from public.memory_notes note
  where note.user_id = v_user_id
    and note.deleted_at < v_cutoff;
  get diagnostics v_deleted_notes = row_count;

  select coalesce(array_agg(track.id), array[]::text[])
  into v_track_keys
  from public.memory_tracks track
  where track.user_id = v_user_id
    and track.deleted_at < v_cutoff;

  delete from public.memory_tracks track
  where track.user_id = v_user_id
    and track.deleted_at < v_cutoff;
  get diagnostics v_deleted_tracks = row_count;

  -- A star is purged only after all of its child notes have independently
  -- reached the same retention cutoff and have been removed above.
  select coalesce(array_agg(star.id), array[]::text[])
  into v_star_keys
  from public.memory_stars star
  where star.user_id = v_user_id
    and star.deleted_at < v_cutoff
    and not exists (
      select 1
      from public.memory_notes child
      where child.user_id = star.user_id
        and child.star_id = star.id
    );

  delete from public.memory_stars star
  where star.user_id = v_user_id
    and star.id = any(v_star_keys);
  get diagnostics v_deleted_stars = row_count;

  delete from public.memory_entity_history history
  where history.user_id = v_user_id
    and (
      history.changed_at < v_cutoff
      or (history.entity_type = 'note' and history.entity_key = any(v_note_keys))
      or (history.entity_type = 'track' and history.entity_key = any(v_track_keys))
      or (history.entity_type = 'star' and history.entity_key = any(v_star_keys))
    );
  get diagnostics v_deleted_history = row_count;

  -- Keep the existing per-entity version ceiling even for rows younger than
  -- seven days, including history inserted outside record_memory_history.
  delete from public.memory_entity_history history
  where history.user_id = v_user_id
    and history.id in (
      select ranked.id
      from (
        select item.id, row_number() over (
          partition by item.entity_type, item.entity_key
          order by item.changed_at desc, item.id desc
        ) as position
        from public.memory_entity_history item
        where item.user_id = v_user_id
      ) ranked
      where ranked.position > 20
    );
  get diagnostics v_capped_history = row_count;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'deletedNotes', v_deleted_notes,
    'deletedTracks', v_deleted_tracks,
    'deletedStars', v_deleted_stars,
    'deletedHistory', v_deleted_history + v_capped_history
  );
end;
$$;

comment on function public.purge_expired_memory_trash() is
  'Purges only auth.uid() expired memory trash and history after seven days.';

revoke all on function public.purge_expired_memory_trash() from public, anon, service_role;
grant execute on function public.purge_expired_memory_trash() to authenticated;

commit;
