import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from './memory-record-types.ts';
import { noteText } from './memory-presenters.ts';

const SMALL_ARCHIVE_MAX_CHARACTERS = 8_000;
const SMALL_ARCHIVE_MAX_NOTES = 40;
const MAX_EVIDENCE_NOTES = 20;
const MAX_IDENTITY_ANCHORS = 3;
const MAX_EVENT_ANCHORS = 12;

export type PersonalContextRelation = 'home' | 'work' | 'study' | 'observation' | 'activity';

type RelationDefinition = {
  kind: Exclude<PersonalContextRelation, 'activity'>;
  identity: boolean;
  queryAliases: readonly string[];
  strongEvidence: readonly string[];
  evidenceAliases: readonly string[];
};

const relationDefinitions: readonly RelationDefinition[] = [
  {
    kind: 'home',
    identity: true,
    queryAliases: [
      '我家', '我的家', '家附近', '住处', '住所', '居住地', '我住的地方', '住的地方',
      'my home', 'near home', 'around home', 'where i live', 'my residence',
      '自宅', '家の近く', '住んでいる場所', '우리 집', '집 근처', '사는 곳',
    ],
    strongEvidence: [
      '这里是我家', '這裡是我家', '这是我家', '這是我家', '我住在这里', '我住在這裡',
      '我的家在这里', '我的家在這裡', '这里是我的住处', '這裡是我的住處',
      'this is my home', 'i live here', 'my residence is here',
      'ここが自宅', 'ここに住んで', '여기가 우리 집', '여기에 살고',
    ],
    evidenceAliases: [
      '我住在', '住的地方', '我的住处', '我的住處', '我的住所', '居住地', '我家',
      'i live at', 'my apartment', 'my residence', '住んでいる', '自宅', '사는 곳', '우리 집',
    ],
  },
  {
    kind: 'work',
    identity: true,
    queryAliases: [
      '我工作', '工作的地方', '工作地点', '工作地點', '上班的地方', '上班地点', '上班地點',
      '公司附近', '办公室附近', '辦公室附近', '单位附近', '單位附近',
      'where i work', 'my workplace', 'near my office', '仕事場', '職場', '직장', '회사 근처',
    ],
    strongEvidence: [
      '我在这里工作', '我在這裡工作', '这里是我工作的地方', '這裡是我工作的地方',
      '这是我的公司', '這是我的公司', '这是我的办公室', '這是我的辦公室',
      '工作地点在这里', '工作地點在這裡', '上班地点在这里', '上班地點在這裡',
      'i work here', 'this is my workplace', 'this is my office',
      'ここで働いて', 'ここが職場', '여기서 일해', '여기가 직장',
    ],
    evidenceAliases: [
      '上班', '工作', '公司', '办公室', '辦公室', '单位', '單位',
      'workplace', 'office', 'company', '仕事場', '職場', '회사', '직장',
    ],
  },
  {
    kind: 'study',
    identity: true,
    queryAliases: [
      '我学习', '我學習', '学习的地方', '學習的地方', '学习地点', '學習地點',
      '上学的地方', '上學的地方', '学校附近', '學校附近', '校园附近', '校園附近',
      'where i study', 'my school', 'near my school', '勉強する場所', '学校の近く', '학교 근처', '공부하는 곳',
    ],
    strongEvidence: [
      '我在这里学习', '我在這裡學習', '我在这里上学', '我在這裡上學',
      '这是我的学校', '這是我的學校', '这里是我上课的地方', '這裡是我上課的地方',
      'i study here', 'this is my school', 'this is where i study',
      'ここで勉強', 'ここが学校', '여기서 공부', '여기가 학교',
    ],
    evidenceAliases: [
      '学习', '學習', '上学', '上學', '上课', '上課', '学校', '學校', '校园', '校園', '教室', '图书馆', '圖書館',
      'study', 'school', 'campus', 'classroom', 'library', '勉強', '学校', '공부', '학교', '도서관',
    ],
  },
  {
    kind: 'observation',
    identity: false,
    queryAliases: [
      '看到', '看见', '看見', '见到', '見到', '遇见', '遇見', '遇到', '发现', '發現', '拍到', '目睹',
      'where i saw', 'where i met', 'where i found', 'where i spotted', 'where i photographed',
      '見た場所', '見つけた場所', '出会った場所', '본 곳', '만난 곳', '발견한 곳',
    ],
    strongEvidence: [],
    evidenceAliases: [
      '看到', '看见', '看見', '见到', '見到', '遇见', '遇見', '遇到', '发现', '發現', '拍到', '目睹',
      'saw', 'seen', 'spotted', 'observed', 'met', 'found', 'photographed',
      '見た', '見つけ', '出会', '봤', '보았', '만났', '발견',
    ],
  },
];

