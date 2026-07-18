import {
  analyzePersonalContextQuery,
  type PersonalAnchorRelation,
  type PersonalEventRelation,
} from './memory-personal-context.ts';
import { inferMemoryPlaceHint } from './mcp-query-routing.mjs';

export type MemoryQueryDateRange = {
  dateFrom: string;
  dateTo: string;
  precision: 'day' | 'month' | 'year' | 'explicit-range';
  sourceText: string;
  matchedText: string;
};

export type MemoryQueryPlan = {
  originalQuery: string;
  utteranceMode: 'direct-question' | 'reference-statement' | 'follow-up' | 'correction';
  referenceIntent: {
    deictic: boolean;
    targetSurface: string | null;
    evaluativePredicate: string | null;
  };
  publicPlace: {
    value: string;
    source: 'explicit-argument' | 'query-span';
  } | null;
  anchorRelations: PersonalAnchorRelation[];
  eventRelations: PersonalEventRelation[];
  targetTerms: string[];
  actionTerms: string[];
  spatialRelation: 'exact' | 'nearby' | 'within-radius' | 'none';
  routeIntent: boolean;
  imageIntent: boolean;
  answerIntent: 'locate' | 'list' | 'summarize' | 'classify' | 'compare';
  dateRange: MemoryQueryDateRange | null;
  relativeTimeNeedsResolution: boolean;
};

const datePart = (value: number) => String(value).padStart(2, '0');
const cleanMatchedDateText = (value: string) => value
  .replace(/^[^\d]+/u, '')
  .replace(/[^\d年月日号號년\-/.]+$/u, '')
  .trim();

export const inferMemoryQueryDateRange = (value: string): MemoryQueryDateRange | null => {
  const source = String(value || '').normalize('NFKC');
  const dayMatch = source.match(/(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日|号|號)?(?:[^\d]|$)/u);
  if (dayMatch) {
    const year = Number(dayMatch[1]);
    const month = Number(dayMatch[2]);
    const day = Number(dayMatch[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      const date = `${year}-${datePart(month)}-${datePart(day)}`;
      const sourceText = cleanMatchedDateText(dayMatch[0]);
      return { dateFrom: date, dateTo: date, precision: 'day', sourceText, matchedText: sourceText };
    }
  }
  const monthMatch = source.match(/(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月)?(?:[^\d]|$)/u);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month >= 1 && month <= 12) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const sourceText = cleanMatchedDateText(monthMatch[0]);
      return {
        dateFrom: `${year}-${datePart(month)}-01`,
        dateTo: `${year}-${datePart(month)}-${datePart(lastDay)}`,
        precision: 'month',
        sourceText,
        matchedText: sourceText,
      };
    }
  }
  const yearMatch = source.match(/(?:^|[^\d])((?:19|20)\d{2})\s*(?:年|년|\b)/u);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const sourceText = cleanMatchedDateText(yearMatch[0]);
  return {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    precision: 'year',
    sourceText,
    matchedText: sourceText,
  };
};

const relativeTimePattern = /(?:今天|今日|昨天|昨日|前天|这几天|這幾天|最近|刚才|剛才|本周|這週|这周|上周|上週|本月|上月|今年|去年|前年|(?:几|幾|十几|十幾|\d+)\s*(?:天|日|周|週|星期|个月|個月|月|年)前|today|yesterday|the day before yesterday|recently|this week|last week|this month|last month|this year|last year|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|several|\d+)\s+(?:days?|weeks?|months?|years?)\s+ago|今日|昨日|一昨日|最近|今週|先週|今月|先月|今年|去年|(?:数|十数|\d+)\s*(?:日|週間|か月|ヶ月|年)前|오늘|어제|그저께|최근|이번 주|지난주|이번 달|지난달|올해|작년|(?:여러|\d+)\s*(?:일|주|개월|달|년)\s*전)/iu;

