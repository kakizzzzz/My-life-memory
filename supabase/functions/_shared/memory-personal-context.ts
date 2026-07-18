import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from './memory-record-types.ts';
import { noteText } from './memory-presenters.ts';

const MAX_CANDIDATE_NOTES = 6;
const MAX_CANDIDATE_TITLES = 12;
const MAX_CANDIDATE_EXCERPT_CHARACTERS = 1_200;
const MAX_EVIDENCE_PASSAGES = 12;
const MAX_IDENTITY_ANCHORS = 3;
const MAX_EVENT_ANCHORS = 12;
const MAX_PASSAGE_CHARACTERS = 240;

export type PersonalAnchorRelation = 'home' | 'work' | 'study';
export type PersonalEventRelation = 'observation' | 'activity';
export type PersonalContextRelation = PersonalAnchorRelation | PersonalEventRelation;

type RelationDefinition = {
  kind: Exclude<PersonalContextRelation, 'activity'>;
  identity: boolean;
  queryAliases: readonly string[];
  directEvidence: readonly string[];
  evidenceAliases: readonly string[];
};

const relationDefinitions: readonly RelationDefinition[] = [
  {
    kind: 'home',
    identity: true,
    queryAliases: [
      '我家', '我的家', '家附近', '住处', '住處', '住所', '居住地', '我住的地方', '住的地方',
      'my home', 'near home', 'around home', 'where i live', 'my residence',
      '私の家', '自宅', '家の近く', '住んでいる場所', '우리 집', '내 집', '집 근처', '사는 곳',
    ],
    directEvidence: [
      '这里是我家', '這裡是我家', '这是我家', '這是我家', '我住在这里', '我住在這裡',
      '我的家在这里', '我的家在這裡', '这里是我的住处', '這裡是我的住處', '这里是我住的地方', '這裡是我住的地方',
      'this is my home', 'i live here', 'my residence is here',
      'ここが自宅', 'ここに住んで', '私の家', '여기가 우리 집', '여기에 살고',
    ],
    evidenceAliases: [
      '我住在', '我们住', '我們住', '住的地方', '我的住处', '我的住處', '我的住所', '居住地', '我家',
      '家里', '家裡', '家中', '我住的房子', '这套房', '這套房', '这个房子', '這個房子',
      '搬到这里', '搬到這裡', '搬进', '搬進', '回到我家',
      'i live at', 'we live', 'my apartment', 'my residence', 'my house', 'moved into this home',
      '住んでいる', '自宅', '住んでいる家', '사는 곳', '우리 집', '내 집',
    ],
  },
  {
    kind: 'work',
    identity: true,
    queryAliases: [
      '我工作', '我的工作地点', '我的工作地點', '工作的地方', '工作地点', '工作地點', '上班的地方', '上班地点', '上班地點',
      '我公司', '我的公司', '我的办公室', '我的辦公室', '公司附近', '办公室附近', '辦公室附近', '单位附近', '單位附近',
      'where i work', 'my workplace', 'my office', 'near my office', '私の職場', '私の会社', '仕事場', '職場', '내 직장', '내 회사', '직장', '회사 근처',
    ],
    directEvidence: [
      '我在这里工作', '我在這裡工作', '这里是我工作的地方', '這裡是我工作的地方',
      '这是我的公司', '這是我的公司', '这是我的办公室', '這是我的辦公室',
      '这是我的工位', '這是我的工位', '我的工位在这里', '我的工位在這裡',
      '我每天在这里上班', '我每天在這裡上班',
      '工作地点在这里', '工作地點在這裡', '上班地点在这里', '上班地點在這裡',
      'i work here', 'this is my workplace', 'this is my office',
      'ここで働いて', 'ここが職場', '私の職場', '여기서 일해', '여기가 직장', '내 직장',
    ],
    evidenceAliases: [
      '上班', '工作', '公司', '办公室', '辦公室', '单位', '單位', '工位', '通勤',
      'workplace', 'office', 'company', 'desk at work', 'commute', '仕事場', '職場', '会社', '회사', '직장',
    ],
  },
  {
    kind: 'study',
    identity: true,
    queryAliases: [
      '我学习', '我學習', '我的学校', '我的學校', '学习的地方', '學習的地方', '学习地点', '學習地點',
      '上学的地方', '上學的地方', '学校附近', '學校附近', '校园附近', '校園附近',
      'where i study', 'my school', 'near my school', '私の学校', '勉強する場所', '学校の近く', '내 학교', '학교 근처', '공부하는 곳',
    ],
    directEvidence: [
      '我在这里学习', '我在這裡學習', '我在这里上学', '我在這裡上學',
      '这是我的学校', '這是我的學校', '这里是我上课的地方', '這裡是我上課的地方',
      '这是我的校区', '這是我的校區', '这是我的教室', '這是我的教室',
      '我每天在这里上课', '我每天在這裡上課',
      'i study here', 'this is my school', 'this is where i study',
      'ここで勉強', 'ここが学校', '私の学校', '여기서 공부', '여기가 학교', '내 학교',
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
      '看到', '看见', '看見', '见到', '見到', '见过', '見過', '看过', '看過', '遇见', '遇見', '遇到', '发现', '發現', '拍到', '目睹',
      'where i saw', 'where did i see', 'where have i seen', 'i saw', 'i spotted', 'i observed',
      'where i met', 'where i found', 'where i spotted', 'where i photographed',
      '見た場所', '見つけた場所', '出会った場所', '見た', '見つけた', '出会った',
      '본 곳', '만난 곳', '발견한 곳', '봤', '보았다', '만났다', '발견했다',
    ],
    directEvidence: [],
    evidenceAliases: [
      '看到', '看见', '看見', '见到', '見到', '见过', '見過', '看过', '看過', '遇见', '遇見', '遇到', '发现', '發現', '拍到', '目睹',
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
  '地方', '地点', '地點', '位置', '哪里', '哪裡', '哪儿', '哪兒', '在哪', '在哪里', '在哪裡', '在哪儿', '在哪兒', '何处', '何處',
  'where', 'place', 'location', '場所', 'どこ', '곳', '어디',
];

const removableQueryTerms = [
  '帮我', '幫我', '请', '請', '查看', '查找', '寻找', '尋找', '搜索', '搜尋', '看看', '告诉我', '告訴我',
  '相关', '相關', '那些', '那个', '那個', '这个', '這個', '那只', '那隻', '这只', '這隻', '那家', '这家', '這家',
  '一个', '一個', '一只', '一隻', '一件', '一张', '一張', '一处', '一處', '一家', '一台', '一辆', '一輛',
  '一份', '一块', '一塊', '某个', '某個', '某只', '某隻', '某件', '某张', '某張', '某处', '某處', '某家',
  '某台', '某辆', '某輛', '某份', '某块', '某塊',
  '那里', '那裡', '这里', '這裡', '什么', '什麼', '哪些', '哪种', '哪種', '过', '過', '我的', '我', '的',
  '笔记', '筆記', '记录', '記錄', '记忆', '記憶', '照片', '相片', '路线', '路線',
  'please', 'show', 'find', 'search', 'tell', 'about', 'related', 'notes', 'records', 'memories', 'photos', 'routes', 'what', 'which', 'my', 'i', 'it', 'this', 'that', 'these', 'those', 'them', 'some',
  'in', 'at', 'on', '見せて', '探して', '記録', '思い出', '写真', 'で', 'に', 'を', 'が',
  '찾아', '보여', '기록', '추억', '사진', '무엇', '어떤', '내', '나의', '에서', '에', '을', '를', '이', '가', '다',
  ...locationQuestionTerms,
];

const normalizeText = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const normalizeCompact = (value: unknown) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, '');
const escapedRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latinWordPhrase = (value: string) => /^[\p{Script=Latin}\p{N}\s'-]+$/u.test(value);
const includesAlias = (source: string, alias: string) => {
  const normalizedSource = normalizeText(source);
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (!latinWordPhrase(normalizedAlias)) {
    return normalizeCompact(normalizedSource).includes(normalizeCompact(normalizedAlias));
  }
  const phrase = escapedRegex(normalizedAlias).replace(/ /g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(normalizedSource);
};
const matchingAliases = (source: string, aliases: readonly string[]) => aliases.filter(alias => includesAlias(source, alias));
const unique = <T,>(values: T[]) => [...new Set(values)];

const removeTerms = (source: string, terms: readonly string[]) => {
  let output = source;
  [...terms].sort((left, right) => right.length - left.length).forEach(term => {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) return;
    if (latinWordPhrase(normalizedTerm)) {
      const phrase = escapedRegex(normalizedTerm).replace(/ /g, '\\s+');
      output = output.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1 ');
    } else {
      output = output.split(normalizedTerm).join(' ');
    }
  });
  return output;
};

const extractTargetTerms = (
  source: string,
  relations: PersonalContextRelation[],
  actionTerms: string[],
) => {
  const aliases = relationDefinitions
    .filter(definition => relations.includes(definition.kind))
    .flatMap(definition => definition.queryAliases);
  let remainder = removeTerms(source, [...aliases, ...actionTerms, ...removableQueryTerms]);
  remainder = remainder.replace(/[!?！？。；;：:，,、"'“”‘’「」『』【】\[\]()（）]/g, ' ');
  return unique((remainder.match(/[\p{L}\p{N}]+/gu) || [])
    .map(normalizeCompact)
    .filter(term => term && !/^\d+$/u.test(term))
    .filter(term => !/^(?:19|20)\d{2}(?:年|년)?$/u.test(term))
    .filter(term => !['过', '了', '在', 'near', 'did'].includes(term))
    .filter(term => term.length >= 2 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)))
    .slice(0, 6);
};

export type PersonalContextIntent = {
  requested: boolean;
  relations: PersonalContextRelation[];
  anchorRelations: PersonalAnchorRelation[];
  eventRelations: PersonalEventRelation[];
  identityRelation: boolean;
  proximityRequested: boolean;
  targetTerms: string[];
  actionTerms: string[];
  source: string;
};

export const analyzePersonalContextQuery = (value: unknown): PersonalContextIntent => {
  const source = normalizeText(value);
  const relations: PersonalContextRelation[] = relationDefinitions
    .filter(definition => matchingAliases(source, definition.queryAliases).length > 0)
    .map(definition => definition.kind);
  const matchedActivityGroup = activityGroups.find(group => matchingAliases(source, group).length > 0);
  const effectiveActivityGroup = relations.includes('observation') && matchedActivityGroup === activityGroups[0]
    ? undefined
    : matchedActivityGroup;
  const hasLocationShape = matchingAliases(source, locationQuestionTerms).length > 0;
  if (effectiveActivityGroup && hasLocationShape && !relations.includes('activity')) relations.push('activity');
  const actionTerms = effectiveActivityGroup ? [...effectiveActivityGroup] : [];
  const targetTerms = extractTargetTerms(source, relations, actionTerms);
  const anchorRelations = relations.filter((relation): relation is PersonalAnchorRelation => (
    relation === 'home' || relation === 'work' || relation === 'study'
  ));
  const eventRelations = relations.filter((relation): relation is PersonalEventRelation => (
    relation === 'observation' || relation === 'activity'
  ));
  return {
    requested: relations.length > 0 && (hasLocationShape || anchorRelations.length > 0 || targetTerms.length > 0),
    relations,
    anchorRelations,
    eventRelations,
    identityRelation: anchorRelations.length > 0,
    proximityRequested: matchingAliases(source, proximityTerms).length > 0,
    targetTerms,
    actionTerms,
    source,
  };
};

const privatePersonalPlacePattern = /(?:我的|我家|本人|我们|我們|我住|我公司|我单位|我單位|我工作|我上班|我学习|我學習|my\s+(?:home|office|workplace|company|school|campus|residence)|where\s+i\s+(?:live|work|study)|our\s+(?:home|office|workplace|school)|私の(?:家|自宅|職場|会社|学校)|僕の(?:家|職場|学校)|내\s*(?:집|직장|회사|학교)|나의\s*(?:집|직장|회사|학교)|우리\s*(?:집|직장|회사|학교))/iu;

export const isPrivatePersonalPlaceReference = (value: unknown) => privatePersonalPlacePattern.test(String(value || '').normalize('NFKC'));
export const isPersonalMemoryReference = (value: unknown) => (
  isPrivatePersonalPlaceReference(value) || analyzePersonalContextQuery(value).requested
);

const stripHtml = (value: string) => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<\/(?:p|div|figure|li|h[1-6])>/gi, '. ')
  .replace(/<br\s*\/?\s*>/gi, '. ')
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

const boundedPassage = (value: string) => value.length <= MAX_PASSAGE_CHARACTERS
  ? value
  : `${value.slice(0, MAX_PASSAGE_CHARACTERS - 1).trimEnd()}…`;

const splitPassages = (value: string) => stripHtml(value)
  .replace(/(?:，|,)\s*(?=(?:但是|但|不过|不過|后来|後來|然后|然後|however|but|then|その後|でも|하지만|그런데))/giu, '。')
  .split(/(?<=[。！？!?；;])|\n+/u)
  .map(part => part.trim())
  .filter(Boolean)
  .flatMap(part => {
    if (part.length <= MAX_PASSAGE_CHARACTERS) return [part];
    const chunks: string[] = [];
    for (let offset = 0; offset < part.length; offset += MAX_PASSAGE_CHARACTERS) {
      chunks.push(part.slice(offset, offset + MAX_PASSAGE_CHARACTERS));
    }
    return chunks;
  });

const userAttributionPattern = /(?:我|我的|本人|我们|我們|\b(?:i|my|we|our)\b|私|僕|自分|내|나의|우리)/iu;
const thirdPartyPattern = /(?:朋友|同事|客户|客戶|家人|父母|妈妈|媽媽|爸爸|孩子|老师|老師|老板|老闆|雇主|候选人|候選人)(?:的|家|住|工作|上班|学习|學習|学校|學校|办公室|辦公室)|(?:他说|他說|她说|她說)|\b(?:my\s+(?:friend|colleague|client|customer|parent|mother|father|child|teacher|boss|employer)|(?:friend|colleague|client|customer|parent|teacher|boss|candidate)(?:'s|\s+(?:lives|works|studies)))\b|\b(?:he|she)\s+(?:said|lives|works|studies)\b|(?:友達|同僚|顧客|家族|先生|上司)(?:の|が住|が働|の家|の職場|の学校)|(?:친구|동료|고객|가족|선생님|상사)(?:의|가\s*살|가\s*일|의\s*집|의\s*직장|의\s*학교)/iu;
const negationPattern = /(?:不是|并非|並非|不在这里|不在這裡|没有在这里|沒有在這裡|从不|從不|并不|並不|(?:没|沒|没有|沒有|未曾|不曾)(?:真的|实际|實際)?(?:看到|看见|看見|见到|見到|见过|見過|遇见|遇見|遇到|发现|發現|拍到|吃|喝|买|買|去过|去過|参加|參加)|\b(?:not|never|do\s+not|does\s+not|did\s+not|don['’]?t|doesn['’]?t|didn['’]?t|couldn['’]?t)\b|ではない|じゃない|住んでいない|働いていない|見なかった|見ていない|食べなかった|行かなかった|아니|않|없|못\s*(?:봤|보았|먹|갔))/iu;
const thirdPartyQuotePattern = /(?:朋友|同事|客户|客戶|他|她|friend|colleague|client|he|she|友達|同僚|친구|동료).{0,12}(?:说|說|said|言った|말했)[：:]?["“‘「『]/iu;

const directIdentityShape = (relation: PersonalAnchorRelation, text: string) => {
  const source = normalizeText(text);
  if (relation === 'home') {
    return /(?:我.{0,16}(?:住|居住).{0,12}(?:这里|這裡|这边|這邊|此处|此處)|(?:这里|這裡|这边|這邊|此处|此處).{0,16}(?:是|就是).{0,8}(?:我家|我的家|我住的(?:房子|地方|公寓))|(?:回到|回了|到了|搬到|搬进|搬進|住进|住進).{0,8}(?:我家|家里|家裡|家中|这套房|這套房|这个房子|這個房子)|(?:我|我们|我們).{0,12}(?:租|买|買|装修|裝修|住).{0,12}(?:这套|這套|这个|這個).{0,4}(?:房子|公寓)|\bi\s+(?:live|reside)\s+here\b|\b(?:this|here).{0,20}(?:my home|where i live)\b|\b(?:returned|moved)\s+(?:to|into)\s+my\s+home\b|(?:私|僕).{0,12}(?:ここに住|ここで暮)|(?:ここ|ここが).{0,12}(?:自宅|住んでいる家)|(?:나|내가|저).{0,12}여기.{0,8}(?:살|거주)|(?:여기|이곳).{0,12}(?:우리 집|내 집))/iu.test(source);
  }
  if (relation === 'work') {
    return /(?:我.{0,20}(?:这里|這裡|这间|這間|此处|此處).{0,16}(?:工作|上班)|我.{0,20}(?:工作|上班|通勤).{0,16}(?:这里|這裡|这间|這間|此处|此處)|(?:这里|這裡|此处|此處).{0,12}(?:是|就是).{0,8}(?:我的(?:公司|办公室|辦公室|工位)|我工作|我上班)|\bi\s+(?:work|worked)\s+here\b|\bthis\s+is\s+my\s+(?:workplace|office|desk\s+at\s+work)\b|(?:私|僕).{0,12}ここで働|(?:나|내가|저).{0,12}여기.{0,8}(?:일|근무))/iu.test(source);
  }
  return /(?:我.{0,20}(?:这里|這裡|这间|這間|此处|此處).{0,16}(?:学习|學習|上学|上學|上课|上課)|我.{0,20}(?:学习|學習|上学|上學|上课|上課).{0,16}(?:这里|這裡|这间|這間|此处|此處)|(?:这里|這裡|此处|此處).{0,12}(?:是|就是).{0,8}(?:我的(?:学校|學校|校区|校區|教室)|我学习|我學習|我上课|我上課)|\bi\s+(?:study|studied|attend\s+school)\s+here\b|\bthis\s+is\s+my\s+(?:school|campus|classroom)\b|(?:私|僕).{0,12}ここで(?:勉強|学)|(?:나|내가|저).{0,12}여기.{0,8}(?:공부|학교))/iu.test(source);
};

const attributionFor = (text: string): MemoryEvidencePassage['attribution'] => {
  if (thirdPartyPattern.test(text) || thirdPartyQuotePattern.test(text)) return 'third-party';
  return userAttributionPattern.test(text) ? 'user' : 'unknown';
};

export type MemoryEvidencePassage = {
  noteId: string;
  starId: string;
  source: 'title' | 'body';
  text: string;
  relation: PersonalContextRelation;
  evidenceStrength: 'direct' | 'corroborating' | 'weak';
  attribution: 'user' | 'third-party' | 'unknown';
  negated: boolean;
  matchedTerms: string[];
  createdAt: number | null;
  coordinates: { lat: number; lng: number };
};

const passageRecord = (
  note: NoteRow,
  star: StarRow,
  source: 'title' | 'body',
  text: string,
  relation: PersonalContextRelation,
  evidenceStrength: MemoryEvidencePassage['evidenceStrength'],
  matchedTerms: string[],
): MemoryEvidencePassage => ({
  noteId: note.id,
  starId: star.id,
  source,
  text: boundedPassage(text),
  relation,
  evidenceStrength,
  attribution: attributionFor(text),
  negated: negationPattern.test(text),
  matchedTerms: unique(matchedTerms),
  createdAt: note.created_at_ms ?? star.created_at_ms,
  coordinates: { lat: star.lat, lng: star.lng },
});

const notePassages = (note: NoteRow) => ([
  ...(explicitMemoryNoteTitle(note) ? [{ source: 'title' as const, text: explicitMemoryNoteTitle(note) }] : []),
  ...splitPassages(note.content_html || note.content || noteText(note)).map(text => ({ source: 'body' as const, text })),
]);

const identityPassagesForNote = (
  note: NoteRow,
  star: StarRow,
  relations: PersonalAnchorRelation[],
) => notePassages(note).flatMap(({ source, text }) => {
  const normalizedPassage = normalizeText(text);
  const attribution = attributionFor(text);
  const negated = negationPattern.test(text);
  return relations.flatMap(relation => {
    const definition = relationDefinitions.find(candidate => candidate.kind === relation);
    if (!definition) return [];
    const directMatches = matchingAliases(normalizedPassage, definition.directEvidence);
    const ordinaryMatches = matchingAliases(
      normalizedPassage,
      source === 'title' ? [...definition.evidenceAliases, ...definition.queryAliases] : definition.evidenceAliases,
    );
    if (!directMatches.length && !ordinaryMatches.length) return [];
    const exactPersonalTitle = source === 'title'
      && attribution === 'user'
      && definition.queryAliases.some(alias => normalizeCompact(normalizedPassage) === normalizeCompact(alias));
    let strength: MemoryEvidencePassage['evidenceStrength'] = 'weak';
    if (!negated && attribution !== 'third-party') {
      if (directMatches.length
        || directIdentityShape(relation, text)
        || exactPersonalTitle) {
        strength = 'direct';
      } else if (attribution === 'user' && ordinaryMatches.length) {
        strength = 'corroborating';
      }
    }
    return [passageRecord(note, star, source, text, relation, strength, [...directMatches, ...ordinaryMatches])];
  });
});

const eventPassagesForNote = (
  note: NoteRow,
  star: StarRow,
  eventRelations: PersonalEventRelation[],
  targetTerms: string[],
  actionTerms: string[],
) => {
  const passages = notePassages(note);
  const titleTargets = passages
    .filter(passage => passage.source === 'title')
    .flatMap(passage => targetTerms.filter(term => normalizeCompact(passage.text).includes(term)));
  const bodyActionExists = passages.some(passage => {
    const normalizedPassage = normalizeText(passage.text);
    return eventRelations.some(relation => relation === 'activity'
      ? matchingAliases(normalizedPassage, actionTerms).length > 0
      : matchingAliases(normalizedPassage, relationDefinitions.find(item => item.kind === 'observation')?.evidenceAliases || []).length > 0);
  });
  return passages.flatMap(({ source, text }) => {
    const normalizedPassage = normalizeText(text);
    const compact = normalizeCompact(text);
    const targets = targetTerms.filter(term => compact.includes(term));
    if (!eventRelations.length && targets.length) {
      return [passageRecord(note, star, source, text, 'activity', 'direct', targets)];
    }
    return eventRelations.flatMap(relation => {
      const relationMatches = relation === 'activity'
        ? matchingAliases(normalizedPassage, actionTerms)
        : matchingAliases(normalizedPassage, relationDefinitions.find(item => item.kind === 'observation')?.evidenceAliases || []);
      const samePassage = relationMatches.length > 0 && (!targetTerms.length || targets.length > 0);
      const titleBodyPair = source === 'title' && targets.length > 0 && bodyActionExists;
      if (!samePassage && !titleBodyPair) return [];
      const strength: MemoryEvidencePassage['evidenceStrength'] = samePassage ? 'direct' : 'corroborating';
      return [passageRecord(note, star, source, text, relation, strength, [...relationMatches, ...targets, ...titleTargets])];
    });
  });
};

const strengthRank = (value: MemoryEvidencePassage['evidenceStrength']) => (
  value === 'direct' ? 3 : value === 'corroborating' ? 2 : 1
);

const passageComparator = (left: MemoryEvidencePassage, right: MemoryEvidencePassage) => (
  strengthRank(right.evidenceStrength) - strengthRank(left.evidenceStrength)
  || Number(right.attribution === 'user') - Number(left.attribution === 'user')
  || Number(left.negated) - Number(right.negated)
  || Number(right.source === 'title') - Number(left.source === 'title')
  || Number(right.createdAt || 0) - Number(left.createdAt || 0)
  || left.noteId.localeCompare(right.noteId)
);

const dedupePassages = (passages: MemoryEvidencePassage[]) => {
  const seen = new Set<string>();
  return passages.filter(passage => {
    const key = `${passage.noteId}:${normalizeCompact(passage.text)}:${passage.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export type PersonalAnchorEpisode = {
  relation: PersonalAnchorRelation;
  starId: string;
  evidenceNoteIds: string[];
  firstEvidenceAt: number | null;
  lastEvidenceAt: number | null;
  evidenceStrength: 'direct' | 'corroborated';
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
  anchorRelations: PersonalAnchorRelation[];
  eventRelations: PersonalEventRelation[];
  proximityRequested: boolean;
  radiusKm: number;
  targetTerms: string[];
  actionTerms: string[];
  confidence: number;
  confidenceBand: 'high' | 'medium' | 'low' | 'none';
  confidenceKind: 'heuristic';
  matchSource: 'none' | 'title' | 'content' | 'mixed';
  anchors: PersonalContextAnchor[];
  episodes: PersonalAnchorEpisode[];
  evidencePassages: MemoryEvidencePassage[];
  evidenceNoteIds: string[];
  decisionReasons: string[];
  instruction: string;
};

const matchSourceFor = (passages: MemoryEvidencePassage[]): PersonalContextResolution['matchSource'] => {
  const sources = new Set(passages.map(passage => passage.source));
  if (sources.size > 1) return 'mixed';
  if (sources.has('title')) return 'title';
  if (sources.has('body')) return 'content';
  return 'none';
};

const confidenceFor = (
  strength: 'direct' | 'corroborated' | 'none',
  ambiguous: boolean,
) => {
  const value = strength === 'direct' ? 0.84 : strength === 'corroborated' ? 0.72 : 0;
  return ambiguous ? Math.min(value, 0.62) : value;
};

const confidenceBandFor = (confidence: number): PersonalContextResolution['confidenceBand'] => (
  confidence >= 0.8 ? 'high' : confidence >= 0.65 ? 'medium' : confidence > 0 ? 'low' : 'none'
);

const baseResolution = (intent: PersonalContextIntent, radiusKm: number) => ({
  requested: intent.requested,
  relations: intent.relations,
  anchorRelations: intent.anchorRelations,
  eventRelations: intent.eventRelations,
  proximityRequested: intent.proximityRequested,
  radiusKm,
  targetTerms: intent.targetTerms,
  actionTerms: intent.actionTerms,
  confidenceKind: 'heuristic' as const,
});

export const findTargetEvidencePassages = (
  note: NoteRow,
  star: StarRow,
  context: Pick<PersonalContextResolution, 'eventRelations' | 'targetTerms' | 'actionTerms'>,
) => dedupePassages(eventPassagesForNote(
  note,
  star,
  context.eventRelations,
  context.targetTerms,
  context.actionTerms,
)).filter(passage => !passage.negated && passage.attribution !== 'third-party')
  .sort(passageComparator);

export const resolvePersonalMemoryContext = (
  memory: NormalizedMemoryRows,
  value: unknown,
  radiusKm: number,
): PersonalContextResolution => {
  const intent = analyzePersonalContextQuery(value);
  const base = baseResolution(intent, radiusKm);
  if (!intent.requested) return {
    ...base,
    status: 'not-requested', confidence: 0, confidenceBand: 'none', matchSource: 'none',
    anchors: [], episodes: [], evidencePassages: [], evidenceNoteIds: [], decisionReasons: [],
    instruction: 'No personal place relation was requested.',
  };

  const starById = new Map(memory.stars.map(star => [star.id, star]));
  if (intent.anchorRelations.length) {
    const allIdentityPassages = dedupePassages(memory.notes.flatMap(note => {
      const star = starById.get(note.star_id);
      return star ? identityPassagesForNote(note, star, intent.anchorRelations) : [];
    })).filter(passage => !passage.negated && passage.attribution !== 'third-party');

    const groups = new Map<string, MemoryEvidencePassage[]>();
    allIdentityPassages.forEach(passage => {
      const key = `${passage.relation}:${passage.starId}`;
      groups.set(key, [...(groups.get(key) || []), passage]);
    });
    const eligible = [...groups.values()].flatMap(passages => {
      const direct = passages.filter(passage => passage.evidenceStrength === 'direct');
      const corroborating = passages.filter(passage => passage.evidenceStrength === 'corroborating');
      const independentCorroboration = new Set(corroborating.map(passage => normalizeCompact(passage.text))).size >= 2
        && new Set(corroborating.map(passage => passage.noteId)).size >= 2;
      if (!direct.length && !independentCorroboration) return [];
      const accepted = (direct.length ? [...direct, ...corroborating] : corroborating).sort(passageComparator);
      const timestamps = accepted.map(passage => Number(passage.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
      const relation = accepted[0].relation as PersonalAnchorRelation;
      return [{
        relation,
        starId: accepted[0].starId,
        passages: accepted,
        strength: direct.length ? 'direct' as const : 'corroborated' as const,
        firstEvidenceAt: timestamps[0] ?? null,
        lastEvidenceAt: timestamps.at(-1) ?? null,
      }];
    }).sort((left, right) => Number(right.strength === 'direct') - Number(left.strength === 'direct')
      || Number(right.passages.some(item => item.source === 'title')) - Number(left.passages.some(item => item.source === 'title'))
      || Number(right.lastEvidenceAt || 0) - Number(left.lastEvidenceAt || 0)
      || left.starId.localeCompare(right.starId));

    const bestStrength = eligible[0]?.strength;
    const selected = eligible.filter(item => item.strength === bestStrength).slice(0, MAX_IDENTITY_ANCHORS);
    const ambiguous = selected.length > 1;
    const selectedPassages = selected.flatMap(item => item.passages).sort(passageComparator).slice(0, MAX_EVIDENCE_PASSAGES);
    const episodes: PersonalAnchorEpisode[] = selected.map(item => ({
      relation: item.relation,
      starId: item.starId,
      evidenceNoteIds: unique(item.passages.map(passage => passage.noteId)),
      firstEvidenceAt: item.firstEvidenceAt,
      lastEvidenceAt: item.lastEvidenceAt,
      evidenceStrength: item.strength,
    }));
    const anchors = selected.flatMap(item => {
      const best = item.passages[0];
      const star = starById.get(item.starId);
      if (!star) return [];
      return [{
        starId: item.starId,
        noteId: best.noteId,
        coordinates: { lat: star.lat, lng: star.lng },
        createdAt: best.createdAt,
        score: item.strength === 'direct' ? 8 : 6,
        matchedRelations: [item.relation],
        matchedTerms: unique(item.passages.flatMap(passage => passage.matchedTerms)),
      }];
    });
    if (!anchors.length) return {
      ...base,
      status: 'not-found', confidence: 0, confidenceBand: 'none', matchSource: 'none',
      anchors: [], episodes: [], evidencePassages: [], evidenceNoteIds: [],
      decisionReasons: ['No direct first-person identity passage or two independent corroborating passages were found.'],
      instruction: 'No note supplied enough evidence to resolve the requested personal place. Do not substitute the latest memory or an unrelated location.',
    };
    const confidence = confidenceFor(bestStrength || 'none', ambiguous);
    return {
      ...base,
      status: ambiguous ? 'ambiguous' : 'resolved',
      confidence,
      confidenceBand: confidenceBandFor(confidence),
      matchSource: matchSourceFor(selectedPassages),
      anchors,
      episodes,
      evidencePassages: selectedPassages,
      evidenceNoteIds: unique(selectedPassages.map(passage => passage.noteId)),
      decisionReasons: ambiguous
        ? ['Multiple independently supported identity episodes remain plausible; recency was not used to choose one.']
        : [`Resolved from ${bestStrength === 'direct' ? 'direct first-person' : 'independent corroborating'} evidence at one location.`],
      instruction: ambiguous
        ? 'Multiple evidence-backed personal place anchors were found. Present the candidates and ask the user to disambiguate instead of choosing one silently.'
        : 'Use the anchor evidence only. The personal relation is a heuristic inference from the user\'s own note passages, not a verified current location.',
    };
  }

  const eventEntries = memory.notes.flatMap(note => {
    const star = starById.get(note.star_id);
    if (!star) return [];
    const passages = findTargetEvidencePassages(note, star, {
      eventRelations: intent.eventRelations,
      targetTerms: intent.targetTerms,
      actionTerms: intent.actionTerms,
    });
    return passages.length ? [{ note, star, passages }] : [];
  }).sort((left, right) => passageComparator(left.passages[0], right.passages[0])
    || left.note.id.localeCompare(right.note.id));
  const selectedEntries = eventEntries.slice(0, MAX_EVENT_ANCHORS);
  const selectedPassages = selectedEntries.flatMap(entry => entry.passages).sort(passageComparator).slice(0, MAX_EVIDENCE_PASSAGES);
  const anchors = selectedEntries.map(entry => ({
    starId: entry.star.id,
    noteId: entry.note.id,
    coordinates: { lat: entry.star.lat, lng: entry.star.lng },
    createdAt: entry.note.created_at_ms ?? entry.star.created_at_ms,
    score: strengthRank(entry.passages[0].evidenceStrength) * 2,
    matchedRelations: unique(entry.passages.map(passage => passage.relation)),
    matchedTerms: unique(entry.passages.flatMap(passage => passage.matchedTerms)),
  }));
  if (!anchors.length) return {
    ...base,
    status: 'not-found', confidence: 0, confidenceBand: 'none', matchSource: 'none',
    anchors: [], episodes: [], evidencePassages: [], evidenceNoteIds: [],
    decisionReasons: ['No passage contained the requested event/action evidence and target in a supported combination.'],
    instruction: 'No note supplied direct evidence for the requested event. Do not substitute unrelated memories.',
  };
  const confidence = selectedPassages.some(passage => passage.evidenceStrength === 'direct') ? 0.84 : 0.72;
  return {
    ...base,
    status: 'resolved', confidence, confidenceBand: confidenceBandFor(confidence),
    matchSource: matchSourceFor(selectedPassages), anchors, episodes: [],
    evidencePassages: selectedPassages,
    evidenceNoteIds: unique(selectedPassages.map(passage => passage.noteId)),
    decisionReasons: ['Event locations were selected only from note passages that support the requested action and target.'],
    instruction: 'Use only the returned event evidence passages and their linked locations.',
  };
};

export type SmallArchiveCandidateExcerpt = {
  noteId: string;
  excerpts: string[];
  score: number;
};

export type SmallArchiveReview = {
  available: boolean;
  mode: 'none' | 'bounded-archive-candidate-review';
  archiveNoteCount: number;
  archiveTextCharacters: number;
  titleNoteIds: string[];
  candidateNoteIds: string[];
  candidateExcerpts: SmallArchiveCandidateExcerpt[];
  instruction: string;
};

export const buildBoundedArchiveReview = (
  memory: NormalizedMemoryRows,
  personalContext: PersonalContextResolution,
): SmallArchiveReview => {
  const searchable = memory.notes.map(note => ({
    id: note.id,
    title: explicitMemoryNoteTitle(note),
    passages: splitPassages(note.content_html || note.content || noteText(note)),
    createdAt: Number(note.created_at_ms || 0),
  })).filter(entry => entry.title.length > 0 || entry.passages.length > 0);
  const characters = searchable.reduce((sum, entry) => (
    sum + entry.title.length + entry.passages.reduce((subtotal, passage) => subtotal + passage.length, 0)
  ), 0);
  const eligible = personalContext.requested
    && personalContext.status === 'not-found'
    && searchable.length > 0;
  if (!eligible) return {
    available: false,
    mode: 'none',
    archiveNoteCount: searchable.length,
    archiveTextCharacters: characters,
    titleNoteIds: [],
    candidateNoteIds: [],
    candidateExcerpts: [],
    instruction: 'No bounded candidate review is available. Do not infer from unrelated memories.',
  };

  const relationTerms = relationDefinitions
    .filter(definition => personalContext.relations.includes(definition.kind))
    .flatMap(definition => [...definition.directEvidence, ...definition.evidenceAliases]);
  const scoreText = (value: string) => {
    const normalizedPassage = normalizeText(value);
    const compact = normalizeCompact(value);
    const targetMatches = personalContext.targetTerms.filter(term => compact.includes(term));
    const actionMatches = matchingAliases(normalizedPassage, personalContext.actionTerms);
    const relationMatches = matchingAliases(normalizedPassage, relationTerms);
    return (targetMatches.length * 6) + (actionMatches.length ? 3 : 0) + (relationMatches.length ? 2 : 0);
  };
  const ranked = searchable.flatMap(entry => {
    const titleScore = entry.title ? scoreText(entry.title) : 0;
    const scored = entry.passages.map(passage => {
      return { text: boundedPassage(passage), score: scoreText(passage) };
    }).filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.text.localeCompare(right.text));
    if (!scored.length && titleScore === 0) return [];
    return [{
      noteId: entry.id,
      excerpts: scored.slice(0, 2).map(item => item.text),
      score: Math.max(titleScore, scored[0]?.score || 0),
      titleScore,
      createdAt: entry.createdAt,
    }];
  }).sort((left, right) => right.score - left.score
    || right.createdAt - left.createdAt
    || left.noteId.localeCompare(right.noteId));

  let usedCharacters = 0;
  const candidateExcerpts: SmallArchiveCandidateExcerpt[] = [];
  for (const candidate of ranked.slice(0, MAX_CANDIDATE_NOTES)) {
    const excerpts = candidate.excerpts.filter(excerpt => {
      if (usedCharacters + excerpt.length > MAX_CANDIDATE_EXCERPT_CHARACTERS) return false;
      usedCharacters += excerpt.length;
      return true;
    });
    if (excerpts.length) candidateExcerpts.push({ noteId: candidate.noteId, excerpts, score: candidate.score });
  }
  return {
    available: true,
    mode: 'bounded-archive-candidate-review',
    archiveNoteCount: searchable.length,
    archiveTextCharacters: characters,
    titleNoteIds: ranked
      .filter(entry => entry.titleScore > 0)
      .slice(0, MAX_CANDIDATE_TITLES)
      .map(entry => entry.noteId),
    candidateNoteIds: candidateExcerpts.map(candidate => candidate.noteId),
    candidateExcerpts,
    instruction: candidateExcerpts.length
      ? 'candidateNotes contains only bounded, ranked excerpts for user review. Candidates are unverified and are not evidence; never answer the requested location from a candidate.'
      : 'No plausible candidate passage matched the requested relation, action, or target. Report that no supporting memory was found and do not describe unrelated records.',
  };
};

// Kept as a compatibility alias for existing imports and external tests.
export const buildSmallArchiveReview = buildBoundedArchiveReview;
