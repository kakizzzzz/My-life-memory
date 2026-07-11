-- My Life Memory normalized storage v2.
--
-- This migration is intentionally additive and idempotent. It never deletes or
-- rewrites app_states.state. Run it before deploying a v2 frontend.

begin;

create table if not exists public.memory_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  map_style text not null default 'light',
  system_theme jsonb not null default '{}'::jsonb,
  language text not null default 'en',
  profile_conflicts jsonb not null default '[]'::jsonb,
  profile_metadata jsonb not null default '{}'::jsonb,
  dataset_revision bigint not null default 0,
  data_model_version integer not null default 2,
  migration_verified_at timestamptz,
  migration_verification jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_settings_map_style_valid check (map_style in ('light', 'dark', 'aerial')),
  constraint memory_settings_language_valid check (length(language) between 1 and 16),
  constraint memory_settings_system_theme_object check (jsonb_typeof(system_theme) = 'object'),
  constraint memory_settings_profile_conflicts_array check (jsonb_typeof(profile_conflicts) = 'array'),
  constraint memory_settings_profile_metadata_object check (jsonb_typeof(profile_metadata) = 'object'),
  constraint memory_settings_revision_nonnegative check (dataset_revision >= 0),
  constraint memory_settings_model_version_valid check (data_model_version >= 2)
);

create table if not exists public.memory_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  sort_order integer not null,
  lat double precision not null,
  lng double precision not null,
  created_at_ms bigint,
  tag_order bigint,
  tag_group_id bigint,
  color text,
  changed_revision bigint not null default 0,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint memory_stars_id_not_blank check (length(id) > 0),
  constraint memory_stars_sort_order_nonnegative check (sort_order >= 0),
  constraint memory_stars_lat_valid check (lat between -90 and 90),
  constraint memory_stars_lng_valid check (lng between -180 and 180),
  constraint memory_stars_created_at_nonnegative check (created_at_ms is null or created_at_ms >= 0),
  constraint memory_stars_tag_order_nonnegative check (tag_order is null or tag_order >= 0),
  constraint memory_stars_tag_group_nonnegative check (tag_group_id is null or tag_group_id >= 0),
  constraint memory_stars_revision_nonnegative check (changed_revision >= 0),
  constraint memory_stars_color_valid check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.memory_notes (
  user_id uuid not null,
  star_id text not null,
  id text not null,
  sort_order integer not null,
  title text not null default '',
  title_html text not null default '',
  content text not null default '',
  content_html text not null default '',
  image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  font_size double precision,
  title_font_size double precision,
  color text,
  created_at_ms bigint,
  updated_at_ms bigint,
  changed_revision bigint not null default 0,
  deleted_at timestamptz,
  db_updated_at timestamptz not null default now(),
  primary key (user_id, star_id, id),
  constraint memory_notes_star_fk foreign key (user_id, star_id)
    references public.memory_stars(user_id, id) on delete cascade,
  constraint memory_notes_id_not_blank check (length(id) > 0),
  constraint memory_notes_sort_order_nonnegative check (sort_order >= 0),
  constraint memory_notes_image_urls_array check (jsonb_typeof(image_urls) = 'array'),
  constraint memory_notes_images_array check (jsonb_typeof(images) = 'array'),
  constraint memory_notes_font_size_positive check (font_size is null or font_size > 0),
  constraint memory_notes_title_font_size_positive check (title_font_size is null or title_font_size > 0),
  constraint memory_notes_created_at_nonnegative check (created_at_ms is null or created_at_ms >= 0),
  constraint memory_notes_updated_at_nonnegative check (updated_at_ms is null or updated_at_ms >= 0),
  constraint memory_notes_revision_nonnegative check (changed_revision >= 0),
  constraint memory_notes_color_valid check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.memory_tracks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  sort_order integer not null,
  paths jsonb not null default '[]'::jsonb,
  color text,
  duration_seconds bigint not null default 0,
  distance_km double precision not null default 0,
  created_at_ms bigint,
  updated_at_ms bigint,
  changed_revision bigint not null default 0,
  deleted_at timestamptz,
  db_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint memory_tracks_id_not_blank check (length(id) > 0),
  constraint memory_tracks_sort_order_nonnegative check (sort_order >= 0),
  constraint memory_tracks_paths_array check (jsonb_typeof(paths) = 'array'),
  constraint memory_tracks_duration_nonnegative check (duration_seconds >= 0),
  constraint memory_tracks_distance_nonnegative check (distance_km >= 0),
  constraint memory_tracks_created_at_nonnegative check (created_at_ms is null or created_at_ms >= 0),
  constraint memory_tracks_updated_at_nonnegative check (updated_at_ms is null or updated_at_ms >= 0),
  constraint memory_tracks_revision_nonnegative check (changed_revision >= 0),
  constraint memory_tracks_color_valid check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.memory_entity_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  operation text not null,
  before_data jsonb not null,
  dataset_revision bigint not null,
  changed_at timestamptz not null default now(),
  constraint memory_history_entity_type_valid check (entity_type in ('settings', 'profile', 'star', 'note', 'track')),
  constraint memory_history_operation_valid check (operation in ('update', 'soft_delete')),
  constraint memory_history_revision_nonnegative check (dataset_revision >= 0)
);

create index if not exists memory_stars_user_sort_idx
  on public.memory_stars (user_id, sort_order, id) where deleted_at is null;
create index if not exists memory_stars_user_revision_idx
  on public.memory_stars (user_id, changed_revision);
create index if not exists memory_notes_user_star_sort_idx
  on public.memory_notes (user_id, star_id, sort_order, id) where deleted_at is null;
create index if not exists memory_notes_user_created_idx
  on public.memory_notes (user_id, created_at_ms) where deleted_at is null;
create index if not exists memory_notes_user_revision_idx
  on public.memory_notes (user_id, changed_revision);
create index if not exists memory_tracks_user_sort_idx
  on public.memory_tracks (user_id, sort_order, id) where deleted_at is null;
create index if not exists memory_tracks_user_created_idx
  on public.memory_tracks (user_id, created_at_ms) where deleted_at is null;
create index if not exists memory_tracks_user_revision_idx
  on public.memory_tracks (user_id, changed_revision);
create index if not exists memory_history_entity_idx
  on public.memory_entity_history (user_id, entity_type, entity_key, changed_at desc, id desc);
create index if not exists memory_history_revision_idx
  on public.memory_entity_history (user_id, dataset_revision);

drop trigger if exists memory_settings_set_updated_at on public.memory_settings;
create trigger memory_settings_set_updated_at
before update on public.memory_settings
for each row execute function public.set_updated_at();

alter table public.memory_settings enable row level security;
alter table public.memory_stars enable row level security;
alter table public.memory_notes enable row level security;
alter table public.memory_tracks enable row level security;
alter table public.memory_entity_history enable row level security;
alter table public.profiles enable row level security;

-- app_states becomes a read-only archive after v2 migration. Revoking table
-- writes also blocks old clients that bypassed save_app_snapshot and used REST.
revoke all on public.app_states from authenticated;
drop policy if exists "Users can read own app state" on public.app_states;
drop policy if exists "Users can insert own app state" on public.app_states;
drop policy if exists "Users can update own app state" on public.app_states;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

-- Edge Functions read rows with service_role, but routine server code does not
-- need direct memory/profile/archive writes. Registration and edits use the
-- narrowly granted security-definer RPCs below.
revoke insert, update, delete on public.app_states from service_role;
revoke insert, update, delete on public.profiles from service_role;
grant select on public.app_states, public.profiles to service_role;

