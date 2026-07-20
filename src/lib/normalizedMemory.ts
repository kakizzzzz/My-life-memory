import type {
  MapStyle,
  NoteData,
  PersistedAppState,
  ProfileConflictData,
  StarData,
  SystemTheme,
  TrackData,
} from '../types/app';
import type { StoredImageMetadata } from './mediaStorage';
import type { CloudProfile } from './cloudBackend';
import { createClientId } from './generalUtils';
import { normalizeTimeZone } from './timeZone';

export const NORMALIZED_MEMORY_MODEL_VERSION = 2;

export type MemoryMutationType =
  | 'settings_update'
  | 'profile_update'
  | 'star_upsert'
  | 'star_soft_delete'
  | 'note_upsert'
  | 'note_soft_delete'
  | 'track_upsert'
  | 'track_soft_delete';

export type MemoryMutation = {
  mutationId: string;
  type: MemoryMutationType;
  entityId: string;
  starId?: string;
  payload?: Record<string, unknown>;
  base?: Record<string, unknown> | null;
  createdAt: number;
};

export type MemorySettingsRow = {
  user_id: string;
  map_style: MapStyle;
  system_theme: Partial<SystemTheme> | null;
  language: string;
  profile_conflicts: ProfileConflictData[] | null;
  profile_metadata: { avatarImage?: StoredImageMetadata; timeZone?: string } | null;
  dataset_revision: number | null;
  data_model_version: number | null;
  migration_verified_at: string | null;
};

export type MemoryStarRow = {
  user_id: string;
  id: string;
  sort_order: number;
  lat: number;
  lng: number;
  created_at_ms: number | null;
  tag_order: number | null;
  tag_group_id: number | null;
  color: string | null;
  changed_revision: number;
  deleted_at: string | null;
};

export type MemoryNoteRow = {
  user_id: string;
  star_id: string;
  id: string;
  sort_order: number;
  title: string;
  title_html: string;
  content: string;
  content_html: string;
  image_url: string | null;
  image_urls: string[] | null;
  images: NoteData['images'] | null;
  font_size: number | null;
  title_font_size: number | null;
  color: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  changed_revision: number;
  deleted_at: string | null;
};

export type MemoryTrackRow = {
  user_id: string;
  id: string;
  sort_order: number;
  paths: [number, number][][];
  color: string | null;
  duration_seconds: number;
  distance_km: number;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  changed_revision: number;
  deleted_at: string | null;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
};

export const memoryValuesEqual = (left: unknown, right: unknown) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const mutation = (
  type: MemoryMutationType,
  entityId: string,
  payload?: Record<string, unknown>,
  base?: Record<string, unknown> | null,
  starId?: string
): MemoryMutation => ({
  mutationId: createClientId(),
  type,
  entityId,
  starId,
  payload,
  base,
  createdAt: Date.now(),
});

export const starPayload = (star: StarData, sortOrder: number) => ({
  id: star.id,
  sortOrder,
  lat: star.lat,
  lng: star.lng,
  createdAt: star.createdAt ?? null,
  tagOrder: star.tagOrder ?? null,
  tagGroupId: star.tagGroupId ?? null,
  color: star.color ?? null,
});

export const notePayload = (note: NoteData, sortOrder: number, starId: string) => ({
  id: note.id,
  starId,
  sortOrder,
  title: note.title || '',
  titleHtml: note.titleHtml || '',
  content: note.content || '',
  contentHtml: note.contentHtml || '',
  imageUrl: note.imageUrl ?? null,
  imageUrls: note.imageUrls || [],
  images: note.images || [],
  fontSize: note.fontSize ?? null,
  titleFontSize: note.titleFontSize ?? null,
  color: note.color ?? null,
  createdAt: note.createdAt ?? null,
  updatedAt: note.updatedAt ?? null,
});

export const trackPayload = (track: TrackData, sortOrder: number) => ({
  id: track.id,
  sortOrder,
  paths: track.paths,
  color: track.color ?? null,
  durationSeconds: track.time ?? 0,
  distanceKm: track.distance ?? 0,
  createdAt: track.createdAt ?? null,
  updatedAt: track.updatedAt ?? null,
});

