-- Require valid Vault configuration before enabling the media-retention Cron.
--
-- 20260720 may already be installed in production, so this follow-up migration
-- does not rewrite that migration. It first removes the existing named job in
-- its own transaction. If validation below fails, no broken scheduled job is
-- left behind. Configure the Edge Function and Vault, then rerun this file.

begin;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  for v_job_id in execute
    'select jobid from cron.job where jobname = ''my-life-memory-media-retention-daily'''
  loop
    execute 'select cron.unschedule($1)' using v_job_id;
  end loop;
end;
$$;

commit;

begin;

do $$
declare
  v_project_count integer;
  v_retention_count integer;
  v_project_url text;
  v_retention_secret text;
begin
  if to_regnamespace('cron') is null then
    raise exception 'pg_cron is unavailable' using errcode = '55000';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net is unavailable' using errcode = '55000';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is unavailable' using errcode = '55000';
  end if;

  select count(*), max(secret.decrypted_secret)
  into v_project_count, v_project_url
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_project_url';

  select count(*), max(secret.decrypted_secret)
  into v_retention_count, v_retention_secret
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_media_retention_secret';

  if v_project_count <> 1 then
    raise exception 'Vault project URL must exist exactly once' using errcode = '22023';
  end if;

  if v_retention_count <> 1 then
    raise exception 'Vault media retention secret must exist exactly once' using errcode = '22023';
  end if;

  v_project_url := rtrim(coalesce(v_project_url, ''), '/');
  v_retention_secret := coalesce(v_retention_secret, '');

  if v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Vault project URL is invalid' using errcode = '22023';
  end if;

  if char_length(v_retention_secret) < 32 then
    raise exception 'Vault media retention secret is too short' using errcode = '22023';
  end if;

  if to_regprocedure('public.invoke_memory_media_retention()') is null then
    raise exception 'Media retention Cron bridge is unavailable' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.invoke_memory_media_retention()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_count integer;
  v_retention_count integer;
  v_project_url text;
  v_retention_secret text;
  v_request_id bigint;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is unavailable' using errcode = '55000';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net is unavailable' using errcode = '55000';
  end if;

  select count(*), max(secret.decrypted_secret)
  into v_project_count, v_project_url
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_project_url';

  select count(*), max(secret.decrypted_secret)
  into v_retention_count, v_retention_secret
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_media_retention_secret';

  if v_project_count <> 1 or v_retention_count <> 1 then
    raise exception 'Media retention Vault configuration is incomplete or ambiguous'
      using errcode = '22023';
  end if;

  v_project_url := rtrim(coalesce(v_project_url, ''), '/');
  v_retention_secret := coalesce(v_retention_secret, '');

  if v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Vault project URL is invalid' using errcode = '22023';
  end if;

  if char_length(v_retention_secret) < 32 then
    raise exception 'Vault media retention secret is too short' using errcode = '22023';
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/media-retention',
    body := jsonb_build_object('source', 'supabase-cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_retention_secret
    ),
    timeout_milliseconds := 180000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.invoke_memory_media_retention() is
  'Owner-only Supabase Cron bridge with strict Vault prerequisite validation.';

revoke all on function public.invoke_memory_media_retention()
  from public, anon, authenticated, service_role;

select cron.schedule(
  'my-life-memory-media-retention-daily',
  '47 3 * * *',
  'select public.invoke_memory_media_retention();'
);

commit;