revoke all on public.memory_settings from anon, authenticated;
revoke all on public.memory_stars from anon, authenticated;
revoke all on public.memory_notes from anon, authenticated;
revoke all on public.memory_tracks from anon, authenticated;
revoke all on public.memory_entity_history from anon, authenticated;

grant select on public.memory_settings to authenticated;
grant select on public.memory_stars to authenticated;
grant select on public.memory_notes to authenticated;
grant select on public.memory_tracks to authenticated;
grant select on public.memory_entity_history to authenticated;

revoke insert, update, delete on public.memory_settings from service_role;
revoke insert, update, delete on public.memory_stars from service_role;
revoke insert, update, delete on public.memory_notes from service_role;
revoke insert, update, delete on public.memory_tracks from service_role;
revoke insert, update, delete on public.memory_entity_history from service_role;
grant select on public.memory_settings to service_role;
grant select on public.memory_stars to service_role;
grant select on public.memory_notes to service_role;
grant select on public.memory_tracks to service_role;
grant select on public.memory_entity_history to service_role;

drop policy if exists "Users can read own memory settings" on public.memory_settings;
create policy "Users can read own memory settings"
on public.memory_settings for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own memory stars" on public.memory_stars;
create policy "Users can read own memory stars"
on public.memory_stars for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own memory notes" on public.memory_notes;
create policy "Users can read own memory notes"
on public.memory_notes for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own memory tracks" on public.memory_tracks;
create policy "Users can read own memory tracks"
on public.memory_tracks for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own memory history" on public.memory_entity_history;
create policy "Users can read own memory history"
on public.memory_entity_history for select to authenticated
using (auth.uid() = user_id);

create or replace function public.memory_json_has_sensitive_keys(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_entry record;
  v_child jsonb;
  v_key text;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_entry in select key, value from jsonb_each(p_value) loop
      v_key := regexp_replace(lower(v_entry.key), '[^a-z0-9]', '', 'g');
      if v_key = any(array[
        'password', 'loginpassword', 'registerpassword', 'currentpassword',
        'newpassword', 'confirmpassword', 'invitecode', 'accesstoken',
        'refreshtoken', 'servicerolekey', 'databaseurl', 'supabasekey', 'mcptoken'
      ]) then return true; end if;
      if public.memory_json_has_sensitive_keys(v_entry.value) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      if public.memory_json_has_sensitive_keys(v_child) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

create or replace function public.memory_strip_sensitive_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(entry.key, public.memory_strip_sensitive_json(entry.value)), '{}'::jsonb)
    into v_result
    from jsonb_each(p_value) entry
    where regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g') <> all(array[
      'password', 'loginpassword', 'registerpassword', 'currentpassword',
      'newpassword', 'confirmpassword', 'invitecode', 'accesstoken',
      'refreshtoken', 'servicerolekey', 'databaseurl', 'supabasekey', 'mcptoken'
    ]);
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.memory_strip_sensitive_json(item.value) order by item.ordinality), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  return p_value;
end;
$$;

revoke all on function public.memory_json_has_sensitive_keys(jsonb) from public, anon, authenticated;
revoke all on function public.memory_strip_sensitive_json(jsonb) from public, anon, authenticated;

