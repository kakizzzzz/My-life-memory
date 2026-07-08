// @ts-nocheck
const DEFAULT_ALLOWED_ORIGINS = [
  'https://kakizzzzz.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
];

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

const getAllowedOrigins = () => {
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
};

export const isOriginAllowed = (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};

export const createCorsHeaders = (
  request: Request,
  methods = 'POST, OPTIONS',
  headers = 'authorization, x-client-info, apikey, content-type',
  exposeHeaders = '',
) => {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '';
  const output: Record<string, string> = {
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Allow-Methods': methods,
  };

  if (allowedOrigin) output['Access-Control-Allow-Origin'] = allowedOrigin;
  if (origin) output.Vary = 'Origin';
  if (exposeHeaders) output['Access-Control-Expose-Headers'] = exposeHeaders;

  return output;
};

export const forbiddenOriginResponse = () => (
  new Response(JSON.stringify({
    error: {
      code: 'origin_not_allowed',
      message: 'This origin is not allowed.',
    },
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
);

export const clientIp = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const firstForwarded = forwarded.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip') ||
    firstForwarded ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
};

export const tokenPrefix = (value: string) => (
  value ? value.slice(0, 12) : 'none'
);

export const hitRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  rateBuckets.set(key, bucket);

  return {
    limited: bucket.count > limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
};

export const rateLimitResponse = (corsHeaders: Record<string, string>, retryAfterSeconds: number) => (
  new Response(JSON.stringify({
    error: {
      code: 'rate_limited',
      message: 'Too many requests. Please try again later.',
    },
  }), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
    },
  })
);

const escapeHtml = (value: string) => (
  value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
);

const allowedTags = new Set(['p', 'br', 'span', 'u', 'figure', 'img']);
const blockedTagPattern = /<\/?(script|style|iframe|object|embed|link|meta|svg|math)\b[^>]*>/gi;
const blockedTagWithContentPattern = /<(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\/\1>/gi;
const attrPattern = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const safeMediaAttrPattern = /^data-media-[a-z0-9-]+$/i;

const getAttrValue = (attrs: string, name: string) => {
  attrPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrs)) !== null) {
    if (match[1].toLowerCase() === name.toLowerCase()) {
      return match[2] ?? match[3] ?? match[4] ?? '';
    }
  }
  return '';
};

const safeAttr = (name: string, value: string) => (
  `${name}="${escapeHtml(value).slice(0, 1024)}"`
);

const isSafeImageSrc = (src: string) => {
  const trimmed = src.trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed || lowered.startsWith('javascript:')) return false;
  if (lowered.startsWith('data:')) return lowered.startsWith('data:image/');
  if (lowered.startsWith('storage://')) return true;
  if (lowered.startsWith('http://') || lowered.startsWith('https://') || lowered.startsWith('blob:')) return true;
  return false;
};

const sanitizeStyle = (attrs: string) => {
  const style = getAttrValue(attrs, 'style');
  if (!style) return '';

  const safeRules: string[] = [];
  style.split(';').forEach(rule => {
    const [rawProperty, ...rawValueParts] = rule.split(':');
    const property = rawProperty?.trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    if (!property || !value || /url|expression|javascript/i.test(value)) return;

    if (property === 'color' && (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([0-9,\s.]+\)$/i.test(value))) {
      safeRules.push(`color:${value}`);
    }

    if (property === 'font-size') {
      const match = value.match(/^(\d{1,2}(?:\.\d{1,2})?)px$/i);
      const size = match ? Number(match[1]) : Number.NaN;
      if (Number.isFinite(size) && size >= 8 && size <= 72) safeRules.push(`font-size:${size}px`);
    }

    if (property === 'text-decoration-line' && /^(underline|none)(\s+(underline|none))*$/i.test(value)) {
      safeRules.push(`text-decoration-line:${value.toLowerCase()}`);
    }
  });

  return safeRules.length ? ` style="${safeRules.join(';')}"` : '';
};

const sanitizeOpeningTag = (tag: string, attrs: string) => {
  if (tag === 'br') return '<br>';
  if (tag === 'figure') return '<figure class="note-inline-image" contenteditable="false" data-note-image="true">';
  if (tag === 'img') {
    const src = getAttrValue(attrs, 'src');
    if (!isSafeImageSrc(src)) return '';
    const safeAttrs = [safeAttr('src', src.trim())];
    const alt = getAttrValue(attrs, 'alt');
    if (alt) safeAttrs.push(safeAttr('alt', alt.slice(0, 240)));

    attrPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(attrs)) !== null) {
      const name = match[1].toLowerCase();
      if (safeMediaAttrPattern.test(name)) {
        safeAttrs.push(safeAttr(name, match[2] ?? match[3] ?? match[4] ?? ''));
      }
    }
    return `<img ${safeAttrs.join(' ')}>`;
  }

  return `<${tag}${sanitizeStyle(attrs)}>`;
};

export const sanitizeRichHtml = (html: unknown) => {
  if (typeof html !== 'string' || !html) return '';

  const withoutBlocked = html
    .replace(blockedTagWithContentPattern, '')
    .replace(blockedTagPattern, '');
  let output = '';
  let cursor = 0;
  const tagPattern = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(withoutBlocked)) !== null) {
    output += escapeHtml(withoutBlocked.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');
    if (!allowedTags.has(tag)) continue;
    if (isClosing) {
      if (tag !== 'br' && tag !== 'img') output += `</${tag}>`;
      continue;
    }
    output += sanitizeOpeningTag(tag, match[2] || '');
  }

  output += escapeHtml(withoutBlocked.slice(cursor));
  return output;
};

const HTML_FIELD_KEYS = new Set(['titleHtml', 'contentHtml']);

export const sanitizeHtmlFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => sanitizeHtmlFields(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    sanitized[key] = HTML_FIELD_KEYS.has(key) && typeof entry === 'string'
      ? sanitizeRichHtml(entry)
      : sanitizeHtmlFields(entry);
  });
  return sanitized;
};
