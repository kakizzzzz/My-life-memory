-- Serialize account registration and persist the privacy notice accepted at signup.
-- This migration intentionally leaves the normalized memory tables and app_states unchanged.
begin;

create table if not exists public.memory_registration_claims (
  account_id text primary key,
  request_nonce uuid not null,
  auth_user_id uuid references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  constraint memory_registration_claim_account_normalized
    check (account_id = lower(trim(account_id)) and length(account_id) between 1 and 160),
  constraint memory_registration_claim_expiry_valid check (expires_at > claimed_at)
);

create index if not exists memory_registration_claims_expires_idx
on public.memory_registration_claims (expires_at);

create table if not exists public.memory_privacy_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  privacy_version text not null,
  consented_at timestamptz not null default now(),
  source text not null default 'registration',
  constraint memory_privacy_consent_version_valid check (length(trim(privacy_version)) between 1 and 80),
  constraint memory_privacy_consent_source_valid check (source in ('registration'))
);

alter table public.memory_registration_claims enable row level security;
alter table public.memory_privacy_consents enable row level security;

revoke all on public.memory_registration_claims from public, anon, authenticated, service_role;
revoke all on public.memory_privacy_consents from public, anon, authenticated, service_role;
grant select on public.memory_privacy_consents to authenticated;
grant select on public.memory_privacy_consents to service_role;

drop policy if exists "Users can read own privacy consent" on public.memory_privacy_consents;
create policy "Users can read own privacy consent"
on public.memory_privacy_consents for select to authenticated
using (auth.uid() = user_id);

create or replace function public.claim_memory_registration(
  p_account_id text,
  p_request_nonce uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account text := lower(trim(coalesce(p_account_id, '')));
  v_inserted_count bigint := 0;
  v_claim public.memory_registration_claims%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_request_nonce is null or length(v_account) not between 1 and 160 then
    raise exception 'A valid account and request nonce are required' using errcode = '22023';
  end if;

  delete from public.memory_registration_claims
  where expires_at < now() - interval '1 day';

  if exists (select 1 from public.profiles where account_id = v_account) then
    return 'account_exists';
  end if;

  insert into public.memory_registration_claims (account_id, request_nonce)
  values (v_account, p_request_nonce)
  on conflict (account_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count > 0 then
    -- Recheck after obtaining the unique claim. A previous claimant may have
    -- committed its profile while this insert was waiting on the primary key.
    if exists (select 1 from public.profiles where account_id = v_account) then
      delete from public.memory_registration_claims
      where account_id = v_account and request_nonce = p_request_nonce;
      return 'account_exists';
    end if;
    return 'claimed';
  end if;

  select * into v_claim
  from public.memory_registration_claims
  where account_id = v_account
  for update;

  if v_claim.request_nonce = p_request_nonce then
    update public.memory_registration_claims
    set expires_at = now() + interval '5 minutes'
    where account_id = v_account and request_nonce = p_request_nonce;
    return 'claimed';
  end if;

  if v_claim.expires_at > now() then
    return 'busy';
  end if;

  update public.memory_registration_claims
  set request_nonce = p_request_nonce,
      auth_user_id = null,
      claimed_at = now(),
      expires_at = now() + interval '5 minutes'
  where account_id = v_account;

  if exists (select 1 from public.profiles where account_id = v_account) then
    delete from public.memory_registration_claims
    where account_id = v_account and request_nonce = p_request_nonce;
    return 'account_exists';
  end if;

  return 'claimed';
end;
$$;

create or replace function public.bind_memory_registration_claim(
  p_account_id text,
  p_request_nonce uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account text := lower(trim(coalesce(p_account_id, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_request_nonce is null or p_user_id is null then
    raise exception 'Request nonce and user ID are required' using errcode = '22023';
  end if;

  update public.memory_registration_claims
  set auth_user_id = p_user_id,
      expires_at = now() + interval '5 minutes'
  where account_id = v_account
    and request_nonce = p_request_nonce
    and expires_at > now();

  return found;
end;
$$;

create or replace function public.release_memory_registration_claim(
  p_account_id text,
  p_request_nonce uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account text := lower(trim(coalesce(p_account_id, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  delete from public.memory_registration_claims
  where account_id = v_account and request_nonce = p_request_nonce;
  return found;
end;
$$;

create or replace function public.initialize_claimed_memory_account(
  p_request_nonce uuid,
  p_user_id uuid,
  p_account_id text,
  p_name text,
  p_avatar_url text,
  p_settings jsonb,
  p_default_star jsonb,
  p_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account text := lower(trim(coalesce(p_account_id, '')));
  v_claim public.memory_registration_claims%rowtype;
  v_privacy_version text := trim(coalesce(p_privacy_version, ''));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_request_nonce is null or p_user_id is null or length(v_privacy_version) not between 1 and 80 then
    raise exception 'Registration claim and privacy version are required' using errcode = '22023';
  end if;

  select * into v_claim
  from public.memory_registration_claims
  where account_id = v_account
  for update;

  if not found
    or v_claim.request_nonce <> p_request_nonce
    or v_claim.auth_user_id is distinct from p_user_id
    or v_claim.expires_at <= now() then
    raise exception 'Registration claim is missing, expired, or owned by another request' using errcode = '55000';
  end if;

  perform public.initialize_normalized_memory_account(
    p_user_id,
    v_account,
    p_name,
    p_avatar_url,
    p_settings,
    p_default_star
  );

  insert into public.memory_privacy_consents (user_id, privacy_version, consented_at, source)
  values (p_user_id, v_privacy_version, now(), 'registration')
  on conflict (user_id) do update set
    privacy_version = excluded.privacy_version,
    consented_at = excluded.consented_at,
    source = excluded.source;

  delete from public.memory_registration_claims
  where account_id = v_account and request_nonce = p_request_nonce;
end;
$$;

revoke all on function public.claim_memory_registration(text, uuid) from public, anon, authenticated;
revoke all on function public.bind_memory_registration_claim(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_memory_registration_claim(text, uuid) from public, anon, authenticated;
revoke all on function public.initialize_claimed_memory_account(uuid, uuid, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.claim_memory_registration(text, uuid) to service_role;
grant execute on function public.bind_memory_registration_claim(text, uuid, uuid) to service_role;
grant execute on function public.release_memory_registration_claim(text, uuid) to service_role;
grant execute on function public.initialize_claimed_memory_account(uuid, uuid, text, text, text, jsonb, jsonb, text) to service_role;

commit;
