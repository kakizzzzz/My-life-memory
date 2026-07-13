import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const normalizedMigration = await readFile('supabase/migrations/20260713_normalized_memory_storage_v2.sql', 'utf8');
const registrationMigration = await readFile('supabase/migrations/20260715_registration_integrity.sql', 'utf8');
const userId = '33333333-3333-4333-8333-333333333333';
const otherUserId = '44444444-4444-4444-8444-444444444444';
const firstNonce = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const competingNonce = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    account_id text not null unique,
    name text not null default '',
    avatar_url text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.app_states (
    user_id uuid primary key references auth.users(id) on delete cascade,
    state jsonb not null default '{}'::jsonb,
    revision bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create function public.set_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end;
  $$;
  grant usage on schema public, auth to authenticated, service_role;
  grant select, insert, update on public.profiles, public.app_states to authenticated;
  create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
  create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
  create policy "Users can insert own app state" on public.app_states for insert with check (auth.uid() = user_id);
  create policy "Users can update own app state" on public.app_states for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
`);

await db.exec(normalizedMigration);
await db.exec(registrationMigration);
await db.exec(registrationMigration);
await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
await db.query('insert into auth.users(id) values ($1), ($2)', [userId, otherUserId]);
await db.query(
  'insert into public.app_states(user_id, state, revision) values ($1, $2::jsonb, 7)',
  [userId, JSON.stringify({ archived: 'must remain unchanged' })],
);

const firstClaim = await db.query(
  'select public.claim_memory_registration($1, $2) as status',
  ['new-account', firstNonce],
);
if (firstClaim.rows[0]?.status !== 'claimed') throw new Error('The first registration request did not obtain its claim.');

const competingClaim = await db.query(
  'select public.claim_memory_registration($1, $2) as status',
  ['new-account', competingNonce],
);
if (competingClaim.rows[0]?.status !== 'busy') throw new Error('A concurrent registration request was not serialized.');

const wrongBind = await db.query(
  'select public.bind_memory_registration_claim($1, $2, $3) as bound',
  ['new-account', competingNonce, userId],
);
if (wrongBind.rows[0]?.bound !== false) throw new Error('A competing nonce bound another request\'s claim.');

const correctBind = await db.query(
  'select public.bind_memory_registration_claim($1, $2, $3) as bound',
  ['new-account', firstNonce, userId],
);
if (correctBind.rows[0]?.bound !== true) throw new Error('The claim owner could not bind its Auth user.');

await db.query(
  `select public.initialize_claimed_memory_account(
    $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
  )`,
  [
    firstNonce,
    userId,
    'new-account',
    'New user',
    '',
    JSON.stringify({ mapStyle: 'light', language: 'zh' }),
    JSON.stringify({ id: 'default-star', lat: 31.2, lng: 121.4, createdAt: 1 }),
    '2026-07-13',
  ],
);

const initialized = await db.query(`
  select
    (select count(*) from public.profiles where id = $1 and account_id = 'new-account') as profiles,
    (select count(*) from public.memory_settings where user_id = $1) as settings,
    (select count(*) from public.memory_stars where user_id = $1 and id = 'default-star') as stars,
    (select count(*) from public.memory_privacy_consents where user_id = $1 and privacy_version = '2026-07-13') as consents,
    (select count(*) from public.memory_registration_claims where account_id = 'new-account') as claims
`, [userId]);
const result = initialized.rows[0];
if (Number(result.profiles) !== 1 || Number(result.settings) !== 1 || Number(result.stars) !== 1
  || Number(result.consents) !== 1 || Number(result.claims) !== 0) {
  throw new Error(`Registration initialization was incomplete: ${JSON.stringify(result)}`);
}

const existingClaim = await db.query(
  'select public.claim_memory_registration($1, $2) as status',
  ['new-account', competingNonce],
);
if (existingClaim.rows[0]?.status !== 'account_exists') throw new Error('An initialized account could be claimed again.');

await db.query(
  'select public.claim_memory_registration($1, $2)',
  ['stale-account', firstNonce],
);
await db.query(`
  update public.memory_registration_claims
  set claimed_at = now() - interval '10 minutes',
      expires_at = now() - interval '1 second'
  where account_id = 'stale-account'
`);
const staleTakeover = await db.query(
  'select public.claim_memory_registration($1, $2) as status',
  ['stale-account', competingNonce],
);
if (staleTakeover.rows[0]?.status !== 'claimed') throw new Error('An expired registration claim could not be safely replaced.');

await db.exec(registrationMigration);
const retainedConsent = await db.query(
  'select count(*) as count from public.memory_privacy_consents where user_id = $1',
  [userId],
);
if (Number(retainedConsent.rows[0]?.count) !== 1) throw new Error('Repeated migration removed an existing privacy consent.');

const archive = await db.query('select state, revision from public.app_states where user_id = $1', [userId]);
if (archive.rows[0]?.state?.archived !== 'must remain unchanged' || Number(archive.rows[0]?.revision) !== 7) {
  throw new Error('Registration initialization modified the legacy app_states archive.');
}
const otherUser = await db.query('select count(*) as count from auth.users where id = $1', [otherUserId]);
if (Number(otherUser.rows[0]?.count) !== 1) throw new Error('Registration changed another Auth user.');

await db.close();