const settingsPayload = (state: PersistedAppState) => ({
  mapStyle: state.mapStyle || 'light',
  systemTheme: state.systemTheme || {},
  language: state.language || 'en',
  profileConflicts: state.profileConflicts || [],
  profileMetadata: {
    ...(state.profile?.avatarImage ? { avatarImage: state.profile.avatarImage } : {}),
    timeZone: normalizeTimeZone(state.timeZone),
  },
});

const profilePayload = (profile: CloudProfile) => ({
  name: profile.name || '',
  avatarUrl: profile.avatarUrl || '',
});

const starCoreById = (stars: StarData[] = []) => new Map(
  stars.map((star, index) => [star.id, starPayload(star, index)])
);

const noteByKey = (stars: StarData[] = []) => {
  const notes = new Map<string, { starId: string; payload: ReturnType<typeof notePayload> }>();
  stars.forEach(star => {
    (star.notes || []).forEach((note, index) => {
      notes.set(`${star.id}/${note.id}`, { starId: star.id, payload: notePayload(note, index, star.id) });
    });
  });
  return notes;
};

const trackById = (tracks: TrackData[] = []) => new Map(
  tracks.map((track, index) => [track.id, trackPayload(track, index)])
);

export const diffMemoryState = ({
  baseState,
  nextState,
  baseProfile,
  nextProfile,
}: {
  baseState: PersistedAppState;
  nextState: PersistedAppState;
  baseProfile: CloudProfile;
  nextProfile: CloudProfile;
}): MemoryMutation[] => {
  const mutations: MemoryMutation[] = [];
  const baseSettings = settingsPayload(baseState);
  const nextSettings = settingsPayload(nextState);
  if (!memoryValuesEqual(baseSettings, nextSettings)) {
    mutations.push(mutation('settings_update', 'settings', nextSettings, baseSettings));
  }

  const oldProfile = profilePayload(baseProfile);
  const newProfile = profilePayload(nextProfile);
  if (!memoryValuesEqual(oldProfile, newProfile)) {
    mutations.push(mutation('profile_update', 'profile', newProfile, oldProfile));
  }

  const oldStars = starCoreById(baseState.stars);
  const newStars = starCoreById(nextState.stars);
  newStars.forEach((payload, id) => {
    const base = oldStars.get(id);
    if (!base || !memoryValuesEqual(base, payload)) {
      mutations.push(mutation('star_upsert', id, payload, base || null));
    }
  });
  oldStars.forEach((base, id) => {
    if (!newStars.has(id)) mutations.push(mutation('star_soft_delete', id, undefined, base));
  });

  const oldNotes = noteByKey(baseState.stars);
  const newNotes = noteByKey(nextState.stars);
  newNotes.forEach((entry, key) => {
    const base = oldNotes.get(key);
    if (!base || !memoryValuesEqual(base.payload, entry.payload)) {
      mutations.push(mutation('note_upsert', entry.payload.id, entry.payload, base?.payload || null, entry.starId));
    }
  });
  oldNotes.forEach((entry, key) => {
    if (!newNotes.has(key) && newStars.has(entry.starId)) {
      mutations.push(mutation('note_soft_delete', entry.payload.id, undefined, entry.payload, entry.starId));
    }
  });

  const oldTracks = trackById(baseState.savedTracks);
  const newTracks = trackById(nextState.savedTracks);
  newTracks.forEach((payload, id) => {
    const base = oldTracks.get(id);
    if (!base || !memoryValuesEqual(base, payload)) {
      mutations.push(mutation('track_upsert', id, payload, base || null));
    }
  });
  oldTracks.forEach((base, id) => {
    if (!newTracks.has(id)) mutations.push(mutation('track_soft_delete', id, undefined, base));
  });

  return mutations;
};

export const memoryMutationKey = (item: MemoryMutation) => {
  if (item.type === 'settings_update' || item.type === 'profile_update') return item.type;
  if (item.type.startsWith('note_')) return `note:${item.starId || ''}:${item.entityId}`;
  if (item.type.startsWith('star_')) return `star:${item.entityId}`;
  return `track:${item.entityId}`;
};

