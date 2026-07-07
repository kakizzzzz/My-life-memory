-- Run this if you see "cloud database setup is not complete" or 42501
-- "permission denied for table profiles/app_states".

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.app_states to authenticated;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
