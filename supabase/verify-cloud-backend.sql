-- Read-only project verification for normalized memory storage v2.

-- 1) Confirm this session is hitting the expected project/schema.
select current_setting('server_version') as postgres_version;
select current_database() as db_name;

-- 2) Every required table must exist.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'app_states', 'mcp_tokens',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history'
  )
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
    'profiles', 'app_states',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history'
  )
  and grantee = 'authenticated'
order by table_name, privilege_type;

-- This query must return zero rows.
select table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'profiles', 'app_states',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history'
  )
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- 5) RLS must be enabled and own-user SELECT policies must exist.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'profiles',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history', 'memory_media_deletion_queue'
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
    'profiles',
    'memory_settings', 'memory_stars', 'memory_notes',
    'memory_tracks', 'memory_entity_history'
  )
order by tablename, cmd, policyname;

-- 6) Required RPCs must exist with their expected privilege boundary.
select
  routine_name,
  specific_name,
  security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'apply_memory_mutations',
    'initialize_normalized_memory_account',
    'list_protected_memory_media_paths',
    'purge_expired_memory_trash',
    'enqueue_memory_media_deletion',
    'run_server_memory_retention',
    'claim_due_memory_media_deletions',
    'memory_media_path_is_protected',
    'complete_memory_media_deletion',
    'fail_memory_media_deletion',
    'summarize_normalized_memory_range',
    'save_app_snapshot',
    'load_app_snapshot'
  )
order by routine_name;

-- Server media deletion queue should normally be small. Repeated failures stay
-- visible here without exposing the queue to authenticated clients.
select
  count(*) as queued_media,
  count(*) filter (where not_before <= now()) as due_media,
  count(*) filter (where last_error is not null) as failed_media,
  max(attempts) as maximum_attempts,
  min(created_at) as oldest_queue_item
from public.memory_media_deletion_queue;

-- 7) Confirm Storage object policies remain user-scoped.
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

-- 8) Legacy archives should remain present and v2 accounts must be verified.
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

-- 9) MCP tokens must store hashes, never plaintext token values.
select
  count(*) as active_mcp_tokens,
  count(*) filter (where token_hash like 'mlm_%') as suspicious_plaintext_tokens
from public.mcp_tokens
where revoked_at is null;