const routeIntentPattern = /(?:路线|路線|轨迹|軌跡|走过|走過|跑步|骑行|騎行|route|track|walked|walking|ran|running|cycled|cycling|経路|ルート|歩いた|走った|경로|이동|걸었|달렸)/iu;
const routeTargetNoise = /^(?:走|走过|走過|跑步|骑行|騎行|路线|路線|轨迹|軌跡|route|track|walk|walked|walking|run|ran|running|cycle|cycled|cycling|経路|ルート|歩いた|走った|경로|이동|걸었|달렸)$/iu;
const imageIntentPattern = /(?:图片|圖像|照片|相片|影像|拍的|photo|image|picture|photograph|写真|画像|사진|이미지)/iu;
const deicticPattern = /(?:那个|那個|这个|這個|那只|那隻|这只|這隻|那里|那裡|\b(?:that|this)\s+[\p{L}\p{N}'-]{1,32}\b|あの|その|그곳|그\s*[\p{L}\p{N}]{1,16}|그것|저곳|저\s*장소)/iu;
const questionShapePattern = /[?？]|(?:哪里|哪裡|哪儿|哪兒|在哪|在哪里|在哪裡|什么|什麼|哪些|where|what|which|どこ|何|어디|무엇)/iu;
const correctionPattern = /(?:不是|不对|不對|我说的是|我說的是|更正|no[,，]?\s*i mean|not that|correction|違う|そうではなく|아니|내가 말한 건)/iu;
const followUpPattern = /^(?:是|对|對|没错|沒錯|不是|都不是|第[一二三四\d]+个|第[一二三四\d]+個|yes|no|that one|none|the first|the second|そう|違う|どれでもない|맞아|아니|둘 다 아니)/iu;
const evaluativePredicatePattern = /(?:很有趣|有趣|很漂亮|漂亮|很好看|好看|很特别|很特別|喜欢|喜歡|interesting|beautiful|pretty|special|memorable|liked|favorite|favourite|面白い|きれい|綺麗|特別|好き|재미있|예쁘|특별|좋아)/iu;

const utteranceModeFor = (query: string): MemoryQueryPlan['utteranceMode'] => {
  if (correctionPattern.test(query)) return 'correction';
  if (followUpPattern.test(query.trim())) return 'follow-up';
  if (deicticPattern.test(query) && !questionShapePattern.test(query)) return 'reference-statement';
  return 'direct-question';
};

const answerIntentFor = (query: string): MemoryQueryPlan['answerIntent'] => {
  if (/(?:比较|對比|相比|difference|compare|versus|比較|비교)/iu.test(query)) return 'compare';
  if (/(?:旅行还是日常|旅行還是日常|travel or daily|trip or routine|分類|分类|분류)/iu.test(query)) return 'classify';
  if (/(?:总结|總結|概括|整理|summary|summarize|要約|정리|요약)/iu.test(query)) return 'summarize';
  if (/(?:哪里|哪裡|哪儿|哪兒|在哪|在哪里|在哪裡|在哪儿|在哪兒|何处|何處|位置|地点|地點|where|location|どこ|場所|어디|곳)/iu.test(query)) return 'locate';
  return 'list';
};

export const buildMemoryQueryPlan = ({
  query,
  publicPlace = '',
  publicPlaceSource = 'explicit-argument',
  dateFrom = '',
  dateTo = '',
  radiusProvided = false,
}: {
  query: string;
  publicPlace?: string;
  publicPlaceSource?: 'explicit-argument' | 'query-span';
  dateFrom?: string;
  dateTo?: string;
  radiusProvided?: boolean;
}): MemoryQueryPlan => {
  const originalQuery = String(query || '').trim();
  const inferred = inferMemoryQueryDateRange(originalQuery);
  const suppliedPublicPlace = publicPlace.trim();
  const inferredPublicPlace = suppliedPublicPlace || inferMemoryPlaceHint(originalQuery);
  const targetQuery = [inferred?.sourceText, inferredPublicPlace]
    .filter(Boolean)
    .reduce<string>((source, term) => source.split(String(term)).join(' '), originalQuery);
  const personal = analyzePersonalContextQuery(originalQuery);
  const targetIntent = analyzePersonalContextQuery(targetQuery);
  const explicitRange = dateFrom || dateTo ? {
    dateFrom,
    dateTo,
    precision: 'explicit-range' as const,
    sourceText: 'dateFrom/dateTo',
    matchedText: 'dateFrom/dateTo',
  } : null;
  const dateRange = explicitRange || inferred;
  const routeIntent = routeIntentPattern.test(originalQuery);
  const targetTerms = routeIntent
    ? targetIntent.targetTerms.filter(term => !routeTargetNoise.test(term))
    : targetIntent.targetTerms;
  const evaluativePredicate = originalQuery.match(evaluativePredicatePattern)?.[0] || null;
  const spatialRelation = personal.proximityRequested
    ? 'nearby'
    : radiusProvided
      ? 'within-radius'
      : personal.anchorRelations.length
        ? 'exact'
        : 'none';
  return {
    originalQuery,
    utteranceMode: utteranceModeFor(originalQuery),
    referenceIntent: {
      deictic: deicticPattern.test(originalQuery),
      targetSurface: targetTerms[0] || null,
      evaluativePredicate,
    },
    publicPlace: inferredPublicPlace
      ? { value: inferredPublicPlace, source: suppliedPublicPlace ? publicPlaceSource : 'query-span' }
      : null,
    anchorRelations: personal.anchorRelations,
    eventRelations: personal.eventRelations,
    targetTerms,
    actionTerms: personal.actionTerms,
    spatialRelation,
    routeIntent,
    imageIntent: imageIntentPattern.test(originalQuery),
    answerIntent: answerIntentFor(originalQuery),
    dateRange,
    relativeTimeNeedsResolution: !dateRange && relativeTimePattern.test(originalQuery),
  };
};
