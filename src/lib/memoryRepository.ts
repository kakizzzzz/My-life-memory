import type { User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { CloudProfile } from './cloudBackend';
import {
  assembleNormalizedMemoryState,
  MAX_MEMORY_MUTATIONS_PER_COMMIT,
  validateMemoryMutations,
  type MemoryMutation,
  type MemoryNoteRow,
  type MemorySettingsRow,
  type MemoryStarRow,
  type MemoryTrackRow,
} from './normalizedMemory';

const PAGE_SIZE = 500;

type ProfileRow = {
  account_id: string;
  name: string | null;
  avatar_url: string | null;
};

export type NormalizedMemoryAccountData = {
  profile: CloudProfile;
  state: ReturnType<typeof assembleNormalizedMemoryState>;
  revision: number;
  dataModelVersion: number;
};

export type MemoryChangeSet = {
  settings: MemorySettingsRow | null;
  profile: CloudProfile | null;
  stars: MemoryStarRow[];
  notes: MemoryNoteRow[];
  tracks: MemoryTrackRow[];
};

export class NormalizedMemoryConflictError extends Error {
  remoteRevision: number;
  conflict: Record<string, unknown> | null;

  constructor(remoteRevision: number, conflict: Record<string, unknown> | null = null) {
    super('Normalized memory was changed by another device.');
    this.name = 'NormalizedMemoryConflictError';
    this.remoteRevision = remoteRevision;
    this.conflict = conflict;
  }
}

const requireSupabase = () => {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
};

const loadAllPages = async <T>({
  table,
  columns,
  configure,
}: {
  table: 'memory_stars' | 'memory_notes' | 'memory_tracks';
  columns: string;
  configure?: (query: any) => any;
}): Promise<T[]> => {
  const client = requireSupabase();
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select(columns);
    if (configure) query = configure(query);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
};

export const loadMemorySettings = async (): Promise<MemorySettingsRow> => {
  const client = requireSupabase();
  const { data, error } = await client
    .from('memory_settings')
    .select('user_id,map_style,system_theme,language,profile_conflicts,profile_metadata,dataset_revision,data_model_version,migration_verified_at')
    .maybeSingle<MemorySettingsRow>();
  if (error) throw error;
  if (!data || Number(data.data_model_version) < 2 || !data.migration_verified_at) {
    throw new Error('Normalized memory storage v2 is not migrated or verified.');
  }
  return data;
};

export const loadMemoryStars = (includeDeleted = false) => loadAllPages<MemoryStarRow>({
  table: 'memory_stars',
  columns: 'user_id,id,sort_order,lat,lng,created_at_ms,tag_order,tag_group_id,color,changed_revision,deleted_at',
  configure: query => {
    const ordered = query.order('sort_order', { ascending: true }).order('id', { ascending: true });
    return includeDeleted ? ordered : ordered.is('deleted_at', null);
  },
});

export const loadMemoryNotes = (includeDeleted = false) => loadAllPages<MemoryNoteRow>({
  table: 'memory_notes',
  columns: 'user_id,star_id,id,sort_order,title,title_html,content,content_html,image_url,image_urls,images,font_size,title_font_size,color,created_at_ms,updated_at_ms,changed_revision,deleted_at',
  configure: query => {
    const ordered = query.order('star_id', { ascending: true }).order('sort_order', { ascending: true }).order('id', { ascending: true });
    return includeDeleted ? ordered : ordered.is('deleted_at', null);
  },
});

export const loadMemoryTracks = (includeDeleted = false) => loadAllPages<MemoryTrackRow>({
  table: 'memory_tracks',
  columns: 'user_id,id,sort_order,paths,color,duration_seconds,distance_km,created_at_ms,updated_at_ms,changed_revision,deleted_at',
  configure: query => {
    const ordered = query.order('sort_order', { ascending: true }).order('id', { ascending: true });
    return includeDeleted ? ordered : ordered.is('deleted_at', null);
  },
});

export const loadNormalizedMemoryAccountData = async (user: User): Promise<NormalizedMemoryAccountData> => {
  const client = requireSupabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settingsBefore = await loadMemorySettings();
    const profilePromise = client
      .from('profiles')
      .select('account_id,name,avatar_url')
      .eq('id', user.id)
      .single<ProfileRow>();
    const [profileResult, stars, notes, tracks] = await Promise.all([
      profilePromise,
      loadMemoryStars(),
      loadMemoryNotes(),
      loadMemoryTracks(),
    ]);
    if (profileResult.error) throw profileResult.error;
    const settingsAfter = await loadMemorySettings();
    const revisionBefore = Math.max(0, Number(settingsBefore.dataset_revision) || 0);
    const revisionAfter = Math.max(0, Number(settingsAfter.dataset_revision) || 0);
    if (revisionBefore !== revisionAfter) continue;
    const profile: CloudProfile = {
      account: profileResult.data.account_id,
      name: profileResult.data.name || '',
      avatarUrl: profileResult.data.avatar_url || '',
    };
    return {
      profile,
      state: assembleNormalizedMemoryState({ profile, settings: settingsAfter, stars, notes, tracks }),
      revision: revisionAfter,
      dataModelVersion: Math.max(2, Number(settingsAfter.data_model_version) || 2),
    };
  }
  throw new Error('Memory changed repeatedly while loading. Please retry.');
};

