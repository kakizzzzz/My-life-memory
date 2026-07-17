const normalizeQuery = value => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const cjkNoise = [
  '帮我评价一下', '幫我評價一下', '帮我分析一下', '幫我分析一下',
  '帮我看看', '幫我看看', '旅行的记录', '旅行的記錄', '旅游的记录', '旅遊的記錄',
  '旅行记录', '旅行記錄', '旅游记录', '旅遊記錄', '评价一下', '評價一下',
  '分析一下', '我在', '我去', '我到', '我从', '我從', '关于', '關於',
  '有关', '有關', '那次', '这次', '這次', '那趟', '这趟', '這趟',
  '请', '請', '看看', '查看', '查找', '搜索', '搜尋',
  '旅行', '旅游', '旅遊', '出游', '出遊', '度假', '行程', '游记', '遊記',
  '记录', '記錄', '记忆', '記憶', '笔记', '筆記', '照片', '相片', '路线', '路線',
  '評価して', '分析して', '見せて', '旅行', '観光', '記録', '思い出', '写真', 'ルート',
  '평가해줘', '분석해줘', '보여줘', '여행', '관광', '기록', '추억', '사진', '경로',
].sort((left, right) => right.length - left.length);

const englishNoise = /\b(?:please|show|find|search|look|review|evaluate|analyse|analyze|tell|about|my|memories?|records?|notes?|photos?|routes?|trip|travel|travels|vacation|holiday|journey|visit|visited|was|is|were|are|a|an|the|to|in|at|from|around|near|during|time|part|of|daily|life|or|and)\b/gi;

const locationIntent = /旅行|旅游|旅遊|出游|出遊|度假|行程|游记|遊記|観光|여행|관광|\b(?:trip|travel|vacation|holiday|journey|visit|visited|to|in|at|from|near|around)\b/i;

const personalIdentityIntent = /我家|我的家|家附近|住处|住處|住所|居住地|我住的地方|我住在|我工作|工作的地方|工作地点|工作地點|上班的地方|上班地点|上班地點|公司附近|办公室附近|辦公室附近|我学习|我學習|学习的地方|學習的地方|上学的地方|上學的地方|学校附近|學校附近|校园附近|校園附近|\b(?:my home|near home|where i live|my residence|where i work|my workplace|near my office|where i study|my school|near my school)\b|自宅|家の近く|住んでいる場所|仕事場|職場|勉強する場所|学校の近く|우리 집|집 근처|사는 곳|직장|회사 근처|학교 근처|공부하는 곳/i;
const personalEventIntent = /(?:我|本人).{0,32}(?:看到|看见|看見|见到|見到|遇见|遇見|遇到|发现|發現|拍到|做|制作|製作|参加|參加|体验|體驗|吃|喝|运动|運動|锻炼|鍛鍊|跑步|散步|买|買|购物|購物|玩|游玩|遊玩|参观|參觀|拍摄|拍攝).{0,32}(?:地方|地点|地點|位置|哪里|哪裡|哪儿|哪兒|附近)|\bwhere i (?:saw|met|found|spotted|photographed|did|made|created|ate|dined|drank|exercised|ran|walked|shopped|played|visited)\b|(?:見た|見つけた|出会った|体験した|食べた|飲んだ|訪れた)場所|(?:본|만난|발견한|한|먹은|마신|방문한) 곳/i;
const privatePlaceCandidate = /^(?:家|我家|住处|住處|住所|公司|单位|單位|办公室|辦公室|学校|學校|校园|校園|home|my home|office|my office|workplace|school|my school|自宅|職場|学校|우리 집|직장|학교)$/i;
const cjkEventAction = '看到|看见|看見|见到|見到|遇见|遇見|遇到|发现|發現|拍到|目睹|做|制作|製作|参加|參加|体验|體驗|吃|喝|运动|運動|锻炼|鍛鍊|跑步|散步|买|買|购物|購物|玩|游玩|遊玩|参观|參觀|拍摄|拍攝';
const personalEventLocationShape = new RegExp(`(?:在|于|於)\\s*[\\p{L}\\p{N}·.' -]{1,80}?\\s*(?:${cjkEventAction})`, 'u');

