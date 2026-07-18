import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getLocalTimeZone,
  normalizeTimeZone as normalizeBrowserTimeZone,
  validTimeZoneOrNull as validBrowserTimeZoneOrNull,
} from '../src/lib/timeZone';
import {
  buildMemoryTemporalContext,
  normalizeTimeZone as normalizeEdgeTimeZone,
  validTimeZoneOrNull as validEdgeTimeZoneOrNull,
} from '../supabase/functions/_shared/time-zone';
import { isInDateRange } from '../supabase/functions/_shared/memory-date';
import {
  assembleNormalizedMemoryState,
  diffMemoryState,
} from '../src/lib/normalizedMemory';
import type { PersistedAppState } from '../src/types/app';

const profile = { account: 'owner', name: 'Owner', avatarUrl: '' };

test('browser and Edge helpers accept IANA zones and use UTC for invalid input', () => {
  for (const normalize of [normalizeBrowserTimeZone, normalizeEdgeTimeZone]) {
    assert.equal(normalize('Asia/Tokyo'), 'Asia/Tokyo');
    assert.equal(normalize('Europe/Paris'), 'Europe/Paris');
    assert.equal(normalize('not/a-time-zone'), 'UTC');
    assert.equal(normalize(''), 'UTC');
  }
  assert.equal(validBrowserTimeZoneOrNull('not/a-time-zone'), null);
  assert.equal(validEdgeTimeZoneOrNull('not/a-time-zone'), null);
  assert.ok(validBrowserTimeZoneOrNull(getLocalTimeZone()));
});

test('settings mutations persist the local time zone in profile metadata', () => {
  const baseState: PersistedAppState = {
    mapStyle: 'light',
    language: 'en',
    timeZone: 'UTC',
    profile: { account: 'owner', name: 'Owner', avatarUrl: '' },
    stars: [],
    savedTracks: [],
  };
  const nextState = { ...baseState, timeZone: 'America/New_York' };
  const mutations = diffMemoryState({
    baseState,
    nextState,
    baseProfile: profile,
    nextProfile: profile,
  });

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].type, 'settings_update');
  assert.equal(
    (mutations[0].payload?.profileMetadata as Record<string, unknown>).timeZone,
    'America/New_York',
  );
});

test('normalized settings restore the saved user time zone and safely default old accounts', () => {
  const shared = {
    profile,
    stars: [],
    notes: [],
    tracks: [],
  };
  const settings = {
    user_id: 'user-1',
    map_style: 'light' as const,
    system_theme: {},
    language: 'en',
    profile_conflicts: [],
    dataset_revision: 1,
    data_model_version: 2,
    migration_verified_at: '2026-07-17T00:00:00Z',
  };

  const restored = assembleNormalizedMemoryState({
    ...shared,
    settings: { ...settings, profile_metadata: { timeZone: 'Pacific/Auckland' } },
  });
  const legacy = assembleNormalizedMemoryState({
    ...shared,
    settings: { ...settings, profile_metadata: {} },
  });

  assert.equal(restored.timeZone, 'Pacific/Auckland');
  assert.equal(legacy.timeZone, 'UTC');
});

test('runtime services resolve account time zones instead of defaulting to Shanghai', () => {
  const memoryApi = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
  const cloudMcp = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
  const localMcp = readFileSync(new URL('../mcp/memory-server.mjs', import.meta.url), 'utf8');
  const registration = readFileSync(new URL('../supabase/functions/register-with-invite/index.ts', import.meta.url), 'utf8');

  assert.match(memoryApi, /from\('memory_settings'\)[\s\S]*select\('profile_metadata'\)/);
  assert.match(memoryApi, /validTimeZoneOrNull\(body\.timeZone\)/);
  assert.doesNotMatch(memoryApi, /Asia\/Shanghai/);
  assert.doesNotMatch(cloudMcp, /MLM_TIME_ZONE|Asia\/Shanghai/);
  assert.doesNotMatch(localMcp, /MLM_TIME_ZONE|Asia\/Shanghai/);
  assert.match(registration, /profileMetadata:\s*\{\s*timeZone: normalizeTimeZone\(initialState\.timeZone\)/);
});

test('temporal context reports one UTC instant in the authenticated account time zone', () => {
  const now = new Date('2026-01-01T00:30:00.000Z');
  const tokyo = buildMemoryTemporalContext('Asia/Tokyo', now);
  const newYork = buildMemoryTemporalContext('America/New_York', now);

  assert.equal(tokyo.currentUtcDateTime, '2026-01-01T00:30:00.000Z');
  assert.equal(tokyo.currentLocalDate, '2026-01-01');
  assert.equal(tokyo.currentLocalDateTime, '2026-01-01T09:30:00');
  assert.equal(newYork.currentLocalDate, '2025-12-31');
  assert.equal(newYork.currentLocalDateTime, '2025-12-31T19:30:00');
});

test('the same memory falls on different requested days in different IANA time zones', () => {
  const instant = Date.parse('2026-01-01T00:30:00.000Z');

  assert.equal(isInDateRange(instant, '2026-01-01', '2026-01-01', 'Asia/Tokyo'), true);
  assert.equal(isInDateRange(instant, '2026-01-01', '2026-01-01', 'America/New_York'), false);
  assert.equal(isInDateRange(instant, '2025-12-31', '2025-12-31', 'America/New_York'), true);
});