export const loadMemoryChangesSince = async (revision: number): Promise<MemoryChangeSet> => {
  const client = requireSupabase();
  const minimumRevision = Math.max(0, revision);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settingsBefore = await loadMemorySettings();
    const revisionBefore = Math.max(0, Number(settingsBefore.dataset_revision) || 0);
    if (revisionBefore <= minimumRevision) {
      return { settings: null, profile: null, stars: [], notes: [], tracks: [] };
    }
    const [profileResult, stars, notes, tracks] = await Promise.all([
      client
        .from('profiles')
        .select('account_id,name,avatar_url')
        .maybeSingle<ProfileRow>(),
      loadAllPages<MemoryStarRow>({
        table: 'memory_stars',
        columns: 'user_id,id,sort_order,lat,lng,created_at_ms,tag_order,tag_group_id,color,changed_revision,deleted_at',
        configure: query => query.gt('changed_revision', minimumRevision).order('changed_revision').order('id'),
      }),
      loadAllPages<MemoryNoteRow>({
        table: 'memory_notes',
        columns: 'user_id,star_id,id,sort_order,title,title_html,content,content_html,image_url,image_urls,images,font_size,title_font_size,color,created_at_ms,updated_at_ms,changed_revision,deleted_at',
        configure: query => query.gt('changed_revision', minimumRevision).order('changed_revision').order('star_id').order('id'),
      }),
      loadAllPages<MemoryTrackRow>({
        table: 'memory_tracks',
        columns: 'user_id,id,sort_order,paths,color,duration_seconds,distance_km,created_at_ms,updated_at_ms,changed_revision,deleted_at',
        configure: query => query.gt('changed_revision', minimumRevision).order('changed_revision').order('id'),
      }),
    ]);
    if (profileResult.error) throw profileResult.error;
    const settingsAfter = await loadMemorySettings();
    const revisionAfter = Math.max(0, Number(settingsAfter.dataset_revision) || 0);
    if (revisionBefore !== revisionAfter) continue;
    return {
      settings: settingsAfter,
      profile: profileResult.data ? {
        account: profileResult.data.account_id,
        name: profileResult.data.name || '',
        avatarUrl: profileResult.data.avatar_url || '',
      } : null,
      stars,
      notes,
      tracks,
    };
  }
  throw new Error('Memory changed repeatedly while loading incremental changes. Please retry.');
};

export const loadProtectedMemoryMediaPaths = async (
  clientOverride?: NonNullable<typeof supabase>,
) => {
  const client = clientOverride || requireSupabase();
  const { data, error } = await client.rpc('list_protected_memory_media_paths');
  if (error) throw error;
  return ((data || []) as Array<{ path?: unknown } | string>)
    .map(value => typeof value === 'string' ? value : typeof value.path === 'string' ? value.path : '')
    .filter(Boolean);
};

export type MemoryTrashPurgeResult = {
  cutoff?: string;
  deletedNotes: number;
  deletedTracks: number;
  deletedStars: number;
  deletedHistory: number;
};

export const purgeExpiredMemoryTrash = async (
  clientOverride?: NonNullable<typeof supabase>,
): Promise<MemoryTrashPurgeResult> => {
  const client = clientOverride || requireSupabase();
  const { data, error } = await client.rpc('purge_expired_memory_trash');
  if (error) throw error;
  const result = (data || {}) as Partial<MemoryTrashPurgeResult>;
  return {
    cutoff: typeof result.cutoff === 'string' ? result.cutoff : undefined,
    deletedNotes: Math.max(0, Number(result.deletedNotes) || 0),
    deletedTracks: Math.max(0, Number(result.deletedTracks) || 0),
    deletedStars: Math.max(0, Number(result.deletedStars) || 0),
    deletedHistory: Math.max(0, Number(result.deletedHistory) || 0),
  };
};

export const applyMemoryMutations = async (
  expectedRevision: number,
  mutations: MemoryMutation[]
) => {
  const client = requireSupabase();
  if (mutations.length === 0) return { revision: expectedRevision };
  if (mutations.length > MAX_MEMORY_MUTATIONS_PER_COMMIT) {
    throw new Error(`A server commit cannot exceed ${MAX_MEMORY_MUTATIONS_PER_COMMIT} entity changes.`);
  }
  validateMemoryMutations(mutations);
  const wireMutations = mutations.map(item => ({
    type: item.type,
    entityId: item.entityId,
    starId: item.starId,
    payload: item.payload,
  }));
  const { data, error } = await client.rpc('apply_memory_mutations', {
    p_expected_revision: Math.max(0, expectedRevision),
    p_mutations: wireMutations,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    saved?: boolean;
    dataset_revision?: number;
    conflict?: Record<string, unknown> | null;
  } | null;
  const revision = Math.max(0, Number(row?.dataset_revision) || expectedRevision);
  if (!row?.saved) throw new NormalizedMemoryConflictError(revision, row?.conflict || null);
  return { revision };
};