export const compactMemoryMutations = (items: MemoryMutation[]) => {
  const compacted = new Map<string, MemoryMutation>();
  items.forEach(item => {
    const key = memoryMutationKey(item);
    const previous = compacted.get(key);
    compacted.set(key, {
      ...item,
      base: previous ? previous.base : item.base,
    });
  });
  return [...compacted.values()]
    .filter(item => {
      if (item.type.endsWith('soft_delete')) return item.base !== null;
      return item.base === undefined || !memoryValuesEqual(item.payload || null, item.base);
    })
    .sort((left, right) => left.createdAt - right.createdAt);
};

export const MAX_MEMORY_MUTATIONS_PER_COMMIT = 500;
const MAX_ENTITY_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = 40_000;
const MAX_HTML_LENGTH = 240_000;
const MAX_IMAGES_PER_NOTE = 1_000;
const MAX_ROUTE_SEGMENTS = 200;
const MAX_ROUTE_POINTS = 20_000;

const MEMORY_MUTATION_TYPES = new Set<MemoryMutationType>([
  'settings_update',
  'profile_update',
  'star_upsert',
  'star_soft_delete',
  'note_upsert',
  'note_soft_delete',
  'track_upsert',
  'track_soft_delete',
]);

export class MemoryMutationValidationError extends Error {
  mutationType: string;
  mutationKey: string;

  constructor(message: string, item: MemoryMutation) {
    super(message);
    this.name = 'MemoryMutationValidationError';
    this.mutationType = String(item?.type || 'unknown');
    this.mutationKey = item && typeof item === 'object' ? memoryMutationKey(item) : 'unknown';
  }
}

export type InvalidMemoryMutation = {
  mutation: MemoryMutation;
  message: string;
};

const rejectMemoryMutation = (item: MemoryMutation, message: string): never => {
  throw new MemoryMutationValidationError(message, item);
};

const isValidCoordinate = (value: unknown, minimum: number, maximum: number) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= minimum
  && value <= maximum
);

export const validateMemoryMutation = (item: MemoryMutation) => {
  if (!item || typeof item !== 'object' || !MEMORY_MUTATION_TYPES.has(item.type)) {
    rejectMemoryMutation(item, 'A memory change has an unsupported type.');
  }
  if (!item.mutationId || item.mutationId.length > MAX_ENTITY_ID_LENGTH) {
    rejectMemoryMutation(item, 'A memory change has an invalid mutation ID.');
  }
  if (!item.entityId || item.entityId.length > MAX_ENTITY_ID_LENGTH) {
    rejectMemoryMutation(item, 'A memory change has an invalid entity ID.');
  }
  if (item.starId && item.starId.length > MAX_ENTITY_ID_LENGTH) {
    rejectMemoryMutation(item, 'A memory change has an invalid star ID.');
  }

  const payload = item.payload || {};
  if (item.type.endsWith('_upsert') || item.type === 'settings_update' || item.type === 'profile_update') {
    if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) {
      rejectMemoryMutation(item, 'A memory change is missing its saved data.');
    }
  }

  if (item.type === 'star_upsert') {
    if (!isValidCoordinate(payload.lat, -90, 90) || !isValidCoordinate(payload.lng, -180, 180)) {
      rejectMemoryMutation(item, 'A star has invalid coordinates.');
    }
  }

  if (item.type === 'note_upsert') {
    if (!item.starId) rejectMemoryMutation(item, 'A note is missing its parent star ID.');
    if (String(payload.title || '').length > MAX_TEXT_LENGTH || String(payload.content || '').length > MAX_TEXT_LENGTH) {
      rejectMemoryMutation(item, 'A note is too large to save safely.');
    }
    if (String(payload.titleHtml || '').length > MAX_HTML_LENGTH || String(payload.contentHtml || '').length > MAX_HTML_LENGTH) {
      rejectMemoryMutation(item, 'A formatted note is too large to save safely.');
    }
    if ((Array.isArray(payload.imageUrls) && payload.imageUrls.length > MAX_IMAGES_PER_NOTE)
      || (Array.isArray(payload.images) && payload.images.length > MAX_IMAGES_PER_NOTE)) {
      rejectMemoryMutation(item, 'A note contains too many images to save safely.');
    }
    if (String(payload.imageUrl || '').length > 2_000_000
      || (Array.isArray(payload.imageUrls)
        && payload.imageUrls.some(value => String(value || '').length > 2_000_000))) {
      rejectMemoryMutation(item, 'A legacy note image is too large to save safely.');
    }
  }

  if (item.type === 'track_upsert') {
    const duration = Number(payload.durationSeconds);
    const distance = Number(payload.distanceKm);
    if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(distance) || distance < 0) {
      rejectMemoryMutation(item, 'A route has an invalid duration or distance.');
    }
    const paths = payload.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_ROUTE_SEGMENTS) {
      rejectMemoryMutation(item, 'A route has an invalid number of segments.');
    }
    let pointCount = 0;
    for (const segment of paths as unknown[]) {
      if (!Array.isArray(segment)) {
        rejectMemoryMutation(item, 'A route contains an invalid segment.');
      }
      const points = segment as unknown[];
      if (points.length < 2) {
        rejectMemoryMutation(item, 'A route contains an empty or incomplete segment.');
      }
      pointCount += points.length;
      if (pointCount > MAX_ROUTE_POINTS) {
        rejectMemoryMutation(item, 'A route contains too many points to save safely.');
      }
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2
          || !isValidCoordinate(point[0], -90, 90)
          || !isValidCoordinate(point[1], -180, 180)) {
          rejectMemoryMutation(item, 'A route contains an invalid coordinate point.');
        }
      }
    }
  }
};

