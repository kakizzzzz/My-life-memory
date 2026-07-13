import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const normalizedMigration = await readFile(
  'supabase/migrations/20260713_normalized_memory_storage_v2.sql',
  'utf8'
);
const retentionMigration = await readFile(
  'supabase/migrations/20260714_memory_trash_retention.sql',
  'utf8'
);
const serverRetentionMigration = await readFile(
  'supabase/migrations/20260717_server_retention_and_archive_redaction.sql',
  'utf8'
);

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

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

const makeState = suffix => ({
  profile: {
    account: `owner${suffix}`,
    name: `Owner${suffix}`,
    password: `legacy-secret${suffix}`,
  },
  mapStyle: 'light',
  language: 'en',
  systemTheme: {},
  profileConflicts: [],
  stars: [{
    id: `active-star${suffix}`,
    lat: 31.2,
    lng: 121.4,
    createdAt: 10,
    notes: [{
      id: `active-note${suffix}`,
      title: 'Active',
      titleHtml: '<p>Active</p>',
      content: 'Active memory',
      contentHtml: '<p>Active memory</p>',
      imageUrls: [],
      images: [],
      createdAt: 11,
      updatedAt: 12,
    }],
  }],
  savedTracks: [{
    id: `active-track${suffix}`,
    paths: [[[31.2, 121.4], [31.21, 121.41]]],
    time: 18,
    distance: 0.4,
    createdAt: 13,
    updatedAt: 14,
  }],
});

const metadata = path => ({
  provider: 'supabase',
  bucket: 'life-media',
  key: path,
  path,
  mimeType: 'image/jpeg',
  size: 100,
  createdAt: 1,
});

const db = new PGlite();
await bootstrap(db);

for (const [id, account, state] of [
  [userId, 'owner', makeState('')],
  [otherUserId, 'other', makeState('-other')],
]) {
  await db.query('insert into auth.users(id) values ($1)', [id]);
  await db.query('insert into public.profiles(id,account_id,name) values ($1,$2,$3)', [id, account, account]);
  await db.query('insert into public.app_states(user_id,state) values ($1,$2::jsonb)', [id, JSON.stringify(state)]);
}

await db.exec(normalizedMigration);
await db.exec(retentionMigration);
await db.exec(retentionMigration);
await db.exec(serverRetentionMigration);
await db.exec(serverRetentionMigration);

const sanitizedArchives = await db.query(`
  select
    public.memory_json_has_sensitive_keys(state) as has_sensitive,
    state #>> '{stars,0,id}' as retained_star
  from public.app_states
  order by user_id
`);
assert(sanitizedArchives.rows.every(row => row.has_sensitive === false),
  'Server retention migration left a credential-like key in app_states.');
assert(sanitizedArchives.rows.every(row => String(row.retained_star).startsWith('active-star')),
  'Credential redaction removed non-sensitive legacy memory data.');

const activePath = `${userId}/notes/active-note/active.jpg`;
const expiredPath = `${userId}/notes/expired-note/expired.jpg`;
const recentDeletedPath = `${userId}/notes/recent-note/recent.jpg`;
const staleHistoryPath = `${userId}/notes/active-note/stale-history.jpg`;
const recentHistoryPath = `${userId}/notes/active-note/recent-history.jpg`;
const otherUserPath = `${otherUserId}/notes/active-note-other/other.jpg`;

await db.query(`
  update public.memory_notes
  set images = $1::jsonb,
      content_html = $2
  where user_id = $3 and star_id = 'active-star' and id = 'active-note'
`, [
  JSON.stringify([metadata(activePath)]),
  `<figure data-media-path="${activePath}"><img></figure>`,
  userId,
]);

