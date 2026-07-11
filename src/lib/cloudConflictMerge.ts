import type { NoteData, PersistedAppState, ProfileConflictData, StarData, TrackData } from '../types/app';
import { escapeHtml } from './noteHtmlUtils';
import { sanitizeRichHtml } from './htmlSanitizer';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
};

const same = (left: unknown, right: unknown) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const conflictIdSuffix = (value: unknown) => {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const choose = <T,>(base: T | undefined, local: T | undefined, remote: T | undefined) => {
  if (same(local, remote)) return local;
  if (base !== undefined && same(local, base)) return remote;
  if (base !== undefined && same(remote, base)) return local;
  if (local === undefined && base !== undefined && same(remote, base)) return undefined;
  if (remote === undefined && base !== undefined && same(local, base)) return undefined;
  return local ?? remote;
};

const conflictCopyLabel = (language: string) => (
  language === 'zh' ? '（冲突副本）' : language === 'ko' ? ' (충돌 사본)' : ' (conflict copy)'
);

const withConflictCopyTitle = (note: NoteData, language: string): NoteData => {
  const label = conflictCopyLabel(language);
  const title = `${note.title || ''}${label}`;
  return {
    ...note,
    id: `${note.id}-conflict-${conflictIdSuffix(note)}`.slice(0, 96),
    title,
    titleHtml: sanitizeRichHtml(`${note.titleHtml || escapeHtml(note.title || '')}<span>${escapeHtml(label)}</span>`),
  };
};

const mergeNotes = (
  baseNotes: NoteData[] = [],
  localNotes: NoteData[] = [],
  remoteNotes: NoteData[] = [],
  language: string
) => {
  const baseById = new Map(baseNotes.map(note => [note.id, note]));
  const localById = new Map(localNotes.map(note => [note.id, note]));
  const remoteById = new Map(remoteNotes.map(note => [note.id, note]));
  const orderedIds = [...localNotes, ...remoteNotes].map(note => note.id)
    .filter((id, index, list) => list.indexOf(id) === index);
  const merged: NoteData[] = [];

  orderedIds.forEach(id => {
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const selected = choose(base, local, remote);
    if (!selected) return;
    merged.push(selected);

    const bothChanged = Boolean(
      local && remote && !same(local, remote) &&
      (!base || (!same(local, base) && !same(remote, base)))
    );
    if (bothChanged) {
      const conflictCopy = withConflictCopyTitle(remote!, language);
      if (!merged.some(note => note.id === conflictCopy.id)) merged.push(conflictCopy);
    }
  });
  return merged;
};

const mergeStars = (
  baseStars: StarData[] = [],
  localStars: StarData[] = [],
  remoteStars: StarData[] = [],
  language: string
) => {
  const baseById = new Map(baseStars.map(star => [star.id, star]));
  const localById = new Map(localStars.map(star => [star.id, star]));
  const remoteById = new Map(remoteStars.map(star => [star.id, star]));
  const orderedIds = [...localStars, ...remoteStars].map(star => star.id)
    .filter((id, index, list) => list.indexOf(id) === index);

  return orderedIds.flatMap(id => {
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const selected = choose(base, local, remote);
    if (!selected) return [];
    if (!local || !remote || same(local, remote)) return [selected];

    const mergedStar = {
      ...selected,
      lat: choose(base?.lat, local.lat, remote.lat) ?? selected.lat,
      lng: choose(base?.lng, local.lng, remote.lng) ?? selected.lng,
      color: choose(base?.color, local.color, remote.color),
      tagOrder: choose(base?.tagOrder, local.tagOrder, remote.tagOrder),
      tagGroupId: choose(base?.tagGroupId, local.tagGroupId, remote.tagGroupId),
      notes: mergeNotes(base?.notes, local.notes, remote.notes, language),
    };
    const coreKeys: Array<keyof Omit<StarData, 'id' | 'notes'>> = [
      'lat',
      'lng',
      'createdAt',
      'color',
      'tagOrder',
      'tagGroupId',
    ];
    const hasCoreConflict = coreKeys.some(key => (
      !same(local[key], remote[key]) &&
      (!base || (!same(local[key], base[key]) && !same(remote[key], base[key])))
    ));
    if (!hasCoreConflict) return [mergedStar];

    return [
      mergedStar,
      {
        ...remote,
        id: `${remote.id}-conflict-${conflictIdSuffix(coreKeys.map(key => remote[key]))}`.slice(0, 96),
        notes: [],
      },
    ];
  });
};

const mergeTracks = (
  baseTracks: TrackData[] = [],
  localTracks: TrackData[] = [],
  remoteTracks: TrackData[] = []
) => {
  const baseById = new Map(baseTracks.map(track => [track.id, track]));
  const localById = new Map(localTracks.map(track => [track.id, track]));
  const remoteById = new Map(remoteTracks.map(track => [track.id, track]));
  const orderedIds = [...localTracks, ...remoteTracks].map(track => track.id)
    .filter((id, index, list) => list.indexOf(id) === index);
  const merged: TrackData[] = [];

  orderedIds.forEach(id => {
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const selected = choose(base, local, remote);
    if (!selected) return;
    merged.push(selected);
    if (local && remote && !same(local, remote) && (!base || (!same(local, base) && !same(remote, base)))) {
      merged.push({ ...remote, id: `${remote.id}-conflict-${conflictIdSuffix(remote)}`.slice(0, 96) });
    }
  });
  return merged;
};

const mergeObject = (
  base: Record<string, unknown> = {},
  local: Record<string, unknown> = {},
  remote: Record<string, unknown> = {}
) => Object.fromEntries(
  [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])]
    .map(key => [key, choose(base[key], local[key], remote[key])])
    .filter(([, value]) => value !== undefined)
);

