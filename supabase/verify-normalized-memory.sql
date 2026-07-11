-- Read-only verification for normalized memory storage v2.
-- Run after 20260713_normalized_memory_storage_v2.sql.

with legacy as (
  select
    app.user_id,
    jsonb_array_length(coalesce(app.state -> 'stars', '[]'::jsonb)) as star_count,
    (
      select count(*)
      from jsonb_array_elements(coalesce(app.state -> 'stars', '[]'::jsonb)) star
      cross join lateral jsonb_array_elements(coalesce(star -> 'notes', '[]'::jsonb)) note
    ) as note_count,
    jsonb_array_length(coalesce(app.state -> 'savedTracks', '[]'::jsonb)) as track_count,
    (
      select md5(coalesce(string_agg(item.value ->> 'id', E'\n' order by item.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'stars', '[]'::jsonb)) with ordinality item(value, ordinality)
    ) as star_order_checksum,
    (
      select md5(coalesce(string_agg((star.value ->> 'id') || '/' || (note.value ->> 'id'), E'\n' order by star.ordinality, note.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
      cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality)
    ) as note_order_checksum,
    (
      select md5(coalesce(string_agg(item.value ->> 'id', E'\n' order by item.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'savedTracks', '[]'::jsonb)) with ordinality item(value, ordinality)
    ) as track_order_checksum,
    md5(jsonb_build_object(
      'mapStyle', case when app.state ->> 'mapStyle' in ('light', 'dark', 'aerial') then app.state ->> 'mapStyle' else 'light' end,
      'systemTheme', case when jsonb_typeof(app.state -> 'systemTheme') = 'object'
        then public.memory_strip_sensitive_json(app.state -> 'systemTheme') else '{}'::jsonb end,
      'language', coalesce(nullif(app.state ->> 'language', ''), 'en'),
      'profileConflicts', case when jsonb_typeof(app.state -> 'profileConflicts') = 'array'
        then public.memory_strip_sensitive_json(app.state -> 'profileConflicts') else '[]'::jsonb end,
      'profileMetadata', public.memory_strip_sensitive_json(
        jsonb_strip_nulls(jsonb_build_object('avatarImage', app.state #> '{profile,avatarImage}'))
      )
    )::text) as settings_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        star.value ->> 'id', star.ordinality - 1,
        (star.value ->> 'lat')::double precision, (star.value ->> 'lng')::double precision,
        nullif(star.value ->> 'createdAt', '')::bigint,
        nullif(star.value ->> 'tagOrder', '')::bigint,
        nullif(star.value ->> 'tagGroupId', '')::bigint,
        nullif(star.value ->> 'color', '')
      )::text, E'\n' order by star.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
    ) as star_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        star.value ->> 'id', note.value ->> 'id', star.ordinality - 1, note.ordinality - 1,
        coalesce(note.value ->> 'title', ''), coalesce(note.value ->> 'titleHtml', ''),
        coalesce(note.value ->> 'content', ''), coalesce(note.value ->> 'contentHtml', ''),
        nullif(note.value ->> 'imageUrl', ''),
        case when jsonb_typeof(note.value -> 'imageUrls') = 'array' then note.value -> 'imageUrls' else '[]'::jsonb end,
        case when jsonb_typeof(note.value -> 'images') = 'array'
          then public.memory_strip_sensitive_json(note.value -> 'images') else '[]'::jsonb end,
        nullif(note.value ->> 'fontSize', '')::double precision,
        nullif(note.value ->> 'titleFontSize', '')::double precision,
        nullif(note.value ->> 'color', ''),
        nullif(note.value ->> 'createdAt', '')::bigint,
        nullif(note.value ->> 'updatedAt', '')::bigint
      )::text, E'\n' order by star.ordinality, note.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
      cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality)
    ) as note_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        track.value ->> 'id', track.ordinality - 1, coalesce(track.value -> 'paths', '[]'::jsonb),
        nullif(track.value ->> 'color', ''),
        coalesce(nullif(track.value ->> 'time', '')::bigint, 0),
        coalesce(nullif(track.value ->> 'distance', '')::double precision, 0),
        nullif(track.value ->> 'createdAt', '')::bigint,
        nullif(track.value ->> 'updatedAt', '')::bigint
      )::text, E'\n' order by track.ordinality), ''))
      from jsonb_array_elements(coalesce(app.state -> 'savedTracks', '[]'::jsonb)) with ordinality track(value, ordinality)
    ) as track_content_checksum
  from public.app_states app
), normalized as (
  select
    settings.user_id,
    settings.dataset_revision,
    settings.data_model_version,
    settings.migration_verified_at,
    settings.migration_verification,
    (select count(*) from public.memory_stars star where star.user_id = settings.user_id and star.deleted_at is null) as star_count,
    (select count(*) from public.memory_notes note where note.user_id = settings.user_id and note.deleted_at is null) as note_count,
    (select count(*) from public.memory_tracks track where track.user_id = settings.user_id and track.deleted_at is null) as track_count,
    (
      select md5(coalesce(string_agg(star.id, E'\n' order by star.sort_order, star.id), ''))
      from public.memory_stars star where star.user_id = settings.user_id and star.deleted_at is null
    ) as star_order_checksum,
    (
      select md5(coalesce(string_agg(note.star_id || '/' || note.id, E'\n' order by parent.sort_order, note.sort_order, note.id), ''))
      from public.memory_notes note
      join public.memory_stars parent on parent.user_id = note.user_id and parent.id = note.star_id
      where note.user_id = settings.user_id and note.deleted_at is null
    ) as note_order_checksum,
    (
      select md5(coalesce(string_agg(track.id, E'\n' order by track.sort_order, track.id), ''))
      from public.memory_tracks track where track.user_id = settings.user_id and track.deleted_at is null
    ) as track_order_checksum,
    md5(jsonb_build_object(
      'mapStyle', settings.map_style,
      'systemTheme', settings.system_theme,
      'language', settings.language,
      'profileConflicts', settings.profile_conflicts,
      'profileMetadata', settings.profile_metadata
    )::text) as settings_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        star.id, star.sort_order, star.lat, star.lng, star.created_at_ms,
        star.tag_order, star.tag_group_id, star.color
      )::text, E'\n' order by star.sort_order, star.id), ''))
      from public.memory_stars star where star.user_id = settings.user_id and star.deleted_at is null
    ) as star_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        note.star_id, note.id, parent.sort_order, note.sort_order,
        note.title, note.title_html, note.content, note.content_html,
        note.image_url, note.image_urls, note.images, note.font_size,
        note.title_font_size, note.color, note.created_at_ms, note.updated_at_ms
      )::text, E'\n' order by parent.sort_order, note.sort_order, note.id), ''))
      from public.memory_notes note
      join public.memory_stars parent on parent.user_id = note.user_id and parent.id = note.star_id
      where note.user_id = settings.user_id and note.deleted_at is null
    ) as note_content_checksum,
    (
      select md5(coalesce(string_agg(jsonb_build_array(
        track.id, track.sort_order, track.paths, track.color,
        track.duration_seconds, track.distance_km, track.created_at_ms, track.updated_at_ms
      )::text, E'\n' order by track.sort_order, track.id), ''))
      from public.memory_tracks track where track.user_id = settings.user_id and track.deleted_at is null
    ) as track_content_checksum
  from public.memory_settings settings
)
select
  coalesce(legacy.user_id, normalized.user_id) as user_id,
  normalized.data_model_version,
  normalized.dataset_revision,
  normalized.migration_verified_at,
  legacy.star_count as legacy_stars,
  normalized.star_count as normalized_stars,
  legacy.note_count as legacy_notes,
  normalized.note_count as normalized_notes,
  legacy.track_count as legacy_tracks,
  normalized.track_count as normalized_tracks,
  legacy.star_order_checksum = normalized.star_order_checksum as star_ids_and_order_match,
  legacy.note_order_checksum = normalized.note_order_checksum as note_ids_parents_and_order_match,
  legacy.track_order_checksum = normalized.track_order_checksum as track_ids_and_order_match,
  legacy.settings_content_checksum = normalized.settings_content_checksum as settings_content_matches,
  legacy.star_content_checksum = normalized.star_content_checksum as star_content_matches,
  legacy.note_content_checksum = normalized.note_content_checksum as note_content_matches,
  legacy.track_content_checksum = normalized.track_content_checksum as track_content_matches,
  normalized.migration_verification,
  (
    legacy.star_count = normalized.star_count
    and legacy.note_count = normalized.note_count
    and legacy.track_count = normalized.track_count
    and legacy.star_order_checksum = normalized.star_order_checksum
    and legacy.note_order_checksum = normalized.note_order_checksum
    and legacy.track_order_checksum = normalized.track_order_checksum
    and legacy.settings_content_checksum = normalized.settings_content_checksum
    and legacy.star_content_checksum = normalized.star_content_checksum
    and legacy.note_content_checksum = normalized.note_content_checksum
    and legacy.track_content_checksum = normalized.track_content_checksum
    and normalized.migration_verified_at is not null
  ) as migration_verified
from legacy
full join normalized using (user_id)
order by user_id;

-- These queries must return zero rows.
select app.user_id
from public.app_states app
left join public.profiles profile on profile.id = app.user_id
where profile.id is null;

select note.user_id, note.star_id, note.id
from public.memory_notes note
left join public.memory_stars star
  on star.user_id = note.user_id and star.id = note.star_id
where star.id is null;

select user_id, id, changed_revision
from public.memory_stars where changed_revision < 0
union all
select user_id, id, changed_revision
from public.memory_tracks where changed_revision < 0;
