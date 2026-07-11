-- Repair only the service-role privileges used by the current Edge Functions.
-- The legacy app_states archive remains read-only even to routine service code.

grant usage on schema public to service_role;

revoke insert, update, delete on public.app_states from service_role;
revoke insert, update, delete on public.profiles from service_role;
revoke insert, update, delete on public.memory_settings from service_role;
revoke insert, update, delete on public.memory_stars from service_role;
revoke insert, update, delete on public.memory_notes from service_role;
revoke insert, update, delete on public.memory_tracks from service_role;
revoke insert, update, delete on public.memory_entity_history from service_role;
grant select on public.app_states to service_role;
grant select on public.profiles to service_role;
grant select on public.memory_settings to service_role;
grant select on public.memory_stars to service_role;
grant select on public.memory_notes to service_role;
grant select on public.memory_tracks to service_role;
grant select on public.memory_entity_history to service_role;

-- MCP token creation/revocation is an intentional server-only write path.
grant select, insert, update, delete on public.mcp_tokens to service_role;

grant execute on function public.initialize_normalized_memory_account(uuid, text, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.summarize_normalized_memory_range(uuid, date, date, text)
  to service_role;

grant usage on schema storage to service_role;
grant select, insert, update, delete on storage.objects to service_role;
