import { createClient } from 'npm:@supabase/supabase-js@2';
import type {
  NormalizedMemoryRows,
  NoteRow,
  ProfileRow,
  SettingsRow,
  StarRow,
  TrackRow,
} from './memory-record-types.ts';
export type {
  NormalizedMemoryRows,
  NoteRow,
  ProfileRow,
  SettingsRow,
  StarRow,
  TrackRow,
} from './memory-record-types.ts';

export type SupabaseClientLike = ReturnType<typeof createClient<any>>;

export type MemoryMutationWire = {
  type: string;
  entityId: string;
  starId?: string;
  payload?: Record<string, unknown>;
};

export type NormalizedMemoryLoadOptions = {
  includeProfile?: boolean;
  includeStars?: boolean;
  includeNotes?: boolean;
  includeTracks?: boolean;
  starId?: string;
  noteIds?: string[];
  noteCreatedFromMs?: number;
  noteCreatedBeforeMs?: number;
  trackCreatedFromMs?: number;
  trackCreatedBeforeMs?: number;
};

const PAGE_SIZE = 500;

const loadAllPages = async <T>(buildQuery: () => any): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

export const loadNormalizedMemoryRows = async (
  client: SupabaseClientLike,
  userId: string,
  accountFallback = '',
  options: NormalizedMemoryLoadOptions = {},
): Promise<NormalizedMemoryRows> => {
  const includeProfile = options.includeProfile !== false;
  const includeStars = options.includeStars !== false;
  const includeNotes = options.includeNotes !== false;
  const includeTracks = options.includeTracks !== false;
  const loadSettings = () => client
    .from('memory_settings')
    .select('dataset_revision,data_model_version,migration_verified_at')
    .eq('user_id', userId)
    .maybeSingle<SettingsRow>();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settingsBeforeResult = await loadSettings();
    if (settingsBeforeResult.error) throw settingsBeforeResult.error;
    const settingsBefore = settingsBeforeResult.data;
    if (!settingsBefore || Number(settingsBefore.data_model_version) < 2 || !settingsBefore.migration_verified_at) {
      throw new Error('Normalized memory storage v2 is not migrated or verified.');
    }

    const [profileResult, stars, notes, tracks] = await Promise.all([
      includeProfile
        ? client.from('profiles').select('account_id,name,avatar_url').eq('id', userId).maybeSingle<ProfileRow>()
        : Promise.resolve({ data: null, error: null }),
      includeStars
        ? loadAllPages<StarRow>(() => {
            let query = client
              .from('memory_stars')
              .select('id,sort_order,lat,lng,created_at_ms,tag_order,tag_group_id,color')
              .eq('user_id', userId).is('deleted_at', null);
            if (options.starId) query = query.eq('id', options.starId);
            return query.order('sort_order', { ascending: true }).order('id', { ascending: true });
          })
        : Promise.resolve([]),
      includeNotes
        ? loadAllPages<NoteRow>(() => {
            let query = client
              .from('memory_notes')
              .select('star_id,id,sort_order,title,title_html,content,content_html,image_url,image_urls,images,font_size,title_font_size,color,created_at_ms,updated_at_ms')
              .eq('user_id', userId).is('deleted_at', null);
            if (options.starId) query = query.eq('star_id', options.starId);
            if (options.noteIds?.length) query = query.in('id', options.noteIds);
            const from = Number.isFinite(options.noteCreatedFromMs) ? options.noteCreatedFromMs : null;
            const before = Number.isFinite(options.noteCreatedBeforeMs) ? options.noteCreatedBeforeMs : null;
            if (from !== null && before !== null) {
              query = query.or(`created_at_ms.is.null,and(created_at_ms.gte.${from},created_at_ms.lt.${before})`);
            } else if (from !== null) {
              query = query.or(`created_at_ms.is.null,created_at_ms.gte.${from}`);
            } else if (before !== null) {
              query = query.or(`created_at_ms.is.null,created_at_ms.lt.${before}`);
            }
            return query.order('star_id', { ascending: true }).order('sort_order', { ascending: true }).order('id', { ascending: true });
          })
        : Promise.resolve([]),
      includeTracks
        ? loadAllPages<TrackRow>(() => {
            let query = client
              .from('memory_tracks')
              .select('id,sort_order,paths,color,duration_seconds,distance_km,created_at_ms,updated_at_ms')
              .eq('user_id', userId).is('deleted_at', null);
            if (Number.isFinite(options.trackCreatedFromMs)) {
              query = query.gte('created_at_ms', options.trackCreatedFromMs);
            }
            if (Number.isFinite(options.trackCreatedBeforeMs)) {
              query = query.lt('created_at_ms', options.trackCreatedBeforeMs);
            }
            return query.order('sort_order', { ascending: true }).order('id', { ascending: true });
          })
        : Promise.resolve([]),
    ]);
    if (profileResult.error) throw profileResult.error;
    const settingsAfterResult = await loadSettings();
    if (settingsAfterResult.error) throw settingsAfterResult.error;
    const settingsAfter = settingsAfterResult.data;
    const beforeRevision = Math.max(0, Number(settingsBefore.dataset_revision) || 0);
    const afterRevision = Math.max(0, Number(settingsAfter?.dataset_revision) || 0);
    if (!settingsAfter || beforeRevision !== afterRevision) continue;

    return {
      userId,
      account: profileResult.data?.account_id || accountFallback,
      profile: profileResult.data,
      revision: afterRevision,
      stars,
      notes,
      tracks,
    };
  }

  throw new Error('Memory changed repeatedly while loading. Please retry.');
};

export const applyAuthenticatedMemoryMutations = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  expectedRevision,
  mutations,
}: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  expectedRevision: number;
  mutations: MemoryMutationWire[];
}) => {
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await userClient.rpc('apply_memory_mutations', {
    p_expected_revision: Math.max(0, expectedRevision),
    p_mutations: mutations,
  });
  if (error) throw error;
  const result = (Array.isArray(data) ? data[0] : data) as {
    saved?: boolean;
    dataset_revision?: number;
    conflict?: Record<string, unknown> | null;
  } | null;
  if (!result?.saved) {
    const conflict = new Error('Memory data changed on another device. Reload before writing again.');
    Object.assign(conflict, {
      code: 'revision_conflict',
      status: 409,
      remoteRevision: Math.max(0, Number(result?.dataset_revision) || 0),
      details: result?.conflict || null,
    });
    throw conflict;
  }
  return { revision: Math.max(0, Number(result.dataset_revision) || expectedRevision + 1) };
};