create or replace function public.memory_html_is_safe(p_html text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_tag text[];
  v_opening text[];
  v_attribute text[];
  v_rule text;
  v_property text;
  v_value text;
  v_tag_name text;
  v_attributes text;
  v_attribute_name text;
  v_unparsed_attributes text;
begin
  if p_html is null then return true; end if;
  if length(p_html) > 240000 then return false; end if;
  if p_html ~* '<\s*(script|style|iframe|object|embed|link|meta|svg|math)(\s|>|/)' then return false; end if;
  if p_html ~* '\son[a-z0-9_-]+\s*=' then return false; end if;
  if p_html ~* '(javascript\s*:|data\s*:\s*text/html)' then return false; end if;
  for v_tag in select regexp_matches(p_html, '<\s*/?\s*([a-zA-Z0-9]+)', 'g') loop
    if lower(v_tag[1]) <> all(array['p', 'br', 'span', 'u', 'figure', 'img']) then
      return false;
    end if;
  end loop;
  for v_opening in select regexp_matches(p_html, '<\s*([a-zA-Z0-9]+)([^>]*)>', 'g') loop
    v_tag_name := lower(v_opening[1]);
    v_attributes := coalesce(v_opening[2], '');
    for v_attribute in select regexp_matches(v_attributes, '([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|''([^'']*)'')', 'g') loop
      v_attribute_name := lower(v_attribute[1]);
      v_value := coalesce(v_attribute[2], v_attribute[3], '');
      if v_attribute_name ~ '^on' then return false; end if;
      if v_tag_name in ('p', 'span', 'u') then
        if v_attribute_name <> 'style' then return false; end if;
      elsif v_tag_name = 'figure' then
        if v_attribute_name not in ('class', 'contenteditable', 'data-note-image') then return false; end if;
        if v_attribute_name = 'class' and v_value <> 'note-inline-image' then return false; end if;
        if v_attribute_name = 'contenteditable' and lower(v_value) <> 'false' then return false; end if;
        if v_attribute_name = 'data-note-image' and lower(v_value) <> 'true' then return false; end if;
      elsif v_tag_name = 'img' then
        if v_attribute_name not in ('src', 'alt') and v_attribute_name !~ '^data-media-[a-z0-9-]+$' then return false; end if;
        if length(v_value) > 2048 and v_attribute_name <> 'src' then return false; end if;
        if v_attribute_name = 'src' and (
          lower(ltrim(v_value)) ~ '^(javascript:|data:text/html)'
          or lower(ltrim(v_value)) !~ '^(https?://|blob:|storage://|data:image/(jpeg|jpg|png|webp|gif);|/|\./)'
        ) then return false; end if;
      elsif v_tag_name = 'br' and length(trim(v_attributes, ' /')) > 0 then
        return false;
      end if;
    end loop;
    v_unparsed_attributes := regexp_replace(
      v_attributes,
      '([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"[^"]*"|''[^'']*'')',
      '',
      'g'
    );
    if length(btrim(v_unparsed_attributes, ' /' || chr(9) || chr(10) || chr(13))) > 0 then return false; end if;
    if v_attributes ~* '\bstyle\s*=' then
      for v_attribute in select regexp_matches(v_attributes, 'style\s*=\s*(?:"([^"]*)"|''([^'']*)'')', 'gi') loop
        foreach v_rule in array regexp_split_to_array(coalesce(v_attribute[1], v_attribute[2], ''), ';') loop
          if length(trim(v_rule)) = 0 then continue; end if;
          v_property := lower(trim(split_part(v_rule, ':', 1)));
          v_value := trim(substr(v_rule, strpos(v_rule, ':') + 1));
          if v_property not in ('color', 'font-size', 'text-decoration-line') then return false; end if;
          if v_value ~* '(url|expression|javascript)' then return false; end if;
          if v_property = 'font-size' and v_value !~ '^([8-9]|[1-6][0-9]|7[0-2])(\.[0-9]{1,2})?px$' then return false; end if;
          if v_property = 'text-decoration-line' and lower(v_value) not in ('underline', 'none') then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.memory_paths_are_valid(p_paths jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_segment jsonb;
  v_point jsonb;
  v_points integer := 0;
begin
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' or jsonb_array_length(p_paths) > 200 then return false; end if;
  for v_segment in select value from jsonb_array_elements(p_paths) loop
    if jsonb_typeof(v_segment) <> 'array' then return false; end if;
    v_points := v_points + jsonb_array_length(v_segment);
    if v_points > 20000 then return false; end if;
    for v_point in select value from jsonb_array_elements(v_segment) loop
      if jsonb_typeof(v_point) <> 'array' or jsonb_array_length(v_point) <> 2 then return false; end if;
      if jsonb_typeof(v_point -> 0) <> 'number' or jsonb_typeof(v_point -> 1) <> 'number' then return false; end if;
      if (v_point ->> 0)::double precision not between -90 and 90
        or (v_point ->> 1)::double precision not between -180 and 180 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.memory_images_are_valid(p_images jsonb, p_user_id uuid)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_image jsonb;
  v_path text;
  v_size numeric;
begin
  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 1000 then return false; end if;
  for v_image in select value from jsonb_array_elements(p_images) loop
    if jsonb_typeof(v_image) <> 'object' then return false; end if;
    if exists (
      select 1 from jsonb_object_keys(v_image) as keys(name)
      where keys.name not in ('provider', 'bucket', 'key', 'path', 'mimeType', 'size', 'createdAt')
    ) then return false; end if;
    if coalesce(v_image ->> 'provider', '') <> 'supabase' then return false; end if;
    if coalesce(v_image ->> 'bucket', '') <> 'life-media' then return false; end if;
    v_path := coalesce(nullif(v_image ->> 'path', ''), v_image ->> 'key', '');
    if v_path = '' or v_path not like p_user_id::text || '/%' then return false; end if;
    if v_path !~ '^[A-Za-z0-9_./-]+$' or v_path ~ '(^|/)\.\.?(/|$)' or v_path ~ '//' then return false; end if;
    if length(v_path) > 1024 or length(coalesce(v_image ->> 'mimeType', '')) > 120 then return false; end if;
    if coalesce(v_image ->> 'mimeType', '') !~ '^image/(jpeg|jpg|png|webp|gif)$' then return false; end if;
    v_size := coalesce(nullif(v_image ->> 'size', '')::numeric, 0);
    if v_size < 0 or v_size > 5242880 then return false; end if;
    if v_image ? 'createdAt' and (
      jsonb_typeof(v_image -> 'createdAt') <> 'number' or (v_image ->> 'createdAt')::numeric < 0
    ) then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.memory_html_is_safe(text) from public, anon, authenticated;
revoke all on function public.memory_paths_are_valid(jsonb) from public, anon, authenticated;
revoke all on function public.memory_images_are_valid(jsonb, uuid) from public, anon, authenticated;

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

revoke all on function public.record_memory_history(uuid, text, text, text, jsonb, bigint) from public, anon, authenticated;

create or replace function public.apply_memory_mutations(
  p_expected_revision bigint,
  p_mutations jsonb
)
returns table(saved boolean, dataset_revision bigint, conflict jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_revision bigint;
  v_storage_verified boolean;
  v_next_revision bigint;
  v_mutation jsonb;
  v_payload jsonb;
  v_type text;
  v_id text;
  v_star_id text;
  v_before jsonb;
  v_lat double precision;
  v_lng double precision;
  v_duration bigint;
  v_distance double precision;
  v_paths jsonb;
  v_images jsonb;
  v_image_urls jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'Mutations must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_mutations) < 1 or jsonb_array_length(p_mutations) > 500 then
    raise exception 'Mutation batch size must be between 1 and 500' using errcode = '22023';
  end if;

  select settings.dataset_revision,
    settings.data_model_version >= 2 and settings.migration_verified_at is not null
  into v_current_revision, v_storage_verified
  from public.memory_settings settings
  where settings.user_id = v_user_id
  for update;

  if v_current_revision is null or not coalesce(v_storage_verified, false) then
    raise exception 'Normalized memory storage v2 is not migrated or verified.'
      using errcode = '55000', hint = 'normalized_storage_not_ready';
  end if;

  if v_current_revision <> greatest(0, coalesce(p_expected_revision, 0)) then
    return query select false, v_current_revision, jsonb_build_object(
      'code', 'revision_conflict',
      'expectedRevision', greatest(0, coalesce(p_expected_revision, 0)),
      'actualRevision', v_current_revision
    );
    return;
  end if;

  v_next_revision := v_current_revision + 1;

  for v_mutation in select value from jsonb_array_elements(p_mutations) loop
    if jsonb_typeof(v_mutation) <> 'object' then
      raise exception 'Each mutation must be an object' using errcode = '22023';
    end if;
    v_type := coalesce(v_mutation ->> 'type', '');
    v_payload := coalesce(v_mutation -> 'payload', '{}'::jsonb);
    v_id := coalesce(v_mutation ->> 'entityId', v_payload ->> 'id', '');
    v_star_id := coalesce(v_mutation ->> 'starId', v_payload ->> 'starId', '');
    v_before := null;
    if public.memory_json_has_sensitive_keys(v_payload) then
      raise exception 'Mutation payload contains sensitive authentication fields' using errcode = '22023';
    end if;

    if v_type = 'settings_update' then
      select to_jsonb(settings) into v_before
      from public.memory_settings settings where settings.user_id = v_user_id;
      perform public.record_memory_history(v_user_id, 'settings', v_user_id::text, 'update', v_before, v_next_revision);
      if v_payload ? 'mapStyle' and (v_payload ->> 'mapStyle') not in ('light', 'dark', 'aerial') then
        raise exception 'Invalid map style' using errcode = '22023';
      end if;
      if v_payload ? 'language' and length(v_payload ->> 'language') not between 1 and 16 then
        raise exception 'Invalid language' using errcode = '22023';
      end if;
      if v_payload ? 'systemTheme' and jsonb_typeof(v_payload -> 'systemTheme') <> 'object' then
        raise exception 'systemTheme must be an object' using errcode = '22023';
      end if;
      if v_payload ? 'profileConflicts' and jsonb_typeof(v_payload -> 'profileConflicts') <> 'array' then
        raise exception 'profileConflicts must be an array' using errcode = '22023';
      end if;
      if v_payload ? 'profileMetadata' and jsonb_typeof(v_payload -> 'profileMetadata') <> 'object' then
        raise exception 'profileMetadata must be an object' using errcode = '22023';
      end if;
      if pg_column_size(coalesce(v_payload -> 'systemTheme', '{}'::jsonb)) > 100000
        or pg_column_size(coalesce(v_payload -> 'profileConflicts', '[]'::jsonb)) > 2000000
        or pg_column_size(coalesce(v_payload -> 'profileMetadata', '{}'::jsonb)) > 100000 then
        raise exception 'Settings metadata exceeds safe limits' using errcode = '22023';
      end if;
      if v_payload #> '{profileMetadata,avatarImage}' is not null
        and not public.memory_images_are_valid(
          jsonb_build_array(v_payload #> '{profileMetadata,avatarImage}'), v_user_id
        ) then
        raise exception 'Invalid avatar image metadata' using errcode = '22023';
      end if;
      update public.memory_settings set
        map_style = case when v_payload ? 'mapStyle' then v_payload ->> 'mapStyle' else map_style end,
        system_theme = case when v_payload ? 'systemTheme' then v_payload -> 'systemTheme' else system_theme end,
        language = case when v_payload ? 'language' then v_payload ->> 'language' else language end,
        profile_conflicts = case when v_payload ? 'profileConflicts' then v_payload -> 'profileConflicts' else profile_conflicts end,
        profile_metadata = case when v_payload ? 'profileMetadata' then v_payload -> 'profileMetadata' else profile_metadata end
      where user_id = v_user_id;

    elsif v_type = 'profile_update' then
      select to_jsonb(profile) into v_before from public.profiles profile where profile.id = v_user_id;
      if v_before is null then raise exception 'Profile row is missing' using errcode = 'P0002'; end if;
      perform public.record_memory_history(v_user_id, 'profile', v_user_id::text, 'update', v_before, v_next_revision);
      if length(coalesce(v_payload ->> 'name', '')) > 120 then
        raise exception 'Profile name is too long' using errcode = '22023';
      end if;
      if length(coalesce(v_payload ->> 'avatarUrl', '')) > 2000 then
        raise exception 'Avatar URL is too long' using errcode = '22023';
      end if;
      update public.profiles set
        name = case when v_payload ? 'name' then coalesce(v_payload ->> 'name', '') else name end,
        avatar_url = case when v_payload ? 'avatarUrl' then coalesce(v_payload ->> 'avatarUrl', '') else avatar_url end
      where id = v_user_id;

    elsif v_type = 'star_upsert' then
      if length(v_id) not between 1 and 256 then raise exception 'Invalid star ID' using errcode = '22023'; end if;
      if jsonb_typeof(v_payload -> 'lat') <> 'number' or jsonb_typeof(v_payload -> 'lng') <> 'number' then
        raise exception 'Star coordinates are required' using errcode = '22023';
      end if;
      v_lat := (v_payload ->> 'lat')::double precision;
      v_lng := (v_payload ->> 'lng')::double precision;
      if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
        raise exception 'Invalid star coordinates' using errcode = '22023';
      end if;
      if v_payload ? 'color' and nullif(v_payload ->> 'color', '') is not null
        and (v_payload ->> 'color') !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Invalid star color' using errcode = '22023';
      end if;
      select to_jsonb(star) into v_before from public.memory_stars star
      where star.user_id = v_user_id and star.id = v_id;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'star', v_id, 'update', v_before, v_next_revision);
      end if;
      insert into public.memory_stars (
        user_id, id, sort_order, lat, lng, created_at_ms, tag_order, tag_group_id,
        color, changed_revision, deleted_at, updated_at
      ) values (
        v_user_id, v_id, coalesce((v_payload ->> 'sortOrder')::integer, 0),
        v_lat, v_lng, nullif(v_payload ->> 'createdAt', '')::bigint,
        nullif(v_payload ->> 'tagOrder', '')::bigint, nullif(v_payload ->> 'tagGroupId', '')::bigint,
        nullif(v_payload ->> 'color', ''), v_next_revision, null, now()
      ) on conflict (user_id, id) do update set
        sort_order = excluded.sort_order, lat = excluded.lat, lng = excluded.lng,
        created_at_ms = excluded.created_at_ms, tag_order = excluded.tag_order,
        tag_group_id = excluded.tag_group_id, color = excluded.color,
        changed_revision = v_next_revision, deleted_at = null, updated_at = now();

    elsif v_type = 'star_soft_delete' then
      if length(v_id) not between 1 and 256 then raise exception 'Valid star ID is required' using errcode = '22023'; end if;
      select to_jsonb(star) into v_before from public.memory_stars star
      where star.user_id = v_user_id and star.id = v_id and star.deleted_at is null;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'star', v_id, 'soft_delete', v_before, v_next_revision);
        insert into public.memory_entity_history (user_id, entity_type, entity_key, operation, before_data, dataset_revision)
        select v_user_id, 'note', note.star_id || '/' || note.id, 'soft_delete', to_jsonb(note), v_next_revision
        from public.memory_notes note
        where note.user_id = v_user_id and note.star_id = v_id and note.deleted_at is null;
        update public.memory_notes set deleted_at = now(), changed_revision = v_next_revision, db_updated_at = now()
        where user_id = v_user_id and star_id = v_id and deleted_at is null;
        update public.memory_stars set deleted_at = now(), changed_revision = v_next_revision, updated_at = now()
        where user_id = v_user_id and id = v_id;
      else
        raise exception 'Star was not found or is already deleted' using errcode = 'P0002';
      end if;

    elsif v_type = 'note_upsert' then
      if length(v_star_id) not between 1 and 256 or length(v_id) not between 1 and 256 then
        raise exception 'Valid star and note IDs are required' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.memory_stars star
        where star.user_id = v_user_id and star.id = v_star_id and star.deleted_at is null
      ) then raise exception 'Parent star is missing or deleted' using errcode = '23503'; end if;
      if length(coalesce(v_payload ->> 'title', '')) > 40000
        or length(coalesce(v_payload ->> 'content', '')) > 40000 then
        raise exception 'Note text exceeds the per-record safety limit' using errcode = '22023';
      end if;
      if not public.memory_html_is_safe(coalesce(v_payload ->> 'titleHtml', ''))
        or not public.memory_html_is_safe(coalesce(v_payload ->> 'contentHtml', '')) then
        raise exception 'Note HTML is invalid or unsafe' using errcode = '22023';
      end if;
      if length(coalesce(v_payload ->> 'imageUrl', '')) > 2000000 then
        raise exception 'Legacy image URL exceeds the per-record safety limit' using errcode = '22023';
      end if;
      if nullif(v_payload ->> 'fontSize', '') is not null
        and (v_payload ->> 'fontSize')::double precision not between 8 and 72 then
        raise exception 'Invalid note font size' using errcode = '22023';
      end if;
      if nullif(v_payload ->> 'titleFontSize', '') is not null
        and (v_payload ->> 'titleFontSize')::double precision not between 8 and 72 then
        raise exception 'Invalid note title font size' using errcode = '22023';
      end if;
      v_image_urls := coalesce(v_payload -> 'imageUrls', '[]'::jsonb);
      v_images := coalesce(v_payload -> 'images', '[]'::jsonb);
      if jsonb_typeof(v_image_urls) <> 'array' or jsonb_array_length(v_image_urls) > 1000
        or jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 1000
        or not public.memory_images_are_valid(v_images, v_user_id)
        or exists (
          select 1 from jsonb_array_elements(v_image_urls) image_url
          where jsonb_typeof(image_url) <> 'string' or length(image_url #>> '{}') > 2000000
        ) then
        raise exception 'Invalid image metadata' using errcode = '22023';
      end if;
      select to_jsonb(note) into v_before from public.memory_notes note
      where note.user_id = v_user_id and note.star_id = v_star_id and note.id = v_id;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'note', v_star_id || '/' || v_id, 'update', v_before, v_next_revision);
      end if;
      insert into public.memory_notes (
        user_id, star_id, id, sort_order, title, title_html, content, content_html,
        image_url, image_urls, images, font_size, title_font_size, color,
        created_at_ms, updated_at_ms, changed_revision, deleted_at, db_updated_at
      ) values (
        v_user_id, v_star_id, v_id, coalesce((v_payload ->> 'sortOrder')::integer, 0),
        coalesce(v_payload ->> 'title', ''), coalesce(v_payload ->> 'titleHtml', ''),
        coalesce(v_payload ->> 'content', ''), coalesce(v_payload ->> 'contentHtml', ''),
        nullif(v_payload ->> 'imageUrl', ''), v_image_urls, v_images,
        nullif(v_payload ->> 'fontSize', '')::double precision,
        nullif(v_payload ->> 'titleFontSize', '')::double precision,
        nullif(v_payload ->> 'color', ''), nullif(v_payload ->> 'createdAt', '')::bigint,
        nullif(v_payload ->> 'updatedAt', '')::bigint, v_next_revision, null, now()
      ) on conflict (user_id, star_id, id) do update set
        sort_order = excluded.sort_order, title = excluded.title, title_html = excluded.title_html,
        content = excluded.content, content_html = excluded.content_html,
        image_url = excluded.image_url, image_urls = excluded.image_urls, images = excluded.images,
        font_size = excluded.font_size, title_font_size = excluded.title_font_size,
        color = excluded.color, created_at_ms = excluded.created_at_ms,
        updated_at_ms = excluded.updated_at_ms, changed_revision = v_next_revision,
        deleted_at = null, db_updated_at = now();

    elsif v_type = 'note_soft_delete' then
      if length(v_star_id) not between 1 and 256 or length(v_id) not between 1 and 256 then
        raise exception 'Valid star and note IDs are required' using errcode = '22023';
      end if;
      select to_jsonb(note) into v_before from public.memory_notes note
      where note.user_id = v_user_id and note.star_id = v_star_id and note.id = v_id and note.deleted_at is null;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'note', v_star_id || '/' || v_id, 'soft_delete', v_before, v_next_revision);
        update public.memory_notes set deleted_at = now(), changed_revision = v_next_revision, db_updated_at = now()
        where user_id = v_user_id and star_id = v_star_id and id = v_id;
      else
        raise exception 'Note was not found or is already deleted' using errcode = 'P0002';
      end if;

    elsif v_type = 'track_upsert' then
      if length(v_id) not between 1 and 256 then raise exception 'Invalid track ID' using errcode = '22023'; end if;
      v_paths := coalesce(v_payload -> 'paths', '[]'::jsonb);
      if not public.memory_paths_are_valid(v_paths) then raise exception 'Invalid route paths' using errcode = '22023'; end if;
      v_duration := coalesce((v_payload ->> 'durationSeconds')::bigint, 0);
      v_distance := coalesce((v_payload ->> 'distanceKm')::double precision, 0);
      if v_duration < 0 or v_distance < 0 then
        raise exception 'Route duration and distance must be nonnegative' using errcode = '22023';
      end if;
      select to_jsonb(track) into v_before from public.memory_tracks track
      where track.user_id = v_user_id and track.id = v_id;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'track', v_id, 'update', v_before, v_next_revision);
      end if;
      insert into public.memory_tracks (
        user_id, id, sort_order, paths, color, duration_seconds, distance_km,
        created_at_ms, updated_at_ms, changed_revision, deleted_at, db_updated_at
      ) values (
        v_user_id, v_id, coalesce((v_payload ->> 'sortOrder')::integer, 0),
        v_paths, nullif(v_payload ->> 'color', ''), v_duration, v_distance,
        nullif(v_payload ->> 'createdAt', '')::bigint, nullif(v_payload ->> 'updatedAt', '')::bigint,
        v_next_revision, null, now()
      ) on conflict (user_id, id) do update set
        sort_order = excluded.sort_order, paths = excluded.paths, color = excluded.color,
        duration_seconds = excluded.duration_seconds, distance_km = excluded.distance_km,
        created_at_ms = excluded.created_at_ms, updated_at_ms = excluded.updated_at_ms,
        changed_revision = v_next_revision, deleted_at = null, db_updated_at = now();

    elsif v_type = 'track_soft_delete' then
      if length(v_id) not between 1 and 256 then raise exception 'Valid track ID is required' using errcode = '22023'; end if;
      select to_jsonb(track) into v_before from public.memory_tracks track
      where track.user_id = v_user_id and track.id = v_id and track.deleted_at is null;
      if v_before is not null then
        perform public.record_memory_history(v_user_id, 'track', v_id, 'soft_delete', v_before, v_next_revision);
        update public.memory_tracks set deleted_at = now(), changed_revision = v_next_revision, db_updated_at = now()
        where user_id = v_user_id and id = v_id;
      else
        raise exception 'Route was not found or is already deleted' using errcode = 'P0002';
      end if;

    else
      raise exception 'Unsupported memory mutation type: %', v_type using errcode = '22023';
    end if;
  end loop;

  update public.memory_settings
  set dataset_revision = v_next_revision, data_model_version = 2
  where user_id = v_user_id;

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

  return query select true, v_next_revision, null::jsonb;