await db.query(`
  insert into public.memory_stars (user_id,id,sort_order,lat,lng,changed_revision,deleted_at)
  values
    ($1,'note-host',1,31.2,121.4,1,null),
    ($1,'expired-star',2,31.2,121.4,1,now() - interval '8 days'),
    ($1,'blocked-star',3,31.2,121.4,1,now() - interval '8 days'),
    ($1,'recent-deleted-star',4,31.2,121.4,1,now() - interval '6 days')
`, [userId]);

const insertNote = async ({ starId, id, path, ageDays }) => {
  await db.query(`
    insert into public.memory_notes (
      user_id,star_id,id,sort_order,content,content_html,images,changed_revision,deleted_at
    ) values (
      $1,$2,$3,0,$3,$4,$5::jsonb,1,now() - ($6 * interval '1 day')
    )
  `, [
    userId,
    starId,
    id,
    `<figure data-media-path="${path}"><img></figure>`,
    JSON.stringify([metadata(path)]),
    ageDays,
  ]);
};

await insertNote({ starId: 'note-host', id: 'expired-note', path: expiredPath, ageDays: 8 });
await insertNote({ starId: 'note-host', id: 'recent-note', path: recentDeletedPath, ageDays: 6 });
await insertNote({
  starId: 'expired-star',
  id: 'expired-child',
  path: `${userId}/notes/expired-child/child.jpg`,
  ageDays: 8,
});
await insertNote({
  starId: 'blocked-star',
  id: 'recent-child',
  path: `${userId}/notes/recent-child/child.jpg`,
  ageDays: 6,
});

await db.query(`
  insert into public.memory_tracks (
    user_id,id,sort_order,paths,duration_seconds,distance_km,changed_revision,deleted_at
  ) values
    ($1,'expired-track',1,'[]'::jsonb,1,0.1,1,now() - interval '8 days'),
    ($1,'recent-track',2,'[]'::jsonb,1,0.1,1,now() - interval '6 days')
`, [userId]);

await db.query(`
  update public.memory_notes
  set images = $1::jsonb, deleted_at = now() - interval '8 days'
  where user_id = $2 and star_id = 'active-star-other' and id = 'active-note-other'
`, [JSON.stringify([metadata(otherUserPath)]), otherUserId]);
await db.query(`
  update public.memory_tracks
  set deleted_at = now() - interval '8 days'
  where user_id = $1 and id = 'active-track-other'
`, [otherUserId]);

const insertHistory = async ({ entityType, entityKey, operation = 'update', beforeData, ageDays }) => {
  await db.query(`
    insert into public.memory_entity_history (
      user_id,entity_type,entity_key,operation,before_data,dataset_revision,changed_at
    ) values ($1,$2,$3,$4,$5::jsonb,1,now() - ($6 * interval '1 day'))
  `, [userId, entityType, entityKey, operation, JSON.stringify(beforeData), ageDays]);
};

await insertHistory({
  entityType: 'note',
  entityKey: 'note-host/expired-note',
  operation: 'soft_delete',
  beforeData: { images: [metadata(expiredPath)] },
  ageDays: 1,
});
await insertHistory({
  entityType: 'note',
  entityKey: 'expired-star/expired-child',
  operation: 'soft_delete',
  beforeData: { content: 'expired child' },
  ageDays: 1,
});
await insertHistory({
  entityType: 'star',
  entityKey: 'expired-star',
  operation: 'soft_delete',
  beforeData: { id: 'expired-star' },
  ageDays: 1,
});
await insertHistory({
  entityType: 'track',
  entityKey: 'expired-track',
  operation: 'soft_delete',
  beforeData: { id: 'expired-track' },
  ageDays: 1,
});
await insertHistory({
  entityType: 'note',
  entityKey: 'active-star/active-note',
  beforeData: { images: [metadata(staleHistoryPath)] },
  ageDays: 8,
});
await insertHistory({
  entityType: 'note',
  entityKey: 'active-star/active-note',
  beforeData: { images: [metadata(recentHistoryPath)] },
  ageDays: 1,
});