const cleanExplicitPlace = value => String(value || '')
  .replace(/^(?:the\s+)?/i, '')
  .replace(/(?:旅行|旅游|旅遊|那次|这次|這次)$/u, '')
  .replace(/^[\s，,、]+|[\s，,、]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const inferExplicitPlaceFromPersonalEvent = value => {
  const source = normalizeQuery(value);
  if (!source) return '';
  const cjk = source.match(new RegExp(`(?:在|于|於)\\s*([\\p{L}\\p{N}·.' -]{1,80}?)\\s*(?:${cjkEventAction})`, 'u'));
  const english = source.match(/\b(?:in|at)\s+([\p{L}\p{N}·.' -]{2,80}?)\s+(?:i\s+)?(?:saw|met|found|spotted|photographed|did|made|created|ate|dined|drank|exercised|ran|walked|shopped|played|visited)\b/iu);
  const japanese = source.match(/([\p{L}\p{N}·.' -]{1,60}?)で(?:見た|見つけた|出会った|体験した|食べた|飲んだ|訪れた)/u);
  const korean = source.match(/([\p{L}\p{N}·.' -]{1,60}?)에서(?:\s*)(?:봤|보았|만났|발견|했|먹|마셨|방문)/u);
  const candidate = cleanExplicitPlace(cjk?.[1] || english?.[1] || japanese?.[1] || korean?.[1] || '');
  if (!candidate || candidate.length > 80 || privatePlaceCandidate.test(candidate)) return '';
  return candidate;
};

export const isPersonalMemoryContextQuery = value => {
  const source = normalizeQuery(value);
  return Boolean(source && (
    personalIdentityIntent.test(source)
    || personalEventIntent.test(source)
    || personalEventLocationShape.test(source)
    || inferExplicitPlaceFromPersonalEvent(source)
  ));
};

/**
 * Extracts only a plausible place phrase from a natural-language memory query.
 * The full user question is never forwarded to the place resolver.
 * @param {unknown} value
 */
export const inferMemoryPlaceHint = value => {
  const source = normalizeQuery(value);
  if (!source || source.length > 240 || /https?:\/\//i.test(source)) return '';
  if (/^-?\d{1,2}(?:\.\d+)?\s*[,，]\s*-?\d{1,3}(?:\.\d+)?$/.test(source)) return '';
  if (isPersonalMemoryContextQuery(source)) return inferExplicitPlaceFromPersonalEvent(source);

  const hadLocationIntent = locationIntent.test(source);
  let candidate = source.replace(/["'“”‘’「」『』【】\[\]()（）]/g, ' ');
  cjkNoise.forEach(fragment => {
    candidate = candidate.split(fragment).join(' ');
  });
  candidate = candidate
    .replace(englishNoise, ' ')
    .replace(/[!?！？。；;：:，,、]/g, ' ')
    .replace(/^(?:(?:在|去|到|从|從|于|於|で|へ|から|에서|으로)\s*)+/u, '')
    .replace(/(?:\s*(?:的|里|中|附近|那次|这次|這次|时候|時候|の|에서))+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  const compact = candidate.replace(/[^\p{L}\p{N}]+/gu, '');
  if (compact.length < 2 || candidate.length > 80 || /^\d+$/u.test(compact)) return '';
  if (!hadLocationIntent && candidate.split(/\s+/).length > 4) return '';
  return candidate;
};

/** @param {unknown} payload @param {unknown} input */
export const shouldUseContextualSearchFallback = (payload, input) => {
  const query = normalizeQuery(input && typeof input === 'object' ? input.query : '');
  const count = Number(payload && typeof payload === 'object' ? payload.count : Number.NaN);
  return Boolean(query) && Number.isFinite(count) && count === 0;
};

/** @param {Record<string, unknown>} input */
export const contextualSearchInput = input => {
  const query = normalizeQuery(input.query);
  const place = inferMemoryPlaceHint(query);
  return {
    query,
    ...(place ? { place } : {}),
    ...(typeof input.dateFrom === 'string' && input.dateFrom ? { dateFrom: input.dateFrom } : {}),
    ...(typeof input.dateTo === 'string' && input.dateTo ? { dateTo: input.dateTo } : {}),
    limit: Math.min(100, Math.max(1, Number(input.limit) || 20)),
  };
};

/**
 * Keeps the public tool identity while making the automatic research step explicit.
 * @param {Record<string, unknown>} exact
 * @param {Record<string, unknown>} contextual
 * @returns {Record<string, unknown> & {
 *   action: string;
 *   requestedAction: string;
 *   resolvedAction: string;
 *   retrievalMode: string;
 *   exactSearch: { query: string; count: number };
 * }}
 */
export const mergeContextualSearchFallback = (exact, contextual) => ({
  ...contextual,
  action: 'search_memories',
  requestedAction: 'search_memories',
  resolvedAction: 'research_memory_context',
  retrievalMode: 'contextual-research-fallback',
  exactSearch: {
    query: normalizeQuery(exact.query),
    count: Math.max(0, Number(exact.count) || 0),
  },
});
