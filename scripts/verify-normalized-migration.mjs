import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile('supabase/migrations/20260713_normalized_memory_storage_v2.sql', 'utf8');
const verifySql = await readFile('supabase/verify-normalized-memory.sql', 'utf8');
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';

const bootstrap = async db => {
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
};

const makeState = (suffix = '') => ({
  mapStyle: 'dark',
  language: 'zh',
  systemTheme: { page: '#eeeeee', password: 'legacy-secret-must-not-migrate' },
  profileConflicts: [{ name: 'Old name', capturedAt: 1, source: 'remote', access_token: 'legacy-token' }],
  profile: { account: `owner${suffix}`, name: 'Owner' },
  stars: [{
    id: `star-1${suffix}`,
    lat: 31.2,
    lng: 121.4,
    createdAt: 10,
    color: '#112233',
    notes: [{
      id: `note-1${suffix}`,
      title: 'Title',
      titleHtml: '<p>Title</p>',
      content: 'Memory',
      contentHtml: '<p style="color:#112233">Memory</p>',
      imageUrls: [],
      images: [],
      createdAt: 11,
      updatedAt: 12,
    }],
  }],
  savedTracks: [{
    id: `track-1${suffix}`,
    paths: [[[31.2, 121.4], [31.21, 121.41]]],
    color: '#445566',
    time: 18,
    distance: 0.4,
    createdAt: 13,
    updatedAt: 14,
  }],
});

const db = new PGlite();
await bootstrap(db);
for (const [id, account, state] of [
  [userId, 'owner', makeState()],
  [otherUserId, 'other', makeState('-other')],
]) {
  await db.query('insert into auth.users(id) values ($1)', [id]);
  await db.query('insert into public.profiles(id,account_id,name) values ($1,$2,$3)', [id, account, account]);
  await db.query('insert into public.app_states(user_id,state) values ($1,$2::jsonb)', [id, JSON.stringify(state)]);
}

await db.exec(migration);
await db.exec(verifySql);
const first = await db.query(`
  select
    (select count(*) from public.memory_stars) as stars,
    (select count(*) from public.memory_notes) as notes,
    (select count(*) from public.memory_tracks) as tracks,
    (select count(*) from public.memory_settings where migration_verified_at is not null) as verified
`);
if (Number(first.rows[0].stars) !== 2 || Number(first.rows[0].notes) !== 2
  || Number(first.rows[0].tracks) !== 2 || Number(first.rows[0].verified) !== 2) {
  throw new Error(`Unexpected migrated counts: ${JSON.stringify(first.rows[0])}`);
}
const sensitiveRows = await db.query(`
  select count(*) as count
  from public.memory_settings settings
  where public.memory_json_has_sensitive_keys(settings.system_theme)
    or public.memory_json_has_sensitive_keys(settings.profile_conflicts)
    or public.memory_json_has_sensitive_keys(settings.profile_metadata)
`);
if (Number(sensitiveRows.rows[0].count) !== 0) {
  throw new Error('Sensitive legacy keys entered normalized storage.');
}

await db.exec(migration);
const second = await db.query('select count(*) as notes from public.memory_notes');
if (Number(second.rows[0].notes) !== 2) throw new Error('Repeated migration created duplicates.');

await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
const aggregate = await db.query(
  "select public.summarize_normalized_memory_range($1, null, null, 'Asia/Shanghai') as value",
  [userId]
);
const summary = aggregate.rows[0].value;
if (Number(summary?.totals?.notes) !== 1 || Number(summary?.totals?.routes) !== 1
  || Number(summary?.totals?.locations) !== 1 || summary?.topLocations?.[0]?.id !== 'star-1') {
  throw new Error(`Database range summary was incomplete: ${JSON.stringify(summary)}`);
}
const archivedBefore = await db.query('select state from public.app_states where user_id = $1', [userId]);
const legacyStoragePath = `${userId}/notes/note-1/legacy.jpg`;
await db.query(
  'update public.memory_notes set image_urls = $1::jsonb where user_id = $2 and star_id = $3 and id = $4',
  [JSON.stringify([`storage://life-media/${legacyStoragePath}`]), userId, 'star-1', 'note-1']
);

await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
await db.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
await db.exec('set role authenticated');
const visible = await db.query('select user_id, id from public.memory_stars');
if (visible.rows.length !== 1 || visible.rows[0].user_id !== userId) throw new Error('RLS exposed another user.');
const visibleProfiles = await db.query('select id from public.profiles');
if (visibleProfiles.rows.length !== 1 || visibleProfiles.rows[0].id !== userId) {
  throw new Error('Profile RLS exposed another user.');
}
let authenticatedArchiveReadRejected = false;
try {
  await db.query('select state from public.app_states where user_id = $1', [userId]);
} catch {
  authenticatedArchiveReadRejected = true;
}
if (!authenticatedArchiveReadRejected) throw new Error('Authenticated client retained direct archive access.');
const protectedLegacyStorage = await db.query('select path from public.list_protected_memory_media_paths()');
if (!protectedLegacyStorage.rows.some(row => row.path === legacyStoragePath)) {
  throw new Error('A legacy storage:// note image was not protected from media cleanup.');
}

