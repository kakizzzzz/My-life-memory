-- Read-only project verification for normalized memory storage v2.

-- 1) Confirm this session is hitting the expected project/schema.
select current_setting('server_version') as postgres_version;
select current_database() as db_name;

-- 2) Every required table must report object_exists = true. Listing the expected
-- names first ensures a missing table remains visible instead of disappearing
-- from the result set.
with required_tables(table_name) as (
  values
    ('profiles'),
    ('app_states'),
    ('mcp_tokens'),
    ('edge_rate_limits'),
    ('memory_settings'),
    ('memory_stars'),
    ('memory_notes'),
    ('memory_tracks'),
    ('memory_entity_history'),
    ('memory_registration_claims'),
    ('memory_privacy_consents'),
    ('memory_media_deletion_queue')
)
select
  table_name,
  to_regclass(format('public.%I', table_name)) is not null as object_exists
from required_tables
order by table_name;

-- 3) The private media bucket must exist.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'life-media';

-- 4) Authenticated users should have SELECT only on profiles and normalized
-- rows. app_states should have no authenticated privileges at all. Writes go
-- through apply_memory_mutations.
select
  grantee::regrole as grantee,
  table_name,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'profiles', 'app_states', 'mcp_tokens', 'edge_rate_limits',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history',
    'memory_registration_claims', 'memory_privacy_consents',
    'memory_media_deletion_queue'
  )
  and grantee = 'authenticated'
order by table_name, privilege_type;

-- This query must return zero rows.
select table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'profiles', 'app_states', 'mcp_tokens', 'edge_rate_limits',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history',
    'memory_registration_claims', 'memory_privacy_consents',
    'memory_media_deletion_queue'
  )
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- 5) RLS must be enabled and own-user SELECT policies must exist.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'profiles', 'app_states', 'mcp_tokens', 'edge_rate_limits',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history',
    'memory_registration_claims', 'memory_privacy_consents',
    'memory_media_deletion_queue'
  )
order by relname;

select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'app_states', 'mcp_tokens', 'edge_rate_limits',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history',
    'memory_registration_claims', 'memory_privacy_consents',
    'memory_media_deletion_queue'
  )
order by tablename, cmd, policyname;

-- 6) Every required RPC must report object_exists = true. This includes the complete
-- atomic registration flow, rate limiting, normalized data operations, and
-- server-owned retention/media maintenance.
with required_rpcs(routine_name) as (
  values
    ('consume_edge_rate_limit'),
    ('claim_memory_registration'),
    ('bind_memory_registration_claim'),
    ('release_memory_registration_claim'),
    ('initialize_claimed_memory_account'),
    ('initialize_normalized_memory_account'),
    ('apply_memory_mutations'),
    ('list_protected_memory_media_paths'),
    ('purge_expired_memory_trash'),
    ('purge_expired_memory_trash_for_user'),
    ('purge_expired_memory_trash_all_users'),
    ('enqueue_memory_media_deletion'),
    ('run_server_memory_retention'),
    ('claim_due_memory_media_deletions'),
    ('memory_media_path_is_protected'),
    ('complete_memory_media_deletion'),
    ('fail_memory_media_deletion'),
    ('invoke_memory_media_retention'),
    ('summarize_normalized_memory_range'),
    ('save_app_snapshot'),
    ('load_app_snapshot')
)
select
  expected.routine_name,
  count(actual.specific_name) > 0 as object_exists,
  coalesce(
    string_agg(distinct actual.security_type, ', ' order by actual.security_type),
    'MISSING'
  ) as security_types
from required_rpcs expected
left join information_schema.routines actual
  on actual.routine_schema = 'public'
 and actual.routine_name = expected.routine_name
group by expected.routine_name
order by expected.routine_name;

-- Registration is service-only. Each row must exist, allow service_role, and
-- deny both browser roles.
with registration_rpcs(signature) as (
  values
    ('public.claim_memory_registration(text,uuid)'),
    ('public.bind_memory_registration_claim(text,uuid,uuid)'),
    ('public.release_memory_registration_claim(text,uuid)'),
    ('public.initialize_claimed_memory_account(uuid,uuid,text,text,text,jsonb,jsonb,text)'),
    ('public.initialize_normalized_memory_account(uuid,text,text,text,jsonb,jsonb)')
)
select
  signature,
  to_regprocedure(signature) is not null as object_exists,
  coalesce(has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'), false) as service_role_execute,
  coalesce(has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE'), false) as anon_execute,
  coalesce(has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'), false) as authenticated_execute
from registration_rpcs
order by signature;

-- 7) Supabase owns both daily maintenance schedules. Only secret names are
-- inspected here; decrypted values must never be selected into verification
-- output, logs, or support screenshots.
with required_extensions(extension_name) as (
  values ('pg_cron'), ('pg_net')
)
select
  expected.extension_name,
  installed.extversion is not null as installed,
  installed.extversion
from required_extensions expected
left join pg_extension installed
  on installed.extname = expected.extension_name
order by expected.extension_name;

with required_vault_secrets(secret_name) as (
  values
    ('my_life_memory_project_url'),
    ('my_life_memory_media_retention_secret')
)
select
  expected.secret_name,
  count(secret.id) > 0 as secret_exists
from required_vault_secrets expected
left join vault.secrets secret
  on secret.name = expected.secret_name
group by expected.secret_name
order by expected.secret_name;

with required_cron_jobs(job_name) as (
  values
    ('my-life-memory-expired-trash-daily'),
    ('my-life-memory-media-retention-daily')
)
select
  expected.job_name,
  job.jobid is not null as job_exists,
  job.schedule,
  job.active,
  job.command
from required_cron_jobs expected
left join cron.job job
  on job.jobname = expected.job_name
order by expected.job_name;

select
  to_regprocedure('public.invoke_memory_media_retention()') is not null as object_exists,
  coalesce(has_function_privilege('anon', to_regprocedure('public.invoke_memory_media_retention()'), 'EXECUTE'), false) as anon_execute,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.invoke_memory_media_retention()'), 'EXECUTE'), false) as authenticated_execute,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.invoke_memory_media_retention()'), 'EXECUTE'), false) as service_role_execute;

-- Server media deletion queue should normally be small. Repeated failures stay
-- visible here without exposing the queue to authenticated clients.
select
  count(*) as queued_media,
  count(*) filter (where not_before <= now()) as due_media,
  count(*) filter (where last_error is not null) as failed_media,
  max(attempts) as maximum_attempts,
  min(created_at) as oldest_queue_item
from public.memory_media_deletion_queue;

-- 8) Confirm Storage object policies remain user-scoped.
select
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like '%life media%'
order by cmd, policyname;

-- 9) Legacy archives should remain present and v2 accounts must be verified.
select
  count(*) as legacy_archive_rows,
  count(*) filter (where state #> '{profile,password}' is not null) as archives_with_legacy_profile_password
from public.app_states;

select
  count(*) as normalized_accounts,
  count(*) filter (where migration_verified_at is null) as unverified_accounts,
  min(dataset_revision) as minimum_revision,
  max(dataset_revision) as maximum_revision
from public.memory_settings;

-- 10) MCP tokens must store hashes, never plaintext token values.
select
  count(*) as active_mcp_tokens,
  count(*) filter (where token_hash like 'mlm_%') as suspicious_plaintext_tokens
from public.mcp_tokens
where revoked_at is null;