await db.query(`
  insert into public.memory_entity_history (
    user_id,entity_type,entity_key,operation,before_data,dataset_revision,changed_at
  )
  select $1,'star','active-star','update',jsonb_build_object('version', version),1,
    now() - (version * interval '1 minute')
  from generate_series(1,25) version
`, [userId]);

const archiveBefore = await db.query(
  'select user_id, state::text as state from public.app_states order by user_id'
);

let unauthenticatedRejected = false;
try {
  await db.query('select public.purge_expired_memory_trash()');
} catch (error) {
  unauthenticatedRejected = String(error).includes('Authentication required');
}
assert(unauthenticatedRejected, 'Trash purge accepted an unauthenticated request.');

await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
await db.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
await db.exec('set role authenticated');

let systemPurgeRejected = false;
try {
  await db.query('select public.purge_expired_memory_trash_all_users()');
} catch (error) {
  systemPurgeRejected = /permission denied/i.test(String(error));
}
assert(systemPurgeRejected, 'Authenticated clients can execute the all-user retention task.');

const protectedBefore = new Set(
  (await db.query('select path from public.list_protected_memory_media_paths()')).rows.map(row => row.path)
);
assert(protectedBefore.has(expiredPath), 'Expired note fixture was not protected before database purge.');
assert(protectedBefore.has(staleHistoryPath), 'Expired history fixture was not protected before database purge.');

const purge = await db.query('select public.purge_expired_memory_trash() as result');
const purgeResult = purge.rows[0].result;
assert(Number(purgeResult.deletedNotes) === 2, `Expected two expired notes to purge: ${JSON.stringify(purgeResult)}`);
assert(Number(purgeResult.deletedTracks) === 1, `Expected one expired track to purge: ${JSON.stringify(purgeResult)}`);
assert(Number(purgeResult.deletedStars) === 1, `Expected one expired star to purge: ${JSON.stringify(purgeResult)}`);

const protectedAfter = new Set(
  (await db.query('select path from public.list_protected_memory_media_paths()')).rows.map(row => row.path)
);
assert(!protectedAfter.has(expiredPath), 'Purged note image remained protected.');
assert(!protectedAfter.has(staleHistoryPath), 'Expired history image remained protected.');
assert(protectedAfter.has(activePath), 'Active note image lost protection.');
assert(protectedAfter.has(recentDeletedPath), 'Recent soft-deleted note image lost protection early.');
assert(protectedAfter.has(recentHistoryPath), 'Recent history image lost protection early.');

const retained = await db.query(`
  select
    (select count(*) from public.memory_notes where id = 'expired-note') as expired_note,
    (select count(*) from public.memory_notes where id = 'recent-note') as recent_note,
    (select count(*) from public.memory_stars where id = 'expired-star') as expired_star,
    (select count(*) from public.memory_stars where id = 'blocked-star') as blocked_star,
    (select count(*) from public.memory_stars where id = 'recent-deleted-star') as recent_star,
    (select count(*) from public.memory_tracks where id = 'expired-track') as expired_track,
    (select count(*) from public.memory_tracks where id = 'recent-track') as recent_track,
    (select count(*) from public.memory_notes where id = 'active-note' and deleted_at is null) as active_note,
    (select count(*) from public.memory_stars where id = 'active-star' and deleted_at is null) as active_star,
    (select count(*) from public.memory_tracks where id = 'active-track' and deleted_at is null) as active_track
`);
const row = retained.rows[0];
assert(Number(row.expired_note) === 0 && Number(row.expired_star) === 0 && Number(row.expired_track) === 0,
  `Expired entities survived purge: ${JSON.stringify(row)}`);
assert(Number(row.recent_note) === 1 && Number(row.blocked_star) === 1
  && Number(row.recent_star) === 1 && Number(row.recent_track) === 1,
`Recent trash or a star with a retained child was removed: ${JSON.stringify(row)}`);
assert(Number(row.active_note) === 1 && Number(row.active_star) === 1 && Number(row.active_track) === 1,
  `Active entities changed during purge: ${JSON.stringify(row)}`);