const mutation = [{
  type: 'note_upsert', entityId: 'note-1', starId: 'star-1',
  payload: {
    id: 'note-1', starId: 'star-1', sortOrder: 0,
    title: 'Title', titleHtml: '<p>Title</p>', content: 'Changed', contentHtml: '<p>Changed</p>',
    imageUrl: null, imageUrls: [], images: [], fontSize: null, titleFontSize: null,
    color: null, createdAt: 11, updatedAt: 20,
  },
}];
const saved = await db.query('select * from public.apply_memory_mutations($1,$2::jsonb)', [0, JSON.stringify(mutation)]);
if (!saved.rows[0].saved || Number(saved.rows[0].dataset_revision) !== 1) throw new Error('Atomic mutation RPC failed.');

const staleMutation = [{
  type: 'star_upsert', entityId: 'must-not-exist',
  payload: { id: 'must-not-exist', sortOrder: 1, lat: 1, lng: 1 },
}];
const staleResult = await db.query(
  'select * from public.apply_memory_mutations($1,$2::jsonb)',
  [0, JSON.stringify(staleMutation)]
);
if (staleResult.rows[0].saved || Number(staleResult.rows[0].dataset_revision) !== 1) {
  throw new Error('Stale revision did not reject the whole mutation batch.');
}
const staleEntity = await db.query("select count(*) as count from public.memory_stars where id = 'must-not-exist'");
if (Number(staleEntity.rows[0].count) !== 0) throw new Error('A stale mutation partially committed.');

let crossUserMutationRejected = false;
try {
  await db.query(
    'select * from public.apply_memory_mutations($1,$2::jsonb)',
    [1, JSON.stringify([{ type: 'star_soft_delete', entityId: 'star-1-other' }])]
  );
} catch (error) {
  crossUserMutationRejected = String(error).includes('not found');
}
if (!crossUserMutationRejected) throw new Error('A cross-user entity id was not rejected.');
await db.exec('reset role');
const otherStar = await db.query(
  'select deleted_at from public.memory_stars where user_id = $1 and id = $2',
  [otherUserId, 'star-1-other']
);
if (otherStar.rows[0]?.deleted_at) throw new Error('One user changed another user\'s star.');
const revisionAfterRejectedDelete = await db.query(
  'select dataset_revision from public.memory_settings where user_id = $1',
  [userId]
);
if (Number(revisionAfterRejectedDelete.rows[0].dataset_revision) !== 1) {
  throw new Error('Rejected cross-user deletion changed the dataset revision.');
}
await db.exec('set role authenticated');

let sensitiveMutationRejected = false;
try {
  await db.query(
    'select * from public.apply_memory_mutations($1,$2::jsonb)',
    [1, JSON.stringify([{
      type: 'settings_update', entityId: 'settings',
      payload: { profileMetadata: { password: 'must-not-save' } },
    }])]
  );
} catch (error) {
  sensitiveMutationRejected = String(error).includes('sensitive authentication fields');
}
if (!sensitiveMutationRejected) throw new Error('Sensitive mutation metadata was not rejected.');
const revisionAfterSensitivePayload = await db.query(
  'select dataset_revision from public.memory_settings where user_id = $1',
  [userId]
);
if (Number(revisionAfterSensitivePayload.rows[0].dataset_revision) !== 1) {
  throw new Error('Rejected sensitive payload changed the dataset revision.');
}

let invalidRouteRejected = false;
try {
  await db.query(
    'select * from public.apply_memory_mutations($1,$2::jsonb)',
    [1, JSON.stringify([{
      type: 'track_upsert', entityId: 'invalid-route',
      payload: {
        id: 'invalid-route', sortOrder: 1,
        paths: [[[30, 120], [30.1, 120.1]]], durationSeconds: -1, distanceKm: -1,
      },
    }])]
  );
} catch (error) {
  invalidRouteRejected = String(error).includes('nonnegative');
}
if (!invalidRouteRejected) throw new Error('Invalid route values were not rejected.');