const activityGroups = [
  ['做', '制作', '製作', '进行', '進行', '参加', '參加', '体验', '體驗', 'do', 'did', 'make', 'made', 'create', 'created', 'attend', 'joined', '作る', '体験', '하다', '만들'],
  ['吃', '吃饭', '吃飯', '用餐', '品尝', '品嚐', 'eat', 'ate', 'dine', 'dining', 'meal', '食べ', '먹'],
  ['喝', '饮用', '飲用', 'drink', 'drank', 'coffee', 'tea', '飲む', '마시'],
  ['运动', '運動', '锻炼', '鍛鍊', '跑步', '散步', '健身', 'exercise', 'workout', 'running', 'walking', '運動', '走った', '운동', '산책'],
  ['买', '買', '购物', '購物', '逛街', 'shop', 'shopping', 'bought', '買った', '쇼핑', '샀'],
  ['玩', '游玩', '遊玩', '参观', '參觀', 'visit', 'visited', 'play', 'played', '遊ん', '訪れ', '놀', '방문'],
  ['拍', '拍摄', '拍攝', '摄影', '攝影', 'photo', 'photograph', 'filmed', '撮影', '사진'],
] as const;

const proximityTerms = [
  '附近', '周围', '周圍', '周边', '周邊', '旁边', '旁邊', '一带', '一帶',
  'near', 'nearby', 'around', 'close to', '近く', '周辺', '근처', '주변',
];

const locationQuestionTerms = [
  ...proximityTerms,
  '地方', '地点', '地點', '位置', '哪里', '哪裡', '哪儿', '哪兒',
  'where', 'place', 'location', '場所', 'どこ', '곳', '어디',
];

const removableQueryTerms = [
  '帮我', '幫我', '请', '請', '查看', '查找', '寻找', '尋找', '搜索', '搜尋', '看看', '告诉我', '告訴我',
  '相关', '相關', '那些', '那个', '那個', '这个', '這個', '我的', '我', '的',
  '笔记', '筆記', '记录', '記錄', '记忆', '記憶', '照片', '相片', '路线', '路線',
  'please', 'show', 'find', 'search', 'tell', 'about', 'related', 'notes', 'records', 'memories', 'photos', 'routes', 'my', 'i',
  '見せて', '探して', '記録', '思い出', '写真', '찾아', '보여', '기록', '추억', '사진', '내', '나의',
  ...locationQuestionTerms,
];

const normalizeText = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const normalizeCompact = (value: unknown) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, '');

const includesAlias = (source: string, alias: string) => source.includes(normalizeCompact(alias));

const matchingAliases = (source: string, aliases: readonly string[]) => aliases
  .filter(alias => includesAlias(source, alias));

const unique = <T,>(values: T[]) => [...new Set(values)];

const removeTerms = (source: string, terms: readonly string[]) => {
  let output = source;
  [...terms].sort((left, right) => right.length - left.length).forEach(term => {
    output = output.split(normalizeText(term)).join(' ');
  });
  return output;
};

