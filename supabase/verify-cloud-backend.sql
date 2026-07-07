-- 1) Confirm this session is hitting the expected project/schema.
select current_setting('server_version') as postgres_version;
select current_database() as db_name;

-- 2) Confirm tables exist.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'app_states')
order by table_name;

-- 3) Confirm private storage bucket exists.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'life-media';

-- 4) Confirm anonymous/authenticated grants on both tables.
select
  grantor::regrole as grantor,
  grantee::regrole as grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'app_states')
  and grantee = 'authenticated'
order by table_name, privilege_type;

-- 5) Confirm RLS policies exist and apply to authenticated users.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'app_states')
order by tablename, cmd, policyname;

-- 6) Confirm storage object policies.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like '%life media%'
order by cmd, policyname;

-- 7) Confirm current auth role (run only in a signed-in browser session via app query endpoints).
select current_setting('role') as current_role;

-- 8) Confirm no legacy password field remains in app state.
select count(*) as app_states_with_profile_password
from public.app_states
where state #> '{profile,password}' is not null;