const deleted = await db.query(
  'select * from public.apply_memory_mutations($1,$2::jsonb)',
  [1, JSON.stringify([{ type: 'star_soft_delete', entityId: 'star-1' }])]
);
if (!deleted.rows[0].saved || Number(deleted.rows[0].dataset_revision) !== 2) {
  throw new Error('Star soft-delete batch failed.');
}
const softDeletedRows = await db.query(`
  select
    (select deleted_at is not null from public.memory_stars where user_id = $1 and id = 'star-1') as star_deleted,
    (select deleted_at is not null from public.memory_notes where user_id = $1 and star_id = 'star-1' and id = 'note-1') as note_deleted
`, [userId]);
if (!softDeletedRows.rows[0].star_deleted || !softDeletedRows.rows[0].note_deleted) {
  throw new Error('Star deletion did not soft-delete the star and child note.');
}
await db.exec('reset role');
const archivedAfter = await db.query('select state from public.app_states where user_id = $1', [userId]);
if (JSON.stringify(archivedBefore.rows[0].state) !== JSON.stringify(archivedAfter.rows[0].state)) {
  throw new Error('Entity mutation changed the app_states archive.');
}
await db.exec('set role authenticated');
const history = await db.query("select count(*) as count from public.memory_entity_history where entity_type = 'note'");
if (Number(history.rows[0].count) !== 2) throw new Error('Note update and soft-delete history were not recorded.');
let legacyRejected = false;
try {
  await db.query("select * from public.save_app_snapshot(0, '{}'::jsonb, '', '')");
} catch (error) {
  legacyRejected = String(error).includes('normalized memory storage v2');
}
if (!legacyRejected) throw new Error('Legacy snapshot write was not rejected.');
let legacyReadRejected = false;
try {
  await db.query('select * from public.load_app_snapshot()');
} catch (error) {
  legacyReadRejected = String(error).includes('normalized memory storage v2');
}
if (!legacyReadRejected) throw new Error('Legacy snapshot read was not rejected.');

let directArchiveWriteRejected = false;
try {
  await db.query("update public.app_states set state = '{}'::jsonb where user_id = $1", [userId]);
} catch {
  directArchiveWriteRejected = true;
}
if (!directArchiveWriteRejected) throw new Error('Direct app_states update remained writable.');

const invalidDb = new PGlite();
await bootstrap(invalidDb);
await invalidDb.query('insert into auth.users(id) values ($1)', [userId]);
await invalidDb.query('insert into public.profiles(id,account_id,name) values ($1,$2,$3)', [userId, 'owner', 'Owner']);
const invalidState = makeState();
invalidState.stars.push(structuredClone(invalidState.stars[0]));
await invalidDb.query('insert into public.app_states(user_id,state) values ($1,$2::jsonb)', [userId, JSON.stringify(invalidState)]);
let verificationFailed = false;
try {
  await invalidDb.exec(migration);
} catch (error) {
  verificationFailed = String(error).includes('verification failed');
  await invalidDb.exec('rollback');
}
if (!verificationFailed) throw new Error('Invalid migration was not rejected.');
const archiveStillThere = await invalidDb.query('select count(*) as count from public.app_states where user_id = $1', [userId]);
if (Number(archiveStillThere.rows[0].count) !== 1) throw new Error('Failed migration damaged the archive.');

const missingProfileDb = new PGlite();
await bootstrap(missingProfileDb);
await missingProfileDb.query('insert into auth.users(id) values ($1)', [userId]);
await missingProfileDb.query('insert into public.app_states(user_id,state) values ($1,$2::jsonb)', [
  userId,
  JSON.stringify(makeState()),
]);
let missingProfileRejected = false;
try {
  await missingProfileDb.exec(migration);
} catch (error) {
  missingProfileRejected = String(error).includes('profile row is missing');
  await missingProfileDb.exec('rollback');
}
if (!missingProfileRejected) throw new Error('Migration verified an account whose profile row was missing.');
const missingProfileArchive = await missingProfileDb.query(
  'select count(*) as count from public.app_states where user_id = $1',
  [userId]
);
if (Number(missingProfileArchive.rows[0].count) !== 1) {
  throw new Error('Missing-profile rollback damaged the archive.');
}

console.log(JSON.stringify({
  migrationExecuted: true,
  idempotent: true,
  checksumsVerified: true,
  rlsIsolated: true,
  mutationAtomic: true,
  staleBatchRejected: true,
  crossUserMutationRejected: true,
  softDeleteVerified: true,
  databaseSummaryVerified: true,
  sensitiveFieldsExcluded: true,
  invalidRouteRejected: true,
  historyRecorded: true,
  archiveUnchanged: true,
  archiveClientAccessRejected: true,
  legacyClientReadRejected: true,
  failureRolledBack: true,
  missingProfileRejected: true,
  legacyStorageReferenceProtected: true,
}, null, 2));