end;
$$;

revoke all on function public.apply_memory_mutations(bigint, jsonb) from public, anon;
grant execute on function public.apply_memory_mutations(bigint, jsonb) to authenticated;

create or replace function public.initialize_normalized_memory_account(
  p_user_id uuid,
  p_account_id text,
  p_name text,
  p_avatar_url text,
  p_settings jsonb,
  p_default_star jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account text := lower(trim(coalesce(p_account_id, '')));
  v_star_id text := coalesce(p_default_star ->> 'id', '');
  v_lat double precision;
  v_lng double precision;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or length(v_account) < 1 then
    raise exception 'User ID and account ID are required' using errcode = '22023';
  end if;
  if length(coalesce(p_name, '')) > 120 or length(coalesce(p_avatar_url, '')) > 2000 then
    raise exception 'Profile fields exceed safe limits' using errcode = '22023';
  end if;
  if length(v_star_id) not between 1 and 256
    or jsonb_typeof(p_default_star -> 'lat') <> 'number'
    or jsonb_typeof(p_default_star -> 'lng') <> 'number' then
    raise exception 'A valid default star is required' using errcode = '22023';
  end if;
  v_lat := (p_default_star ->> 'lat')::double precision;
  v_lng := (p_default_star ->> 'lng')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'Default star coordinates are invalid' using errcode = '22023';
  end if;

  insert into public.profiles (id, account_id, name, avatar_url)
  values (p_user_id, v_account, coalesce(p_name, ''), coalesce(p_avatar_url, ''));

  insert into public.memory_settings (
    user_id, map_style, system_theme, language, profile_conflicts, profile_metadata,
    dataset_revision, data_model_version, migration_verified_at, migration_verification
  ) values (
    p_user_id,
    case when p_settings ->> 'mapStyle' in ('light', 'dark', 'aerial') then p_settings ->> 'mapStyle' else 'light' end,
    case when jsonb_typeof(p_settings -> 'systemTheme') = 'object'
      then public.memory_strip_sensitive_json(p_settings -> 'systemTheme') else '{}'::jsonb end,
    coalesce(nullif(p_settings ->> 'language', ''), 'en'),
    case when jsonb_typeof(p_settings -> 'profileConflicts') = 'array'
      then public.memory_strip_sensitive_json(p_settings -> 'profileConflicts') else '[]'::jsonb end,
    case when jsonb_typeof(p_settings -> 'profileMetadata') = 'object'
      then public.memory_strip_sensitive_json(p_settings -> 'profileMetadata') else '{}'::jsonb end,
    0, 2, now(), jsonb_build_object('source', 'new_account', 'verifiedAt', now())
  );

  insert into public.memory_stars (
    user_id, id, sort_order, lat, lng, created_at_ms, tag_order, tag_group_id,
    color, changed_revision, deleted_at
  ) values (
    p_user_id, v_star_id, 0, v_lat, v_lng,
    nullif(p_default_star ->> 'createdAt', '')::bigint,
    nullif(p_default_star ->> 'tagOrder', '')::bigint,
    nullif(p_default_star ->> 'tagGroupId', '')::bigint,
    nullif(p_default_star ->> 'color', ''), 0, null
  );
end;
$$;

revoke all on function public.initialize_normalized_memory_account(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.initialize_normalized_memory_account(uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.memory_media_paths_from_json(p_value jsonb, p_user_id uuid)
returns setof text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_child jsonb;
  v_candidate text;
begin
  if p_value is null then return; end if;
  if jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      return query select * from public.memory_media_paths_from_json(v_child, p_user_id);
    end loop;
  elsif jsonb_typeof(p_value) = 'object' then
    if coalesce(p_value ->> 'provider', '') = 'supabase' then
      v_candidate := coalesce(nullif(p_value ->> 'path', ''), p_value ->> 'key', '');
      if v_candidate like p_user_id::text || '/%' then return next v_candidate; end if;
    end if;
    for v_child in select value from jsonb_each(p_value) loop
      return query select * from public.memory_media_paths_from_json(v_child, p_user_id);
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    v_candidate := p_value #>> '{}';
    if v_candidate like ('storage://life-media/' || p_user_id::text || '/%') then
      return next substr(v_candidate, length('storage://life-media/') + 1);
    end if;
  end if;
end;
$$;

create or replace function public.list_protected_memory_media_paths()
returns table(path text)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select auth.uid() as user_id
  ), json_sources as (
    select settings.profile_metadata as value
    from public.memory_settings settings join viewer on viewer.user_id = settings.user_id
    union all
    select settings.profile_conflicts
    from public.memory_settings settings join viewer on viewer.user_id = settings.user_id
    union all
    select note.images
    from public.memory_notes note join viewer on viewer.user_id = note.user_id
    union all
    select note.image_urls
    from public.memory_notes note join viewer on viewer.user_id = note.user_id
    union all
    select to_jsonb(note.image_url)
    from public.memory_notes note join viewer on viewer.user_id = note.user_id
    union all
    select history.before_data
    from public.memory_entity_history history join viewer on viewer.user_id = history.user_id
  ), metadata_paths as (
    select media.path
    from json_sources source
    cross join viewer
    cross join lateral public.memory_media_paths_from_json(source.value, viewer.user_id) media(path)
  ), html_paths as (
    select match[1] as path
    from public.memory_notes note
    join viewer on viewer.user_id = note.user_id
    cross join lateral regexp_matches(
      coalesce(note.content_html, ''),
      'data-(?:media|storage)-(?:path|key)=["'']([^"'']+)["'']',
      'g'
    ) match
    where match[1] like viewer.user_id::text || '/%'
    union all
    select match[1] as path
    from public.memory_entity_history history
    join viewer on viewer.user_id = history.user_id
    cross join lateral regexp_matches(
      coalesce(history.before_data ->> 'content_html', history.before_data ->> 'contentHtml', ''),
      'data-(?:media|storage)-(?:path|key)=["'']([^"'']+)["'']',
      'g'
    ) match
    where match[1] like viewer.user_id::text || '/%'
  )
  select distinct protected.path
  from (
    select path from metadata_paths
    union all
    select path from html_paths
  ) protected
  where protected.path is not null and protected.path <> '';
$$;

revoke all on function public.memory_media_paths_from_json(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.list_protected_memory_media_paths() from public, anon;
grant execute on function public.list_protected_memory_media_paths() to authenticated;

-- The Memory API uses this service-only aggregate so a range summary does not
-- download an account's complete note and route history into the Edge runtime.
create or replace function public.summarize_normalized_memory_range(
  p_user_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_time_zone text default 'Asia/Shanghai'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null then raise exception 'User ID is required' using errcode = '22023'; end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'dateFrom must not be after dateTo' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memory_settings settings
    where settings.user_id = p_user_id
      and settings.data_model_version >= 2
      and settings.migration_verified_at is not null
  ) then
    raise exception 'Normalized memory storage v2 is not migrated or verified.'
      using errcode = '55000', hint = 'normalized_storage_not_ready';
  end if;

  with filtered_notes as (
    select note.*, star.sort_order as star_sort_order, star.lat, star.lng,
      star.color as star_color, star.created_at_ms as star_created_at_ms,
      coalesce(note.created_at_ms, star.created_at_ms) as effective_created_at_ms
    from public.memory_notes note
    join public.memory_stars star
      on star.user_id = note.user_id and star.id = note.star_id and star.deleted_at is null
    where note.user_id = p_user_id
      and note.deleted_at is null
      and (
        (p_date_from is null and p_date_to is null)
        or (
          coalesce(note.created_at_ms, star.created_at_ms) is not null
          and (p_date_from is null or (
            to_timestamp(coalesce(note.created_at_ms, star.created_at_ms) / 1000.0)
              at time zone p_time_zone
          )::date >= p_date_from)
          and (p_date_to is null or (
            to_timestamp(coalesce(note.created_at_ms, star.created_at_ms) / 1000.0)
              at time zone p_time_zone
          )::date <= p_date_to)
        )
      )
  ), filtered_tracks as (
    select track.*
    from public.memory_tracks track
    where track.user_id = p_user_id
      and track.deleted_at is null
      and (
        (p_date_from is null and p_date_to is null)
        or (
          track.created_at_ms is not null
          and (p_date_from is null or (
            to_timestamp(track.created_at_ms / 1000.0) at time zone p_time_zone
          )::date >= p_date_from)
          and (p_date_to is null or (
            to_timestamp(track.created_at_ms / 1000.0) at time zone p_time_zone
          )::date <= p_date_to)
        )
      )
  ), ranked_locations as (
    select
      star.id,
      star.sort_order,
      star.lat,
      star.lng,
      star.color,
      star.created_at_ms,
      star.tag_order,
      star.tag_group_id,
      count(filtered.id)::bigint as matched_notes,
      (
        select count(*) from public.memory_notes all_note
        where all_note.user_id = star.user_id and all_note.star_id = star.id and all_note.deleted_at is null
      )::bigint as note_count,
      (
        select count(*) from public.memory_notes meaningful
        where meaningful.user_id = star.user_id
          and meaningful.star_id = star.id
          and meaningful.deleted_at is null
          and (
            length(btrim(meaningful.content)) > 0
            or length(btrim(meaningful.content_html)) > 0
            or jsonb_array_length(meaningful.images) > 0
          )
      )::bigint as meaningful_note_count
    from filtered_notes filtered
    join public.memory_stars star
      on star.user_id = p_user_id and star.id = filtered.star_id and star.deleted_at is null
    group by star.user_id, star.id, star.sort_order, star.lat, star.lng, star.color,
      star.created_at_ms, star.tag_order, star.tag_group_id
    order by count(filtered.id) desc, star.sort_order, star.id
    limit 10
  ), top_locations as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ranked.id,
      'index', ranked.sort_order,
      'lat', ranked.lat,
      'lng', ranked.lng,
      'color', coalesce(ranked.color, ''),
      'createdAt', ranked.created_at_ms,
      'noteCount', ranked.note_count,
      'meaningfulNoteCount', ranked.meaningful_note_count,
      'tagOrder', ranked.tag_order,
      'tagGroupId', ranked.tag_group_id,
      'matchedNotes', ranked.matched_notes
    ) order by ranked.matched_notes desc, ranked.sort_order, ranked.id), '[]'::jsonb) as value
    from ranked_locations ranked
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'dateFrom', p_date_from,
      'dateTo', p_date_to,
      'timeZone', p_time_zone
    ),
    'totals', jsonb_build_object(
      'locations', (select count(distinct note.star_id) from filtered_notes note),
      'notes', (select count(*) from filtered_notes),
      'images', (select coalesce(sum(jsonb_array_length(note.images)), 0) from filtered_notes note),
      'routes', (select count(*) from filtered_tracks),
      'routeDistanceKm', (select coalesce(sum(track.distance_km), 0) from filtered_tracks track)
    ),
    'topLocations', (select value from top_locations),
    'records', (select value from top_locations)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.summarize_normalized_memory_range(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.summarize_normalized_memory_range(uuid, date, date, text)
  to service_role;

-- Migrate only users that have not already been verified as v2. The legacy
-- archive remains untouched. Any malformed legacy value aborts this transaction.
create temporary table memory_v2_migration_users on commit drop as
select app.user_id, app.state
from public.app_states app
left join public.memory_settings settings on settings.user_id = app.user_id
where settings.migration_verified_at is null;

insert into public.memory_settings (
  user_id, map_style, system_theme, language, profile_conflicts, profile_metadata,
  dataset_revision, data_model_version
)
select
  source.user_id,
  case when source.state ->> 'mapStyle' in ('light', 'dark', 'aerial') then source.state ->> 'mapStyle' else 'light' end,
  case when jsonb_typeof(source.state -> 'systemTheme') = 'object'
    then public.memory_strip_sensitive_json(source.state -> 'systemTheme') else '{}'::jsonb end,
  coalesce(nullif(source.state ->> 'language', ''), 'en'),
  case when jsonb_typeof(source.state -> 'profileConflicts') = 'array'
    then public.memory_strip_sensitive_json(source.state -> 'profileConflicts') else '[]'::jsonb end,
  public.memory_strip_sensitive_json(
    jsonb_strip_nulls(jsonb_build_object('avatarImage', source.state #> '{profile,avatarImage}'))
  ),
  0,
  2
from memory_v2_migration_users source
on conflict (user_id) do nothing;

insert into public.memory_stars (
  user_id, id, sort_order, lat, lng, created_at_ms, tag_order, tag_group_id,
  color, changed_revision, deleted_at
)
select
  source.user_id,
  star.value ->> 'id',
  (star.ordinality - 1)::integer,
  (star.value ->> 'lat')::double precision,
  (star.value ->> 'lng')::double precision,
  nullif(star.value ->> 'createdAt', '')::bigint,
  nullif(star.value ->> 'tagOrder', '')::bigint,
  nullif(star.value ->> 'tagGroupId', '')::bigint,
  nullif(star.value ->> 'color', ''),
  0,
  null
from memory_v2_migration_users source
cross join lateral jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
on conflict (user_id, id) do nothing;

insert into public.memory_notes (
  user_id, star_id, id, sort_order, title, title_html, content, content_html,
  image_url, image_urls, images, font_size, title_font_size, color,
  created_at_ms, updated_at_ms, changed_revision, deleted_at
)
select
  source.user_id,
  star.value ->> 'id',
  note.value ->> 'id',
  (note.ordinality - 1)::integer,
  coalesce(note.value ->> 'title', ''),
  coalesce(note.value ->> 'titleHtml', ''),
  coalesce(note.value ->> 'content', ''),
  coalesce(note.value ->> 'contentHtml', ''),
  nullif(note.value ->> 'imageUrl', ''),
  case when jsonb_typeof(note.value -> 'imageUrls') = 'array' then note.value -> 'imageUrls' else '[]'::jsonb end,
  case when jsonb_typeof(note.value -> 'images') = 'array'
    then public.memory_strip_sensitive_json(note.value -> 'images') else '[]'::jsonb end,
  nullif(note.value ->> 'fontSize', '')::double precision,
  nullif(note.value ->> 'titleFontSize', '')::double precision,
  nullif(note.value ->> 'color', ''),
  nullif(note.value ->> 'createdAt', '')::bigint,
  nullif(note.value ->> 'updatedAt', '')::bigint,
  0,
  null
from memory_v2_migration_users source
cross join lateral jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality star(value, star_ordinality)
cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality)
on conflict (user_id, star_id, id) do nothing;

insert into public.memory_tracks (
  user_id, id, sort_order, paths, color, duration_seconds, distance_km,
  created_at_ms, updated_at_ms, changed_revision, deleted_at
)
select
  source.user_id,
  track.value ->> 'id',
  (track.ordinality - 1)::integer,
  coalesce(track.value -> 'paths', '[]'::jsonb),
  nullif(track.value ->> 'color', ''),
  coalesce(nullif(track.value ->> 'time', '')::bigint, 0),
  coalesce(nullif(track.value ->> 'distance', '')::double precision, 0),
  nullif(track.value ->> 'createdAt', '')::bigint,
  nullif(track.value ->> 'updatedAt', '')::bigint,
  0,
  null
from memory_v2_migration_users source
cross join lateral jsonb_array_elements(coalesce(source.state -> 'savedTracks', '[]'::jsonb)) with ordinality track(value, ordinality)
on conflict (user_id, id) do nothing;

do $$
declare
  source record;
  v_legacy_stars bigint;
  v_legacy_notes bigint;
  v_legacy_tracks bigint;
  v_new_stars bigint;
  v_new_notes bigint;
  v_new_tracks bigint;
  v_legacy_star_ids text;
  v_new_star_ids text;
  v_legacy_note_ids text;
  v_new_note_ids text;
  v_legacy_track_ids text;
  v_new_track_ids text;
  v_legacy_settings_checksum text;
  v_new_settings_checksum text;
  v_legacy_star_content_checksum text;
  v_new_star_content_checksum text;
  v_legacy_note_content_checksum text;
  v_new_note_content_checksum text;
  v_legacy_track_content_checksum text;
  v_new_track_content_checksum text;
  v_verification jsonb;
begin
  for source in select * from memory_v2_migration_users loop
    if not exists (
      select 1 from public.profiles profile where profile.id = source.user_id
    ) then
      raise exception 'Normalized memory verification failed for user %: profile row is missing', source.user_id;
    end if;
    if exists (
      select 1 from public.memory_stars star
      where star.user_id = source.user_id and star.deleted_at is not null
    ) or exists (
      select 1 from public.memory_notes note
      where note.user_id = source.user_id and note.deleted_at is not null
    ) or exists (
      select 1 from public.memory_tracks track
      where track.user_id = source.user_id and track.deleted_at is not null
    ) then
      raise exception 'Normalized memory verification failed for user %: unverified tombstones already exist', source.user_id;
    end if;

    v_legacy_stars := jsonb_array_length(coalesce(source.state -> 'stars', '[]'::jsonb));
    select count(*) into v_legacy_notes
    from jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) star
    cross join lateral jsonb_array_elements(coalesce(star -> 'notes', '[]'::jsonb)) note;
    v_legacy_tracks := jsonb_array_length(coalesce(source.state -> 'savedTracks', '[]'::jsonb));

    select count(*), md5(coalesce(string_agg(star.id, E'\n' order by star.sort_order, star.id), ''))
      into v_new_stars, v_new_star_ids
    from public.memory_stars star where star.user_id = source.user_id and star.deleted_at is null;
    select count(*), md5(coalesce(string_agg(note.star_id || '/' || note.id, E'\n' order by parent.sort_order, note.sort_order, note.id), ''))
      into v_new_notes, v_new_note_ids
    from public.memory_notes note
    join public.memory_stars parent on parent.user_id = note.user_id and parent.id = note.star_id
    where note.user_id = source.user_id and note.deleted_at is null;
    select count(*), md5(coalesce(string_agg(track.id, E'\n' order by track.sort_order, track.id), ''))
      into v_new_tracks, v_new_track_ids
    from public.memory_tracks track where track.user_id = source.user_id and track.deleted_at is null;

    select md5(coalesce(string_agg(item.value ->> 'id', E'\n' order by item.ordinality), ''))
      into v_legacy_star_ids
    from jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality item(value, ordinality);
    select md5(coalesce(string_agg((star.value ->> 'id') || '/' || (note.value ->> 'id'), E'\n' order by star.ordinality, note.ordinality), ''))
      into v_legacy_note_ids
    from jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
    cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality);
    select md5(coalesce(string_agg(item.value ->> 'id', E'\n' order by item.ordinality), ''))
      into v_legacy_track_ids
    from jsonb_array_elements(coalesce(source.state -> 'savedTracks', '[]'::jsonb)) with ordinality item(value, ordinality);

    select md5(jsonb_build_object(
      'mapStyle', case when source.state ->> 'mapStyle' in ('light', 'dark', 'aerial') then source.state ->> 'mapStyle' else 'light' end,
      'systemTheme', case when jsonb_typeof(source.state -> 'systemTheme') = 'object'
        then public.memory_strip_sensitive_json(source.state -> 'systemTheme') else '{}'::jsonb end,
      'language', coalesce(nullif(source.state ->> 'language', ''), 'en'),
      'profileConflicts', case when jsonb_typeof(source.state -> 'profileConflicts') = 'array'
        then public.memory_strip_sensitive_json(source.state -> 'profileConflicts') else '[]'::jsonb end,
      'profileMetadata', public.memory_strip_sensitive_json(
        jsonb_strip_nulls(jsonb_build_object('avatarImage', source.state #> '{profile,avatarImage}'))
      )
    )::text) into v_legacy_settings_checksum;
    select md5(jsonb_build_object(
      'mapStyle', settings.map_style,
      'systemTheme', settings.system_theme,
      'language', settings.language,
      'profileConflicts', settings.profile_conflicts,
      'profileMetadata', settings.profile_metadata
    )::text) into v_new_settings_checksum
    from public.memory_settings settings where settings.user_id = source.user_id;

    select md5(coalesce(string_agg(jsonb_build_array(
      star.value ->> 'id', star.ordinality - 1,
      (star.value ->> 'lat')::double precision, (star.value ->> 'lng')::double precision,
      nullif(star.value ->> 'createdAt', '')::bigint,
      nullif(star.value ->> 'tagOrder', '')::bigint,
      nullif(star.value ->> 'tagGroupId', '')::bigint,
      nullif(star.value ->> 'color', '')
    )::text, E'\n' order by star.ordinality), ''))
      into v_legacy_star_content_checksum
    from jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality);
    select md5(coalesce(string_agg(jsonb_build_array(
      star.id, star.sort_order, star.lat, star.lng, star.created_at_ms,
      star.tag_order, star.tag_group_id, star.color
    )::text, E'\n' order by star.sort_order, star.id), ''))
      into v_new_star_content_checksum
    from public.memory_stars star where star.user_id = source.user_id and star.deleted_at is null;

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
      into v_legacy_note_content_checksum
    from jsonb_array_elements(coalesce(source.state -> 'stars', '[]'::jsonb)) with ordinality star(value, ordinality)
    cross join lateral jsonb_array_elements(coalesce(star.value -> 'notes', '[]'::jsonb)) with ordinality note(value, ordinality);
    select md5(coalesce(string_agg(jsonb_build_array(
      note.star_id, note.id, parent.sort_order, note.sort_order,
      note.title, note.title_html, note.content, note.content_html,
      note.image_url, note.image_urls, note.images, note.font_size,
      note.title_font_size, note.color, note.created_at_ms, note.updated_at_ms
    )::text, E'\n' order by parent.sort_order, note.sort_order, note.id), ''))
      into v_new_note_content_checksum
    from public.memory_notes note
    join public.memory_stars parent on parent.user_id = note.user_id and parent.id = note.star_id
    where note.user_id = source.user_id and note.deleted_at is null;

    select md5(coalesce(string_agg(jsonb_build_array(
      track.value ->> 'id', track.ordinality - 1,
      coalesce(track.value -> 'paths', '[]'::jsonb), nullif(track.value ->> 'color', ''),
      coalesce(nullif(track.value ->> 'time', '')::bigint, 0),
      coalesce(nullif(track.value ->> 'distance', '')::double precision, 0),
      nullif(track.value ->> 'createdAt', '')::bigint,
      nullif(track.value ->> 'updatedAt', '')::bigint
    )::text, E'\n' order by track.ordinality), ''))
      into v_legacy_track_content_checksum
    from jsonb_array_elements(coalesce(source.state -> 'savedTracks', '[]'::jsonb)) with ordinality track(value, ordinality);
    select md5(coalesce(string_agg(jsonb_build_array(
      track.id, track.sort_order, track.paths, track.color,
      track.duration_seconds, track.distance_km, track.created_at_ms, track.updated_at_ms
    )::text, E'\n' order by track.sort_order, track.id), ''))
      into v_new_track_content_checksum
    from public.memory_tracks track where track.user_id = source.user_id and track.deleted_at is null;

    v_verification := jsonb_build_object(
      'legacyStars', v_legacy_stars, 'normalizedStars', v_new_stars,
      'legacyNotes', v_legacy_notes, 'normalizedNotes', v_new_notes,
      'legacyTracks', v_legacy_tracks, 'normalizedTracks', v_new_tracks,
      'starIdOrderChecksum', v_new_star_ids,
      'noteIdOrderChecksum', v_new_note_ids,
      'trackIdOrderChecksum', v_new_track_ids,
      'settingsChecksum', v_new_settings_checksum,
      'starContentChecksum', v_new_star_content_checksum,
      'noteContentChecksum', v_new_note_content_checksum,
      'trackContentChecksum', v_new_track_content_checksum
    );

    if v_legacy_stars <> v_new_stars or v_legacy_notes <> v_new_notes or v_legacy_tracks <> v_new_tracks
      or v_legacy_star_ids is distinct from v_new_star_ids
      or v_legacy_note_ids is distinct from v_new_note_ids
      or v_legacy_track_ids is distinct from v_new_track_ids
      or v_legacy_settings_checksum is distinct from v_new_settings_checksum
      or v_legacy_star_content_checksum is distinct from v_new_star_content_checksum
      or v_legacy_note_content_checksum is distinct from v_new_note_content_checksum
      or v_legacy_track_content_checksum is distinct from v_new_track_content_checksum then
      raise exception 'Normalized memory verification failed for user %: %', source.user_id, v_verification;
    end if;

    update public.memory_settings set
      migration_verified_at = now(),
      migration_verification = v_verification,
      data_model_version = 2
    where user_id = source.user_id;
  end loop;
end;
$$;

-- A verified v2 account treats app_states as an immutable archive. Old clients
-- receive an explicit error instead of silently writing a stale snapshot.
create or replace function public.save_app_snapshot(
  p_expected_revision bigint,
  p_state jsonb,
  p_name text,
  p_avatar_url text
)
returns table(saved boolean, revision bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if exists (
    select 1 from public.memory_settings settings
    where settings.user_id = v_user_id
      and settings.data_model_version >= 2
      and settings.migration_verified_at is not null
  ) then
    raise exception 'This account uses normalized memory storage v2; update the client before saving.'
      using errcode = '55000', hint = 'legacy_snapshot_write_rejected';
  end if;

  update public.app_states set
    state = coalesce(p_state, '{}'::jsonb), revision = app_states.revision + 1
  where user_id = v_user_id and app_states.revision = greatest(0, coalesce(p_expected_revision, 0))
  returning app_states.revision into v_revision;
  if not found then
    select app_states.revision into v_revision from public.app_states where user_id = v_user_id;
    return query select false, coalesce(v_revision, 0);
    return;
  end if;
  update public.profiles set name = coalesce(p_name, ''), avatar_url = coalesce(p_avatar_url, '')
  where id = v_user_id;
  return query select true, v_revision;
end;
$$;

revoke all on function public.save_app_snapshot(bigint, jsonb, text, text) from public, anon;
grant execute on function public.save_app_snapshot(bigint, jsonb, text, text) to authenticated;

create or replace function public.load_app_snapshot()
returns table (
  account_id text,
  name text,
  avatar_url text,
  state jsonb,
  revision bigint
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  raise exception 'This account uses normalized memory storage v2; update the client before loading.'
    using errcode = '55000', hint = 'legacy_snapshot_read_rejected';
end;
$$;

revoke all on function public.load_app_snapshot() from public, anon;
grant execute on function public.load_app_snapshot() to authenticated;

commit;
