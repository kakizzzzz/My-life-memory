-- Emergency same-account recovery template.
--
-- 1. Replace TARGET_USER_ID below.
-- 2. Run only after confirming the target account is signed out everywhere.
-- 3. This script refuses cross-account import: source and destination are the
--    same auth user. It does not delete the app_states archive.
-- 4. Re-run 20260713_normalized_memory_storage_v2.sql afterwards. Its full
--    checksum gate marks this account verified; then run the verify SQL.

begin;

do $$
declare
  target_user_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  archive_state jsonb;
  expected_stars bigint;
  expected_notes bigint;
  expected_tracks bigint;
  restored_stars bigint;
  restored_notes bigint;
  restored_tracks bigint;
  recovery_revision bigint;
begin
  if target_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set TARGET_USER_ID before running recovery.';
  end if;

  select state into archive_state
  from public.app_states
  where user_id = target_user_id
  for update;
  if archive_state is null then raise exception 'No legacy archive exists for this user.'; end if;
  if not exists (select 1 from public.profiles profile where profile.id = target_user_id) then
    raise exception 'The target user profile is missing; repair it before recovery.';
  end if;

  select coalesce(dataset_revision, 0) + 1 into recovery_revision
  from public.memory_settings where user_id = target_user_id;
  recovery_revision := coalesce(recovery_revision, 1);

  -- Preserve the current normalized rows before the emergency rebuild.
  insert into public.memory_entity_history (user_id, entity_type, entity_key, operation, before_data, dataset_revision)
  select target_user_id, 'star', star.id, 'update', to_jsonb(star), recovery_revision
  from public.memory_stars star where star.user_id = target_user_id;
  insert into public.memory_entity_history (user_id, entity_type, entity_key, operation, before_data, dataset_revision)
  select target_user_id, 'note', note.star_id || '/' || note.id, 'update', to_jsonb(note), recovery_revision
  from public.memory_notes note where note.user_id = target_user_id;
  insert into public.memory_entity_history (user_id, entity_type, entity_key, operation, before_data, dataset_revision)
  select target_user_id, 'track', track.id, 'update', to_jsonb(track), recovery_revision
  from public.memory_tracks track where track.user_id = target_user_id;

  delete from public.memory_notes where user_id = target_user_id;
  delete from public.memory_stars where user_id = target_user_id;
  delete from public.memory_tracks where user_id = target_user_id;

  insert into public.memory_stars (
    user_id, id, sort_order, lat, lng, created_at_ms, tag_order, tag_group_id, color, changed_revision
  )
  select target_user_id, item.value ->> 'id', (item.ordinality - 1)::integer,
    (item.value ->> 'lat')::double precision, (item.value ->> 'lng')::double precision,
    nullif(item.value ->> 'createdAt', '')::bigint,
    nullif(item.value ->> 'tagOrder', '')::bigint,
    nullif(item.value ->> 'tagGroupId', '')::bigint,
    nullif(item.value ->> 'color', ''), 0
  from jsonb_array_elements(coalesce(archive_state -> 'stars', '[]'::jsonb)) with ordinality item(value, ordinality);

  insert into public.memory_notes (
    user_id, star_id, id, sort_order, title, title_html, content, content_html,
    image_url, image_urls, images, font_size, title_font_size, color,
    created_at_ms, updated_at_ms, changed_revision
  )
  select target_user_id, star.value ->> 'id', note.value ->> 'id', (note.ordinality - 1)::integer,
    coalesce(note.value ->> 'title', ''), coalesce(note.value ->> 'titleHtml', ''),
    coalesce(note.value ->> 'content', ''), coalesce(note.value ->> 'contentHtml', ''),
    nullif(note.value ->> 'imageUrl', ''),
    case when jsonb_typeof(note.value -> 'imageUrls') = 'array' then note.value -> 'imageUrls' else '[]'::jsonb end,
    case when jsonb_typeof(note.value -> 'images') = 'array'
      then public.memory_strip_sensitive_json(note.value -> 'images') else '[]'::jsonb end,
    nullif(note.value ->> 'fontSize', '')::double precision,
    nullif(note.value ->> 'titleFontSize', '')::double precision,
    nullif(note.value ->> 'color', ''), nullif(note.value ->> 'createdAt', '')::bigint,
    nullif(note.value ->> 'updatedAt', '')::bigint, 0
  from jsonb_array_elements(coalesce(archive_state -> 'stars', '[]'::jsonb)) with ordinality star(value, star_ordinality)
  cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality);

  insert into public.memory_tracks (
    user_id, id, sort_order, paths, color, duration_seconds, distance_km,
    created_at_ms, updated_at_ms, changed_revision
  )
  select target_user_id, item.value ->> 'id', (item.ordinality - 1)::integer,
    coalesce(item.value -> 'paths', '[]'::jsonb), nullif(item.value ->> 'color', ''),
    coalesce(nullif(item.value ->> 'time', '')::bigint, 0),
    coalesce(nullif(item.value ->> 'distance', '')::double precision, 0),
    nullif(item.value ->> 'createdAt', '')::bigint,
    nullif(item.value ->> 'updatedAt', '')::bigint, 0
  from jsonb_array_elements(coalesce(archive_state -> 'savedTracks', '[]'::jsonb)) with ordinality item(value, ordinality);

  insert into public.memory_settings (
    user_id, map_style, system_theme, language, profile_conflicts, profile_metadata,
    dataset_revision, data_model_version, migration_verified_at
  ) values (
    target_user_id,
    case when archive_state ->> 'mapStyle' in ('light', 'dark', 'aerial') then archive_state ->> 'mapStyle' else 'light' end,
    case when jsonb_typeof(archive_state -> 'systemTheme') = 'object'
      then public.memory_strip_sensitive_json(archive_state -> 'systemTheme') else '{}'::jsonb end,
    coalesce(nullif(archive_state ->> 'language', ''), 'en'),
    case when jsonb_typeof(archive_state -> 'profileConflicts') = 'array'
      then public.memory_strip_sensitive_json(archive_state -> 'profileConflicts') else '[]'::jsonb end,
    public.memory_strip_sensitive_json(
      jsonb_strip_nulls(jsonb_build_object('avatarImage', archive_state #> '{profile,avatarImage}'))
    ),
    0, 2, null
  ) on conflict (user_id) do update set
    map_style = excluded.map_style,
    system_theme = excluded.system_theme,
    language = excluded.language,
    profile_conflicts = excluded.profile_conflicts,
    profile_metadata = excluded.profile_metadata,
    dataset_revision = 0,
    data_model_version = 2,
    migration_verified_at = null,
    migration_verification = null;

  expected_stars := jsonb_array_length(coalesce(archive_state -> 'stars', '[]'::jsonb));
  select count(*) into expected_notes
  from jsonb_array_elements(coalesce(archive_state -> 'stars', '[]'::jsonb)) star
  cross join lateral jsonb_array_elements(coalesce(star -> 'notes', '[]'::jsonb)) note;
  expected_tracks := jsonb_array_length(coalesce(archive_state -> 'savedTracks', '[]'::jsonb));
  select count(*) into restored_stars from public.memory_stars where user_id = target_user_id;
  select count(*) into restored_notes from public.memory_notes where user_id = target_user_id;
  select count(*) into restored_tracks from public.memory_tracks where user_id = target_user_id;
  if expected_stars <> restored_stars or expected_notes <> restored_notes or expected_tracks <> restored_tracks then
    raise exception 'Recovery count verification failed; transaction will roll back.';
  end if;
end;
$$;

-- The account intentionally remains unverified until the full migration
-- checksum gate is rerun. This prevents a count-only recovery from being
-- mistaken for a complete content verification.
commit;