export const partitionMemoryMutationsForSync = (items: MemoryMutation[]) => {
  const valid: MemoryMutation[] = [];
  const invalid: InvalidMemoryMutation[] = [];

  items.forEach(item => {
    try {
      validateMemoryMutation(item);
      valid.push(item);
    } catch (error) {
      invalid.push({
        mutation: item,
        message: error instanceof Error ? error.message : 'A memory change is invalid.',
      });
    }
  });

  const invalidStarIds = new Set(
    invalid
      .filter(issue => issue.mutation.type.startsWith('star_'))
      .map(issue => issue.mutation.entityId)
  );
  if (invalidStarIds.size > 0) {
    for (let index = valid.length - 1; index >= 0; index -= 1) {
      const item = valid[index];
      if (item.type.startsWith('note_') && item.starId && invalidStarIds.has(item.starId)) {
        valid.splice(index, 1);
        invalid.push({
          mutation: item,
          message: 'A note is waiting for its parent star to become valid.',
        });
      }
    }
  }

  return { valid, invalid };
};

export const validateMemoryMutations = (items: MemoryMutation[]) => {
  items.forEach(validateMemoryMutation);
};

const noteFromPayload = (payload: Record<string, unknown>): NoteData => ({
  id: String(payload.id || ''),
  title: String(payload.title || ''),
  titleHtml: String(payload.titleHtml || ''),
  content: String(payload.content || ''),
  contentHtml: String(payload.contentHtml || ''),
  imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
  imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls as string[] : [],
  images: Array.isArray(payload.images) ? payload.images as NoteData['images'] : [],
  fontSize: typeof payload.fontSize === 'number' ? payload.fontSize : undefined,
  titleFontSize: typeof payload.titleFontSize === 'number' ? payload.titleFontSize : undefined,
  color: typeof payload.color === 'string' ? payload.color : undefined,
  createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : undefined,
  updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : undefined,
});

const trackFromPayload = (payload: Record<string, unknown>): TrackData => ({
  id: String(payload.id || ''),
  paths: Array.isArray(payload.paths) ? payload.paths as [number, number][][] : [],
  color: typeof payload.color === 'string' ? payload.color : undefined,
  time: Math.max(0, Number(payload.durationSeconds) || 0),
  distance: Math.max(0, Number(payload.distanceKm) || 0),
  createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : undefined,
  updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : undefined,
});