const removedHistory = await db.query(`
  select count(*) as count
  from public.memory_entity_history
  where (entity_type = 'note' and entity_key in ('note-host/expired-note','expired-star/expired-child'))
    or (entity_type = 'star' and entity_key = 'expired-star')
    or (entity_type = 'track' and entity_key = 'expired-track')
`);
assert(Number(removedHistory.rows[0].count) === 0, 'History for physically purged entities survived.');

const versionCount = await db.query(`
  select count(*) as count
  from public.memory_entity_history
  where entity_type = 'star' and entity_key = 'active-star'
`);
assert(Number(versionCount.rows[0].count) === 20, 'Per-entity history cap no longer keeps exactly 20 versions.');

await db.exec('reset role');

const otherUserRows = await db.query(`
  select
    (select count(*) from public.memory_notes where user_id = $1 and id = 'active-note-other') as note_count,
    (select count(*) from public.memory_tracks where user_id = $1 and id = 'active-track-other') as track_count
`, [otherUserId]);
assert(Number(otherUserRows.rows[0].note_count) === 1 && Number(otherUserRows.rows[0].track_count) === 1,
  'One user purged another user\'s expired trash.');

const systemPurge = await db.query('select public.purge_expired_memory_trash_all_users() as result');
assert(Number(systemPurge.rows[0].result.processedUsers) >= 1,
  `System purge did not process the remaining user: ${JSON.stringify(systemPurge.rows[0].result)}`);
const otherUserAfterSystemPurge = await db.query(`
  select
    (select count(*) from public.memory_notes where user_id = $1 and id = 'active-note-other') as note_count,
    (select count(*) from public.memory_tracks where user_id = $1 and id = 'active-track-other') as track_count
`, [otherUserId]);
assert(Number(otherUserAfterSystemPurge.rows[0].note_count) === 0
  && Number(otherUserAfterSystemPurge.rows[0].track_count) === 0,
  'Owner-only system retention did not purge expired rows for an inactive account.');

const archiveAfter = await db.query(
  'select user_id, state::text as state from public.app_states order by user_id'
);
assert(JSON.stringify(archiveBefore.rows) === JSON.stringify(archiveAfter.rows), 'Trash purge changed app_states.');

await insertHistory({
  entityType: 'note',
  entityKey: 'active-star/active-note',
  beforeData: { images: [metadata(staleHistoryPath)] },
  ageDays: 8,
});
await db.query(
  "select public.record_memory_history($1,'note','active-star/active-note','update',$2::jsonb,1)",
  [userId, JSON.stringify({ content: 'new version' })]
);
const staleHistoryAfterWrite = await db.query(`
  select count(*) as count
  from public.memory_entity_history
  where user_id = $1 and before_data::text like $2
`, [userId, `%${staleHistoryPath}%`]);
assert(Number(staleHistoryAfterWrite.rows[0].count) === 0,
  'A normal history write did not enforce the seven-day history TTL.');

console.log(JSON.stringify({
  retentionMigrationExecuted: true,
  retentionMigrationIdempotent: true,
  serverRetentionMigrationIdempotent: true,
  scheduledPurgeFunctionVerified: true,
  systemPurgeDeniedToAuthenticated: true,
  legacyCredentialKeysRedacted: true,
  unauthenticatedRejected: true,
  recentTrashRetained: true,
  expiredTrashPurged: true,
  parentChildOrderSafe: true,
  historyReferencesPurged: true,
  protectedPathsReleased: true,
  activeRowsUnaffected: true,
  otherUserUnaffected: true,
  appStateArchiveUnchanged: true,
  sevenDayHistoryTtlVerified: true,
  twentyVersionCapVerified: true,
}, null, 2));
