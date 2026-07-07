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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