export const applyMemoryMutationsToSnapshot = ({
  state,
  profile,
  mutations,
}: {
  state: PersistedAppState;
  profile: CloudProfile;
  mutations: MemoryMutation[];
}) => {
  let nextState: PersistedAppState = {
    ...state,
    profile: { ...(state.profile || {}) },
    stars: (state.stars || []).map(star => ({ ...star, notes: [...(star.notes || [])] })),
    savedTracks: [...(state.savedTracks || [])],
  };
  let nextProfile = { ...profile };

  mutations.forEach(item => {
    const payload = item.payload || {};
    if (item.type === 'settings_update') {
      const profileMetadata = payload.profileMetadata && typeof payload.profileMetadata === 'object'
        ? payload.profileMetadata as Record<string, unknown>
        : {};
      nextState = {
        ...nextState,
        mapStyle: (payload.mapStyle as MapStyle | undefined) || nextState.mapStyle,
        systemTheme: (payload.systemTheme as Partial<SystemTheme> | undefined) || nextState.systemTheme,
        language: typeof payload.language === 'string' ? payload.language : nextState.language,
        timeZone: normalizeTimeZone(profileMetadata.timeZone, nextState.timeZone),
        profileConflicts: Array.isArray(payload.profileConflicts)
          ? payload.profileConflicts as ProfileConflictData[]
          : nextState.profileConflicts,
        profile: {
          ...(nextState.profile || {}),
          ...(profileMetadata.avatarImage && typeof profileMetadata.avatarImage === 'object'
            ? { avatarImage: profileMetadata.avatarImage as StoredImageMetadata }
            : {}),
        },
      };
      return;
    }
    if (item.type === 'profile_update') {
      nextProfile = {
        ...nextProfile,
        name: typeof payload.name === 'string' ? payload.name : nextProfile.name,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : nextProfile.avatarUrl,
      };
      nextState.profile = { ...(nextState.profile || {}), name: nextProfile.name, avatarUrl: nextProfile.avatarUrl };
      return;
    }
    if (item.type === 'star_upsert') {
      const stars = [...(nextState.stars || [])];
      const index = stars.findIndex(star => star.id === item.entityId);
      const existing = index >= 0 ? stars[index] : undefined;
      const star: StarData = {
        id: item.entityId,
        lat: Number(payload.lat),
        lng: Number(payload.lng),
        createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : undefined,
        tagOrder: typeof payload.tagOrder === 'number' ? payload.tagOrder : undefined,
        tagGroupId: typeof payload.tagGroupId === 'number' ? payload.tagGroupId : undefined,
        color: typeof payload.color === 'string' ? payload.color : undefined,
        notes: existing?.notes || [],
      };
      if (index >= 0) stars.splice(index, 1);
      const requestedOrder = Math.max(0, Number(payload.sortOrder) || 0);
      stars.splice(Math.min(requestedOrder, stars.length), 0, star);
      nextState.stars = stars;
      return;
    }
    if (item.type === 'star_soft_delete') {
      nextState.stars = (nextState.stars || []).filter(star => star.id !== item.entityId);
      return;
    }
    if (item.type === 'note_upsert') {
      nextState.stars = (nextState.stars || []).map(star => {
        if (star.id !== item.starId) return star;
        const notes = [...(star.notes || [])];
        const index = notes.findIndex(note => note.id === item.entityId);
        const note = noteFromPayload(payload);
        if (index >= 0) notes.splice(index, 1);
        const requestedOrder = Math.max(0, Number(payload.sortOrder) || 0);
        notes.splice(Math.min(requestedOrder, notes.length), 0, note);
        return { ...star, notes };
      });
      return;
    }
    if (item.type === 'note_soft_delete') {
      nextState.stars = (nextState.stars || []).map(star => (
        star.id === item.starId
          ? { ...star, notes: (star.notes || []).filter(note => note.id !== item.entityId) }
          : star
      ));
      return;
    }
    if (item.type === 'track_upsert') {
      const tracks = [...(nextState.savedTracks || [])];
      const index = tracks.findIndex(track => track.id === item.entityId);
      const track = trackFromPayload(payload);
      if (index >= 0) tracks[index] = track;
      else tracks.push(track);
      const requestedOrder = Math.max(0, Number(payload.sortOrder) || 0);
      const selected = tracks.splice(tracks.findIndex(entry => entry.id === item.entityId), 1)[0];
      tracks.splice(Math.min(requestedOrder, tracks.length), 0, selected);
      nextState.savedTracks = tracks;
      return;
    }
    if (item.type === 'track_soft_delete') {
      nextState.savedTracks = (nextState.savedTracks || []).filter(track => track.id !== item.entityId);
    }
  });

  return { state: nextState, profile: nextProfile };
};

