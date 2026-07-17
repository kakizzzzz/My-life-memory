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

/**
 * Extracts only a plausible place phrase from a natural-language memory query.
 * The full user question is never forwarded to the place resolver.
 * @param {unknown} value
 */
export const inferMemoryPlaceHint = value => {
  const source = normalizeQuery(value);
  if (!source || source.length > 240 || /https?:\/\//i.test(source)) return '';
  if (/^-?\d{1,2}(?:\.\d+)?\s*[,，]\s*-?\d{1,3}(?:\.\d+)?$/.test(source)) return '';

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
