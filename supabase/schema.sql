-- Supabase setup for My Life Memory.
-- Run this in Supabase SQL Editor after creating a project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  account_id text not null unique,
  name text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_account_id_not_blank check (length(trim(account_id)) > 0),
  constraint profiles_account_id_normalized check (account_id = lower(trim(account_id)))
);

create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_states
  add column if not exists revision bigint not null default 0;

alter table public.app_states
  drop constraint if exists app_states_revision_nonnegative;

alter table public.app_states
  add constraint app_states_revision_nonnegative check (revision >= 0);

-- Remove legacy password data if an older frontend wrote it into app state.
update public.app_states
set state = state #- '{profile,password}'
where state #> '{profile,password}' is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists app_states_set_updated_at on public.app_states;
create trigger app_states_set_updated_at
before update on public.app_states
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.app_states enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.app_states to authenticated;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read own app state" on public.app_states;
create policy "Users can read own app state"
on public.app_states for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own app state" on public.app_states;
create policy "Users can insert own app state"
on public.app_states for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own app state" on public.app_states;
create policy "Users can update own app state"
on public.app_states for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Profile metadata and app state are saved in one transaction after a single
-- optimistic revision check, preventing partial multi-device overwrites.
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
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.app_states
  set
    state = coalesce(p_state, '{}'::jsonb),
    revision = app_states.revision + 1
  where user_id = v_user_id
    and app_states.revision = greatest(0, coalesce(p_expected_revision, 0))
  returning app_states.revision into v_revision;

  if not found then
    select app_states.revision
    into v_revision
    from public.app_states
    where user_id = v_user_id;
    return query select false, coalesce(v_revision, 0);
    return;
  end if;

  update public.profiles
  set
    name = coalesce(p_name, ''),
    avatar_url = coalesce(p_avatar_url, '')
  where id = v_user_id;

  if not found then
    raise exception 'Profile row is missing' using errcode = 'P0002';
  end if;

  return query select true, v_revision;
end;
$$;

revoke all on function public.save_app_snapshot(bigint, jsonb, text, text) from public, anon;
grant execute on function public.save_app_snapshot(bigint, jsonb, text, text) to authenticated;

create or replace function public.load_app_snapshot()
returns table(
  account_id text,
  name text,
  avatar_url text,
  state jsonb,
  revision bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    profiles.account_id,
    profiles.name,
    profiles.avatar_url,
    app_states.state,
    app_states.revision
  from public.profiles
  left join public.app_states on app_states.user_id = profiles.id
  where profiles.id = auth.uid()
  limit 1;
$$;

revoke all on function public.load_app_snapshot() from public, anon;
grant execute on function public.load_app_snapshot() to authenticated;

-- MCP access tokens are generated by the mcp-token Edge Function.
-- Only a SHA-256 hash is stored here; token plaintext is shown once to the user.
create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  name text not null default 'My Life Memory MCP',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_id_created_at_idx
  on public.mcp_tokens (user_id, created_at desc);

create index if not exists mcp_tokens_active_hash_idx
  on public.mcp_tokens (token_hash)
  where revoked_at is null;

delete from public.mcp_tokens
where revoked_at is not null
   or id not in (
    select distinct on (user_id) id
    from public.mcp_tokens
    where revoked_at is null
    order by user_id, created_at desc
  );

create unique index if not exists mcp_tokens_one_per_user_idx
  on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon, authenticated;
grant select, insert, update, delete on public.mcp_tokens to service_role;

-- Private image storage.
-- File paths must live under the authenticated user's UUID folder:
--   <auth.uid()>/<folder>/<record-id>/<image-id>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'life-media',
  'life-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists "Users can read own life media" on storage.objects;
create policy "Users can read own life media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can insert own life media" on storage.objects;
create policy "Users can insert own life media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own life media" on storage.objects;
create policy "Users can update own life media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own life media" on storage.objects;
create policy "Users can delete own life media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
