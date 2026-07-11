-- Repair grants for normalized memory storage v2 only.
-- Run 20260713_normalized_memory_storage_v2.sql first. This script deliberately
-- keeps profiles and app_states read-only for normal authenticated clients.

grant usage on schema public to authenticated;

revoke insert, update, delete on public.profiles from authenticated;
revoke all on public.app_states from authenticated;
drop policy if exists "Users can read own app state" on public.app_states;
drop policy if exists "Users can insert own app state" on public.app_states;
drop policy if exists "Users can update own app state" on public.app_states;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

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

revoke all on function public.apply_memory_mutations(bigint, jsonb) from public, anon;
grant execute on function public.apply_memory_mutations(bigint, jsonb) to authenticated;
revoke all on function public.list_protected_memory_media_paths() from public, anon;
grant execute on function public.list_protected_memory_media_paths() to authenticated;
revoke all on function public.summarize_normalized_memory_range(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.summarize_normalized_memory_range(uuid, date, date, text)
  to service_role;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
