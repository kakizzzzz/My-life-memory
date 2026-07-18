import type { NormalizedMemoryRows, NoteRow } from './memory-record-types.ts';
import type { MemoryQueryPlan } from './memory-query-plan.ts';
import { explicitMemoryNoteTitle, type PersonalContextRelation } from './memory-personal-context.ts';
import { noteText } from './memory-presenters.ts';

export type MemorySemanticHints = {
  concepts?: Array<{
    surface: string;
    broadTerms: string[];
  }>;
};

export type ReferenceLabelSource = 'short-title' | 'named-entity' | 'soft-cue' | 'ordinal';

export type InternalMemoryReferenceOption = {
  noteId: string;
  starId: string;
  relation: PersonalContextRelation;
  label: string;
  labelSource: ReferenceLabelSource;
  score: number;
};

const relationCueFamilies = {
  home: [
    '房租', '租金', '房东', '房東', '租约', '租約', '物业', '物業', '水电', '水電', '钥匙', '鑰匙', '搬家',
    'rent', 'landlord', 'lease', 'utilities', 'house key', 'moving home',
    '家賃', '大家', '賃貸', '光熱費', '鍵', '이사', '월세', '집주인', '공과금', '열쇠',
  ],
  work: [
    '工资', '工資', '薪水', '打卡', '工位', '会议', '會議', '门禁卡', '門禁卡', '通勤',
    'salary', 'payroll', 'clock in', 'desk', 'work meeting', 'access card', 'commute',
    '給料', '出勤', '机', '会議', '入館証', '通勤', '급여', '출근', '자리', '회의', '출입증', '통근',
  ],
  study: [
    '学费', '學費', '课程', '課程', '作业', '作業', '考试', '考試', '上课', '上課', '校园卡', '校園卡',
    'tuition', 'coursework', 'homework', 'exam', 'class', 'student card',
    '学費', '授業', '宿題', '試験', '学生証', '수업료', '수업', '과제', '시험', '학생증',
  ],
} as const;

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const compact = (value: unknown) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, '');
const escapedRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latinPhrase = (value: string) => /^[\p{Script=Latin}\p{N}\s'-]+$/u.test(value);

const includesTerm = (source: string, term: string) => {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  if (!latinPhrase(normalizedTerm)) return compact(source).includes(compact(normalizedTerm));
  const phrase = escapedRegex(normalizedTerm).replace(/ /g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(source);
};

const unique = <T,>(values: T[]) => [...new Set(values)];

const normalizedClue = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const unsafeCluePattern = /(?:https?:\/\/|www\.|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?:\+?\d[\d\s().-]{6,}\d)|[-+]?\d{1,3}\.\d{3,}\s*[,，]\s*[-+]?\d{1,3}\.\d{3,}|\d{5,})/iu;
const addressCluePattern = /(?:\d+\s*(?:号|號|栋|棟|室|楼|樓|单元|單元|丁目|番地|길|로)|\d+\s+(?:[\p{L}\p{N}.'-]+\s+){1,4}(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?)\b|(?:省|市|区|區|县|縣|镇|鎮|乡|鄉|村|街道|街|路|巷|弄|丁目|番地|都|府|県|市|区|町|村|동|구|시)\s*\d+)/iu;

const safeClue = (value: unknown) => {
  const clue = normalizedClue(value);
  const length = [...clue].length;
  if (length < 1 || length > 12) return '';
  if (unsafeCluePattern.test(clue) || addressCluePattern.test(clue)) return '';
  return clue;
};

const queryLanguage = (query: string) => {
  if (/\p{Script=Hangul}/u.test(query)) return 'ko';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return 'ja';
  if (/\p{Script=Han}/u.test(query)) return 'zh';
  return 'en';
};

const neutralOptionLabel = (
  query: string,
  relation: PersonalContextRelation,
  index: number,
) => {
  const language = queryLanguage(query);
  const number = index + 1;
  const anchor = relation === 'home' || relation === 'work' || relation === 'study';
  if (language === 'zh') return `${anchor ? '可能的位置' : '可能的记录'} ${number}`;
  if (language === 'ja') return `${anchor ? '場所の候補' : '記録の候補'} ${number}`;
  if (language === 'ko') return `${anchor ? '가능한 장소' : '가능한 기록'} ${number}`;
  return `${anchor ? 'Possible location' : 'Possible record'} ${number}`;
};

const softCueOptionLabel = (query: string, cue: string) => {
  const language = queryLanguage(query);
  if (language === 'zh') return `${cue}相关记录`;
  if (language === 'ja') return `「${cue}」に関する記録`;
  if (language === 'ko') return `${cue} 관련 기록`;
  return `Record related to ${cue}`;
};

const safeHintTerms = (hints: MemorySemanticHints | null | undefined) => unique(
  (Array.isArray(hints?.concepts) ? hints.concepts : []).flatMap(concept => [
    String(concept?.surface || ''),
    ...(Array.isArray(concept?.broadTerms) ? concept.broadTerms : []),
  ]).map(normalize).filter(term => term.length > 0 && term.length <= 48),
).slice(0, 24);

const namedEntityLabel = (note: NoteRow) => {
  const namedSource = `${note.title} ${note.content}`;
  return safeClue(namedSource.match(/(?:叫|名叫|昵称(?:是|为)?|暱稱(?:是|為)?|called|named|nickname(?:d)?|名前は|という|이름은|라고\s*불)[：:\s"“”'‘’「」『』]*([\p{L}\p{N}][\p{L}\p{N}\s·・_-]{0,22})/iu)?.[1] || '');
};

const shortTitleLabel = (note: NoteRow) => safeClue(explicitMemoryNoteTitle(note));

const candidateRelation = (plan: MemoryQueryPlan): PersonalContextRelation => (
  plan.anchorRelations[0]
  || plan.eventRelations[0]
  || 'activity'
);

const matchingSoftCues = (plan: MemoryQueryPlan, source: string) => plan.anchorRelations.flatMap(relation => (
  relationCueFamilies[relation].filter(cue => includesTerm(source, cue))
));

export const buildMemoryReferenceOptions = ({
  memory,
  queryPlan,
  semanticHints,
  allowedNoteIds,
}: {
  memory: NormalizedMemoryRows;
  queryPlan: MemoryQueryPlan;
  semanticHints?: MemorySemanticHints | null;
  allowedNoteIds?: Iterable<string> | null;
}): InternalMemoryReferenceOption[] => {
  const targetTerms = unique(queryPlan.targetTerms.map(normalize).filter(Boolean));
  const hintTerms = safeHintTerms(semanticHints);
  const relation = candidateRelation(queryPlan);
  const allowed = allowedNoteIds ? new Set(allowedNoteIds) : null;
  const resolvingAnchor = queryPlan.anchorRelations.length > 0;
  const allowNamedFallback = !resolvingAnchor && (
    queryPlan.referenceIntent.deictic
    || queryPlan.utteranceMode === 'reference-statement'
    || queryPlan.utteranceMode === 'follow-up'
  );
  const candidates = memory.notes.flatMap(note => {
    if (allowed && !allowed.has(note.id)) return [];
    const title = explicitMemoryNoteTitle(note);
    const body = noteText(note);
    const source = normalize(`${title} ${body}`);
    const targetMatches = targetTerms.filter(term => includesTerm(source, term));
    const hintMatches = hintTerms.filter(term => includesTerm(source, term));
    const cueMatches = matchingSoftCues(queryPlan, source);
    const named = namedEntityLabel(note);
    const shortTitle = shortTitleLabel(note);
    const titleFallback = allowNamedFallback && shortTitle;
    if (resolvingAnchor && !cueMatches.length) return [];
    if (!resolvingAnchor
      && !targetMatches.length
      && !hintMatches.length
      && !(allowNamedFallback && named)
      && !titleFallback) return [];
    const actionMatches = queryPlan.actionTerms.filter(term => includesTerm(source, term));
    const score = (targetMatches.length * 12)
      + (hintMatches.length * 7)
      + (cueMatches.length * 5)
      + (actionMatches.length * 3)
      + Number(Boolean(allowNamedFallback && named)) * 2
      + Number(Boolean(titleFallback))
      + Number(title.length > 0 && [...targetMatches, ...hintMatches, ...cueMatches].some(term => includesTerm(title, term))) * 2;
    const anchor = relation === 'home' || relation === 'work' || relation === 'study';
    const label = anchor && cueMatches[0]
      ? softCueOptionLabel(queryPlan.originalQuery, cueMatches[0])
      : named || shortTitle;
    const labelSource: ReferenceLabelSource = anchor && cueMatches[0]
      ? 'soft-cue'
      : named
        ? 'named-entity'
        : shortTitle
          ? 'short-title'
          : 'ordinal';
    return [{
      noteId: note.id,
      starId: note.star_id,
      relation,
      label,
      labelSource,
      score,
      createdAt: note.created_at_ms ?? 0,
    }];
  }).sort((left, right) => right.score - left.score
    || right.createdAt - left.createdAt
    || left.noteId.localeCompare(right.noteId));

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const anchor = candidate.relation === 'home'
      || candidate.relation === 'work'
      || candidate.relation === 'study';
    const key = anchor
      ? `${candidate.starId}:${candidate.relation}`
      : `${candidate.noteId}:${candidate.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4).map((candidate, index) => ({
    noteId: candidate.noteId,
    starId: candidate.starId,
    relation: candidate.relation,
    score: candidate.score,
    label: candidate.label || neutralOptionLabel(queryPlan.originalQuery, candidate.relation, index),
    labelSource: candidate.label ? candidate.labelSource : 'ordinal',
  }));
};

const quotedLabels = (labels: string[], language: ReturnType<typeof queryLanguage>) => {
  const bounded = labels.slice(0, 4);
  if (language === 'en') return bounded.map(label => `“${label}”`).join(bounded.length > 2 ? ', ' : ' or ');
  if (language === 'ja') return bounded.map(label => `「${label}」`).join('、');
  if (language === 'ko') return bounded.map(label => `“${label}”`).join(', ');
  return bounded.map(label => `“${label}”`).join('、');
};

export const buildMemoryReferenceQuestion = (query: string, labels: string[]) => {
  const language = queryLanguage(query);
  const options = quotedLabels(labels, language);
  const single = labels.length === 1;
  if (language === 'zh') return single
    ? `你说的是与${options}这条记录关联的位置吗？如果是，请确认；如果不是，可以补充大致时间、地点、标题词、对象名称，或当时的活动。`
    : `你说的是${options}其中一条记录关联的位置吗？请选择一个；如果都不是，可以补充大致时间、地点、标题词、对象名称，或当时的活动。`;
  if (language === 'ja') return single
    ? `${options}の記録に結び付いた場所を指していますか。そうなら確認してください。違う場合は、時期、場所、タイトルの言葉、対象名、または当時の行動を追加してください。`
    : `${options}のどの記録に結び付いた場所を指していますか。一つ選んでください。どれでもない場合は、時期、場所、タイトルの言葉、対象名、または当時の行動を追加してください。`;
  if (language === 'ko') return single
    ? `${options} 기록과 연결된 장소를 뜻하나요? 맞다면 확인해 주세요. 아니라면 대략적인 시간, 장소, 제목 단어, 대상 이름 또는 당시 활동을 더 알려 주세요.`
    : `${options} 중 어느 기록과 연결된 장소를 뜻하나요? 하나를 선택해 주세요. 모두 아니라면 대략적인 시간, 장소, 제목 단어, 대상 이름 또는 당시 활동을 더 알려 주세요.`;
  return single
    ? `Do you mean the location linked to the ${options} record? Confirm it, or add an approximate time, place, title word, object name, or activity.`
    : `Which location do you mean: the record labelled ${options}? Choose one, or add an approximate time, place, title word, object name, or activity.`;
};

export const buildMemoryReferenceRefinementQuestion = (query: string) => {
  const language = queryLanguage(query);
  if (language === 'zh') return '这条线索还不能确定你指的是哪段记忆。请补充大致时间、地点、标题词、对象名称，或当时的活动。';
  if (language === 'ja') return 'この手掛かりだけでは、どの記憶を指すか確認できません。おおよその時期、場所、タイトルの言葉、対象名、または当時の行動を追加してください。';
  if (language === 'ko') return '이 단서만으로는 어떤 기억을 뜻하는지 확인할 수 없습니다. 대략적인 시간, 장소, 제목 단어, 대상 이름 또는 당시 활동을 더 알려 주세요.';
  return 'This clue is not enough to identify the intended memory. Add an approximate time, place, title word, object name, or activity.';
};
