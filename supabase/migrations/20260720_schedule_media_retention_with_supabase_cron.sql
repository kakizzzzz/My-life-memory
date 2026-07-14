-- Schedule the authenticated media-retention Edge Function from Supabase.
--
-- Required Vault secrets (values are never stored in this migration):
--   my_life_memory_project_url
--   my_life_memory_media_retention_secret
--
-- The retention secret must match the MEDIA_RETENTION_CRON_SECRET configured
-- for the media-retention Edge Function.

begin;

-- Hosted Supabase provides both extensions. The guards keep the migration
-- readable in local PostgreSQL environments where either extension is absent.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net with schema extensions';
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
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

  select secret.decrypted_secret
  into v_project_url
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_project_url';

  select secret.decrypted_secret
  into v_retention_secret
  from vault.decrypted_secrets secret
  where secret.name = 'my_life_memory_media_retention_secret';

  v_project_url := rtrim(coalesce(v_project_url, ''), '/');
  v_retention_secret := coalesce(v_retention_secret, '');

  if v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Vault project URL is missing or invalid' using errcode = '22023';
  end if;

  if char_length(v_retention_secret) < 32 then
    raise exception 'Vault media retention secret is missing or too short' using errcode = '22023';
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
  'Owner-only Supabase Cron bridge to the authenticated media-retention Edge Function.';

revoke all on function public.invoke_memory_media_retention()
  from public, anon, authenticated, service_role;

-- Replace only this named job so rerunning the migration is idempotent.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then
    raise notice 'pg_cron or pg_net is unavailable; media retention was not scheduled.';
    return;
  end if;

  for v_job_id in execute
    'select jobid from cron.job where jobname = ''my-life-memory-media-retention-daily'''
  loop
    execute 'select cron.unschedule($1)' using v_job_id;
  end loop;

  execute $schedule$
    select cron.schedule(
      'my-life-memory-media-retention-daily',
      '47 3 * * *',
      'select public.invoke_memory_media_retention();'
    )
  $schedule$;
end;
$$;

commit;