export const getMutationEntityValue = (
  state: PersistedAppState,
  profile: CloudProfile,
  item: MemoryMutation
) => {
  if (item.type === 'settings_update') return settingsPayload(state);
  if (item.type === 'profile_update') return profilePayload(profile);
  if (item.type.startsWith('star_')) {
    const index = (state.stars || []).findIndex(star => star.id === item.entityId);
    return index < 0 ? null : starPayload(state.stars![index], index);
  }
  if (item.type.startsWith('note_')) {
    const star = (state.stars || []).find(candidate => candidate.id === item.starId);
    const index = (star?.notes || []).findIndex(note => note.id === item.entityId);
    return !star || index < 0 ? null : notePayload(star.notes![index], index, star.id);
  }
  const index = (state.savedTracks || []).findIndex(track => track.id === item.entityId);
  return index < 0 ? null : trackPayload(state.savedTracks![index], index);
};

export const mutationsAreDisjointFromRemote = (
  mutations: MemoryMutation[],
  remoteState: PersistedAppState,
  remoteProfile: CloudProfile
) => mutations.every(item => memoryValuesEqual(
  item.base ?? null,
  getMutationEntityValue(remoteState, remoteProfile, item)
));

export const mutationsMatchRemote = (
  mutations: MemoryMutation[],
  remoteState: PersistedAppState,
  remoteProfile: CloudProfile
) => mutations.every(item => {
  const remoteValue = getMutationEntityValue(remoteState, remoteProfile, item);
  if (item.type.endsWith('soft_delete')) return remoteValue === null;
  return memoryValuesEqual(item.payload || {}, remoteValue);
});

export const reconcileMemoryMutationsAfterRemoteAdvance = ({
  pendingMutations,
  inFlightMutations,
  remoteState,
  remoteProfile,
}: {
  pendingMutations: MemoryMutation[];
  inFlightMutations: MemoryMutation[];
  remoteState: PersistedAppState;
  remoteProfile: CloudProfile;
}) => {
  const appliedKeys = new Set(
    inFlightMutations
      .filter(item => mutationsMatchRemote([item], remoteState, remoteProfile))
      .map(memoryMutationKey)
  );

  return pendingMutations.flatMap(item => {
    if (mutationsMatchRemote([item], remoteState, remoteProfile)) return [];
    if (!appliedKeys.has(memoryMutationKey(item))) return [item];
    return [{
      ...item,
      base: getMutationEntityValue(remoteState, remoteProfile, item) as Record<string, unknown> | null,
    }];
  });
};

const conflictSuffix = (item: MemoryMutation) => item.mutationId.replace(/[^a-z0-9]/gi, '').slice(-10) || 'copy';
const conflictEntityId = (item: MemoryMutation, originalId = item.entityId) => {
  const suffix = `-conflict-${conflictSuffix(item)}`;
  return `${originalId.slice(0, Math.max(1, 256 - suffix.length))}${suffix}`;
};

