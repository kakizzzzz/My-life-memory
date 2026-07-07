-- 1) Confirm this session is hitting the expected project/schema.
select current_setting('server_version') as postgres_version;
select current_database() as db_name;

-- 2) Confirm tables exist.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'app_states')
order by table_name;

-- 3) Confirm anonymous/authenticated grants on both tables.
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

-- 4) Confirm RLS policies exist and apply to authenticated users.
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

-- 5) Confirm current auth role (run only in a signed-in browser session via app query endpoints).
select current_setting('role') as current_role;