const getRemoteProfileConflict = (
  base: PersistedAppState['profile'],
  local: PersistedAppState['profile'],
  remote: PersistedAppState['profile']
): ProfileConflictData | null => {
  const conflictingRemote: Omit<ProfileConflictData, 'capturedAt' | 'source'> = {};
  (['name', 'avatarUrl', 'avatarImage'] as const).forEach(key => {
    if (
      !same(local?.[key], remote?.[key]) &&
      (!base || (!same(local?.[key], base[key]) && !same(remote?.[key], base[key])))
    ) {
      conflictingRemote[key] = remote?.[key] as never;
    }
  });
  if (!conflictingRemote.name && !conflictingRemote.avatarUrl && !conflictingRemote.avatarImage) return null;
  return {
    ...conflictingRemote,
    capturedAt: Date.now(),
    source: 'remote',
  };
};

const mergeProfileConflicts = (
  existing: ProfileConflictData[] = [],
  incoming: ProfileConflictData | null
) => {
  if (!incoming) return existing;
  const next = [...existing];
  const alreadyStored = next.some(item => (
    same(item.name, incoming.name) &&
    same(item.avatarUrl, incoming.avatarUrl) &&
    same(item.avatarImage, incoming.avatarImage)
  ));
  if (!alreadyStored) next.unshift(incoming);
  return next;
};

export const mergeCloudConflictState = (
  base: PersistedAppState | undefined,
  local: PersistedAppState,
  remote: PersistedAppState,
  language = local.language || remote.language || 'en'
): PersistedAppState => {
  const remoteProfileConflict = getRemoteProfileConflict(base?.profile, local.profile, remote.profile);
  return {
    ...remote,
    ...local,
    mapStyle: choose(base?.mapStyle, local.mapStyle, remote.mapStyle),
    systemTheme: mergeObject(base?.systemTheme, local.systemTheme, remote.systemTheme),
    profile: mergeObject(base?.profile, local.profile, remote.profile),
    profileConflicts: mergeProfileConflicts(
      [...(local.profileConflicts || []), ...(remote.profileConflicts || [])],
      remoteProfileConflict
    ),
    language: choose(base?.language, local.language, remote.language),
    stars: mergeStars(base?.stars, local.stars, remote.stars, language),
    savedTracks: mergeTracks(base?.savedTracks, local.savedTracks, remote.savedTracks),
    isSignedIn: false,
  };
};