export const preserveMutationConflicts = (
  mutations: MemoryMutation[],
  remoteState: PersistedAppState,
  remoteProfile: CloudProfile,
  language = 'en',
  localState: PersistedAppState = remoteState
) => {
  const starRemap = new Map<string, string>();
  const label = language === 'zh' ? '（冲突副本）' : language === 'ko' ? ' (충돌 사본)' : ' (conflict copy)';
  let remoteProfileConflict: ProfileConflictData | null = null;

  const copyLocalStar = (sourceStarId: string, conflictId: string, sourceItem: MemoryMutation) => {
    const starIndex = (localState.stars || []).findIndex(star => star.id === sourceStarId);
    const sourceStar = starIndex >= 0 ? localState.stars?.[starIndex] : undefined;
    if (!sourceStar) return [];
    const starMutation = mutation(
      'star_upsert',
      conflictId,
      { ...starPayload(sourceStar, starIndex), id: conflictId },
      null
    );
    starMutation.createdAt = sourceItem.createdAt;
    const noteMutations = (sourceStar.notes || []).map((note, index) => (
      mutation('note_upsert', note.id, notePayload(note, index, conflictId), null, conflictId)
    ));
    return [starMutation, ...noteMutations];
  };

  const preserved = mutations.flatMap(item => {
    if (item.type === 'note_upsert' && item.starId && starRemap.has(item.starId)) {
      const remappedStarId = starRemap.get(item.starId)!;
      return [{
        ...item,
        mutationId: createClientId(),
        starId: remappedStarId,
        payload: { ...item.payload, starId: remappedStarId },
        base: null,
      }];
    }

    const remoteValue = getMutationEntityValue(remoteState, remoteProfile, item);
    if (memoryValuesEqual(item.base ?? null, remoteValue)) return [item];
    if (item.type.endsWith('soft_delete')) return [];
    if (item.type === 'profile_update' && item.payload && remoteValue && typeof remoteValue === 'object') {
      const base = item.base || {};
      const remote = remoteValue as Record<string, unknown>;
      const conflict: Omit<ProfileConflictData, 'capturedAt' | 'source'> = {};
      if (!memoryValuesEqual(item.payload.name, remote.name)
        && !memoryValuesEqual(item.payload.name, base.name)
        && !memoryValuesEqual(remote.name, base.name)) {
        conflict.name = typeof remote.name === 'string' ? remote.name : '';
      }
      if (!memoryValuesEqual(item.payload.avatarUrl, remote.avatarUrl)
        && !memoryValuesEqual(item.payload.avatarUrl, base.avatarUrl)
        && !memoryValuesEqual(remote.avatarUrl, base.avatarUrl)) {
        conflict.avatarUrl = typeof remote.avatarUrl === 'string' ? remote.avatarUrl : '';
      }
      if (conflict.name || conflict.avatarUrl) {
        remoteProfileConflict = { ...conflict, capturedAt: Date.now(), source: 'remote' };
      }
      return [{ ...item, base: remote }];
    }
    if (item.type === 'note_upsert' && item.payload) {
      const parentExistsRemotely = (remoteState.stars || []).some(star => star.id === item.starId);
      if (!parentExistsRemotely && item.starId) {
        const conflictStarId = conflictEntityId(item, item.starId);
        starRemap.set(item.starId, conflictStarId);
        const copiedStar = copyLocalStar(item.starId, conflictStarId, item);
        if (copiedStar.length > 0) {
          return copiedStar;
        }
      }
      const conflictId = conflictEntityId(item);
      const currentTitle = String(item.payload.title || '');
      return [{
        ...item,
        mutationId: createClientId(),
        entityId: conflictId,
        starId: starRemap.get(item.starId || '') || item.starId,
        payload: {
          ...item.payload,
          id: conflictId,
          starId: starRemap.get(item.starId || '') || item.starId,
          title: currentTitle.length + label.length <= 40_000 ? `${currentTitle}${label}` : currentTitle,
          titleHtml: String(item.payload.titleHtml || ''),
        },
        base: null,
      }];
    }
    if (item.type === 'star_upsert' && item.payload) {
      const conflictId = conflictEntityId(item);
      starRemap.set(item.entityId, conflictId);
      const copiedStar = copyLocalStar(item.entityId, conflictId, item);
      if (copiedStar.length > 0) return copiedStar;
      return [{
        ...item,
        mutationId: createClientId(),
        entityId: conflictId,
        payload: { ...item.payload, id: conflictId },
        base: null,
      }];
    }
    if (item.type === 'track_upsert' && item.payload) {
      const conflictId = conflictEntityId(item);
      return [{
        ...item,
        mutationId: createClientId(),
        entityId: conflictId,
        payload: { ...item.payload, id: conflictId },
        base: null,
      }];
    }
    return [{ ...item, base: remoteValue as Record<string, unknown> | null }];
  });

  if (remoteProfileConflict) {
    const settingsIndex = preserved.findIndex(item => item.type === 'settings_update');
    const remoteSettings = settingsPayload(remoteState);
    const existing = settingsIndex >= 0 ? preserved[settingsIndex] : null;
    const existingPayload = existing?.payload || remoteSettings;
    const existingConflicts = Array.isArray(existingPayload.profileConflicts)
      ? existingPayload.profileConflicts as ProfileConflictData[]
      : [];
    const alreadyStored = existingConflicts.some(conflict => (
      conflict.name === remoteProfileConflict?.name
      && conflict.avatarUrl === remoteProfileConflict?.avatarUrl
    ));
    const payload = {
      ...remoteSettings,
      ...existingPayload,
      profileConflicts: alreadyStored
        ? existingConflicts
        : [remoteProfileConflict, ...existingConflicts],
    };
    const settingsMutation = existing
      ? { ...existing, payload }
      : mutation('settings_update', 'settings', payload, remoteSettings);
    if (settingsIndex >= 0) preserved[settingsIndex] = settingsMutation;
    else preserved.push(settingsMutation);
  }

  return compactMemoryMutations(preserved);
};

