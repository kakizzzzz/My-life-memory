-- Required for Supabase Edge Functions that read/write app state with the
-- service role key through PostgREST.

grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.app_states to service_role;
grant select, insert, update, delete on public.mcp_tokens to service_role;

grant usage on schema storage to service_role;
grant select, insert, update, delete on storage.objects to service_role;