const extractTargetTerms = (
  source: string,
  relations: PersonalContextRelation[],
  actionTerms: string[],
) => {
  if (relations.some(relation => relation === 'home' || relation === 'work' || relation === 'study')) {
    return [];
  }
  const aliases = relationDefinitions
    .filter(definition => relations.includes(definition.kind))
    .flatMap(definition => definition.queryAliases);
  let remainder = removeTerms(source, [...aliases, ...actionTerms, ...removableQueryTerms]);
  remainder = remainder.replace(/[!?！？。；;：:，,、"'“”‘’「」『』【】\[\]()（）]/g, ' ');
  return unique((remainder.match(/[\p{L}\p{N}]+/gu) || [])
    .map(normalizeCompact)
    .filter(term => term && !/^\d+$/u.test(term))
    .filter(term => !/^(?:19|20)\d{2}(?:年|년)?$/u.test(term))
    .filter(term => term.length >= 2 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)))
    .slice(0, 6);
};

export type PersonalContextIntent = {
  requested: boolean;
  relations: PersonalContextRelation[];
  identityRelation: boolean;
  proximityRequested: boolean;
  targetTerms: string[];
  actionTerms: string[];
  source: string;
};

export const analyzePersonalContextQuery = (value: unknown): PersonalContextIntent => {
  const source = normalizeText(value);
  const compact = normalizeCompact(source);
  const relations: PersonalContextRelation[] = relationDefinitions
    .filter(definition => matchingAliases(compact, definition.queryAliases).length > 0)
    .map(definition => definition.kind);
  const matchedActivityGroup = activityGroups.find(group => matchingAliases(compact, group).length > 0);
  const hasLocationShape = matchingAliases(compact, locationQuestionTerms).length > 0;
  if (matchedActivityGroup && hasLocationShape && !relations.includes('activity')) relations.push('activity');
  const actionTerms = matchedActivityGroup ? [...matchedActivityGroup] : [];
  const targetTerms = extractTargetTerms(source, relations, actionTerms);
  const identityRelation = relations.some(relation => (
    relationDefinitions.find(definition => definition.kind === relation)?.identity === true
  ));
  return {
    requested: relations.length > 0 && (hasLocationShape || identityRelation || targetTerms.length > 0),
    relations,
    identityRelation,
    proximityRequested: matchingAliases(compact, proximityTerms).length > 0,
    targetTerms,
    actionTerms,
    source,
  };
};

export const isPersonalMemoryReference = (value: unknown) => analyzePersonalContextQuery(value).requested;

type ScoredNote = {
  note: NoteRow;
  star: StarRow;
  score: number;
  matchedRelations: PersonalContextRelation[];
  matchedTerms: string[];
};

const stripHtml = (value: string) => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

export const explicitMemoryNoteTitle = (note: NoteRow) => note.title.trim() || stripHtml(note.title_html);

const scoreNote = (
  note: NoteRow,
  star: StarRow,
  intent: PersonalContextIntent,
  source: 'title' | 'content',
): ScoredNote | null => {
  const searchable = normalizeCompact(source === 'title' ? explicitMemoryNoteTitle(note) : noteText(note));
  if (!searchable) return null;
  let score = 0;
  const matchedRelations: PersonalContextRelation[] = [];
  const matchedTerms: string[] = [];
  let missingRequiredIdentity = false;

  intent.relations.forEach(relation => {
    if (relation === 'activity') {
      const activityMatches = matchingAliases(searchable, intent.actionTerms);
      if (activityMatches.length) {
        score += 3;
        matchedRelations.push(relation);
        matchedTerms.push(...activityMatches);
      }
      return;
    }
    const definition = relationDefinitions.find(candidate => candidate.kind === relation);
    if (!definition) return;
    const strong = matchingAliases(searchable, definition.strongEvidence);
    const ordinary = matchingAliases(
      searchable,
      source === 'title'
        ? [...definition.evidenceAliases, ...definition.queryAliases]
        : definition.evidenceAliases,
    );
    if (strong.length) {
      score += 8;
      matchedRelations.push(relation);
      matchedTerms.push(...strong);
    } else if (ordinary.length) {
      score += definition.identity ? 4 : 3;
      matchedRelations.push(relation);
      matchedTerms.push(...ordinary);
    } else if (definition.identity) {
      missingRequiredIdentity = true;
    }
  });

  const targetMatches = intent.targetTerms.filter(term => searchable.includes(term));
  if (intent.targetTerms.length && !targetMatches.length) return null;
  if (missingRequiredIdentity) return null;
  if (targetMatches.length) {
    score += 6 + Math.min(4, (targetMatches.length - 1) * 2);
    matchedTerms.push(...targetMatches);
  }
  if (!intent.identityRelation && !intent.targetTerms.length) return null;
  if (score < 4) return null;
  return {
    note,
    star,
    score,
    matchedRelations: unique(matchedRelations),
    matchedTerms: unique(matchedTerms),
  };
};

export type PersonalContextAnchor = {
  starId: string;
  noteId: string;
  coordinates: { lat: number; lng: number };
  createdAt: number | null;
  score: number;
  matchedRelations: PersonalContextRelation[];
  matchedTerms: string[];
};

export type PersonalContextResolution = {
  requested: boolean;
  status: 'not-requested' | 'resolved' | 'ambiguous' | 'not-found';
  relations: PersonalContextRelation[];
  proximityRequested: boolean;
  radiusKm: number;
  targetTerms: string[];
  confidence: number;
  matchSource: 'none' | 'title' | 'content';
  anchors: PersonalContextAnchor[];
  evidenceNoteIds: string[];
  instruction: string;
};

const confidenceFor = (score: number, ambiguous: boolean) => {
  const base = score >= 12 ? 0.92 : score >= 8 ? 0.84 : score >= 6 ? 0.72 : 0.58;
  return ambiguous ? Math.min(base, 0.62) : base;
};

export const resolvePersonalMemoryContext = (
  memory: NormalizedMemoryRows,
  value: unknown,
  radiusKm: number,
): PersonalContextResolution => {
  const intent = analyzePersonalContextQuery(value);
  const base = {
    requested: intent.requested,
    relations: intent.relations,
    proximityRequested: intent.proximityRequested,
    radiusKm,
    targetTerms: intent.targetTerms,
  };
  if (!intent.requested) return {
    ...base,
    status: 'not-requested',
    confidence: 0,
    matchSource: 'none',
    anchors: [],
    evidenceNoteIds: [],
    instruction: 'No personal place relation was requested.',
  };

  const starById = new Map(memory.stars.map(star => [star.id, star]));
  const scoreNotes = (source: 'title' | 'content') => memory.notes.flatMap(note => {
    const star = starById.get(note.star_id);
    if (!star) return [];
    const result = scoreNote(note, star, intent, source);
    return result ? [result] : [];
  }).sort((left, right) => right.score - left.score
    || Number(right.note.created_at_ms || 0) - Number(left.note.created_at_ms || 0)
    || left.note.id.localeCompare(right.note.id));
  const titleMatches = scoreNotes('title');
  const contentMatches = titleMatches.length ? [] : scoreNotes('content');
  const scored = titleMatches.length ? titleMatches : contentMatches;
  const matchSource = titleMatches.length ? 'title' : contentMatches.length ? 'content' : 'none';

  const byStar = new Map<string, ScoredNote[]>();
  scored.forEach(entry => byStar.set(entry.star.id, [...(byStar.get(entry.star.id) || []), entry]));
  const ranked = [...byStar.values()].map(entries => {
    const best = entries[0];
    return {
      best,
      aggregateScore: best.score + Math.min(3, entries.length - 1),
    };
  }).sort((left, right) => right.aggregateScore - left.aggregateScore
    || Number(right.best.note.created_at_ms || 0) - Number(left.best.note.created_at_ms || 0));

  const topScore = ranked[0]?.aggregateScore || 0;
  const selected = intent.identityRelation
    ? ranked.filter(entry => entry.aggregateScore >= topScore - 2).slice(0, MAX_IDENTITY_ANCHORS)
    : ranked.slice(0, MAX_EVENT_ANCHORS);
  const ambiguous = intent.identityRelation && selected.length > 1;
  const anchors = selected.map(({ best, aggregateScore }) => ({
    starId: best.star.id,
    noteId: best.note.id,
    coordinates: { lat: best.star.lat, lng: best.star.lng },
    createdAt: best.note.created_at_ms ?? best.star.created_at_ms,
    score: aggregateScore,
    matchedRelations: best.matchedRelations,
    matchedTerms: best.matchedTerms,
  }));
  const selectedStarIds = new Set(anchors.map(anchor => anchor.starId));
  const evidenceNoteIds = scored
    .filter(entry => selectedStarIds.has(entry.star.id))
    .slice(0, MAX_EVIDENCE_NOTES)
    .map(entry => entry.note.id);

  if (!anchors.length) return {
    ...base,
    status: 'not-found',
    confidence: 0,
    matchSource,
    anchors: [],
    evidenceNoteIds: [],
    instruction: 'No note supplied enough evidence to resolve the requested personal place or event. Do not substitute the latest memory or an unrelated location.',
  };
  return {
    ...base,
    status: ambiguous ? 'ambiguous' : 'resolved',
    confidence: confidenceFor(topScore, ambiguous),
    matchSource,
    anchors,
    evidenceNoteIds,
    instruction: ambiguous
      ? 'Multiple evidence-backed personal place anchors were found. Present the candidates and ask the user to disambiguate instead of choosing one silently.'
      : 'Use the evidence notes and anchored locations only; the personal relation is inferred from the user\'s own note text.',
  };
};

export type SmallArchiveReview = {
  available: boolean;
  mode: 'none' | 'small-archive-candidate-review';
  archiveNoteCount: number;
  archiveTextCharacters: number;
  titleNoteIds: string[];
  candidateNoteIds: string[];
  instruction: string;
};

export const buildSmallArchiveReview = (
  memory: NormalizedMemoryRows,
  personalContext: PersonalContextResolution,
): SmallArchiveReview => {
  const searchable = memory.notes.map(note => ({
    id: note.id,
    title: explicitMemoryNoteTitle(note),
    text: noteText(note),
    createdAt: Number(note.created_at_ms || 0),
  })).filter(entry => entry.title.length > 0 || entry.text.length > 0);
  const characters = searchable.reduce((sum, entry) => sum + entry.title.length + entry.text.length, 0);
  const eligible = personalContext.requested
    && personalContext.status === 'not-found'
    && searchable.length > 0
    && searchable.length <= SMALL_ARCHIVE_MAX_NOTES
    && characters <= SMALL_ARCHIVE_MAX_CHARACTERS;
  return {
    available: eligible,
    mode: eligible ? 'small-archive-candidate-review' : 'none',
    archiveNoteCount: searchable.length,
    archiveTextCharacters: characters,
    titleNoteIds: eligible
      ? [...searchable]
        .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
        .map(entry => entry.id)
      : [],
    candidateNoteIds: eligible
      ? searchable.filter(entry => entry.text.length > 0)
        .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
        .map(entry => entry.id)
      : [],
    instruction: eligible
      ? 'Review titleIndex first. No title supplied direct evidence, so candidateNotes contains bounded title-and-body records for verification. Candidates are not evidence: use only an explicit passage that directly answers the question; otherwise say that no supporting memory was found and do not describe unrelated records.'
      : 'No bounded candidate review is available. Do not infer from unrelated memories.',
  };
};