export const rebaseMemoryMutationBases = (
  mutations: MemoryMutation[],
  remoteState: PersistedAppState,
  remoteProfile: CloudProfile
) => mutations.map(item => ({
  ...item,
  base: getMutationEntityValue(remoteState, remoteProfile, item) as Record<string, unknown> | null,
}));

export const assembleNormalizedMemoryState = ({
  profile,
  settings,
  stars,
  notes,
  tracks,
}: {
  profile: CloudProfile;
  settings: MemorySettingsRow;
  stars: MemoryStarRow[];
  notes: MemoryNoteRow[];
  tracks: MemoryTrackRow[];
}): PersistedAppState => {
  const notesByStar = new Map<string, NoteData[]>();
  notes
    .filter(row => !row.deleted_at)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .forEach(row => {
      const values = notesByStar.get(row.star_id) || [];
      values.push({
        id: row.id,
        title: row.title || '',
        titleHtml: row.title_html || '',
        content: row.content || '',
        contentHtml: row.content_html || '',
        imageUrl: row.image_url || undefined,
        imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
        images: Array.isArray(row.images) ? row.images : [],
        fontSize: row.font_size ?? undefined,
        titleFontSize: row.title_font_size ?? undefined,
        color: row.color || undefined,
        createdAt: row.created_at_ms ?? undefined,
        updatedAt: row.updated_at_ms ?? undefined,
      });
      notesByStar.set(row.star_id, values);
    });

  return {
    mapStyle: settings.map_style,
    systemTheme: settings.system_theme || {},
    language: settings.language || 'en',
    timeZone: normalizeTimeZone(settings.profile_metadata?.timeZone),
    profileConflicts: Array.isArray(settings.profile_conflicts) ? settings.profile_conflicts : [],
    profile: {
      account: profile.account,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      avatarImage: settings.profile_metadata?.avatarImage,
    },
    isSignedIn: false,
    stars: stars
      .filter(row => !row.deleted_at)
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
      .map(row => ({
        id: row.id,
        lat: row.lat,
        lng: row.lng,
        createdAt: row.created_at_ms ?? undefined,
        tagOrder: row.tag_order ?? undefined,
        tagGroupId: row.tag_group_id ?? undefined,
        color: row.color || undefined,
        notes: notesByStar.get(row.id) || [],
      })),
    savedTracks: tracks
      .filter(row => !row.deleted_at)
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
      .map(row => ({
        id: row.id,
        paths: Array.isArray(row.paths) ? row.paths : [],
        color: row.color || undefined,
        time: Math.max(0, Number(row.duration_seconds) || 0),
        distance: Math.max(0, Number(row.distance_km) || 0),
        createdAt: row.created_at_ms ?? undefined,
        updatedAt: row.updated_at_ms ?? undefined,
      })),
  };
};
