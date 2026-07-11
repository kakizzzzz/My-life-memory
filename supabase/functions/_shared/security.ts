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
const rateLimitFallbackWarnings = new Set<string>();

type RuntimeWithDeno = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
};

const readServerEnv = (name: string) => (
  (globalThis as RuntimeWithDeno).Deno?.env?.get?.(name) || ''
);

const getAllowedOrigins = () => {
  const configured = readServerEnv('ALLOWED_ORIGINS')
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

const MCP_ACCESS_TOKEN_PATTERN = /^mlm_[0-9a-f]{64}$/;

export const parseMcpAccessToken = (authorization: string) => {
  const value = authorization.trim();
  const bearerValue = value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';

  if (MCP_ACCESS_TOKEN_PATTERN.test(bearerValue)) return bearerValue;
  if (MCP_ACCESS_TOKEN_PATTERN.test(value)) return value;
  return '';
};

const hitMemoryRateLimit = (key: string, limit: number, windowMs: number) => {
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

const warnRateLimitFallback = (reason: string) => {
  if (rateLimitFallbackWarnings.has(reason)) return;
  rateLimitFallbackWarnings.add(reason);
  console.warn(JSON.stringify({
    event: 'edge_rate_limit_fallback',
    reason,
    message: 'Durable rate limiting is unavailable; this function instance is using its in-memory limiter.',
  }));
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const hitRateLimit = async (key: string, limit: number, windowMs: number) => {
  const supabaseUrl = readServerEnv('SUPABASE_URL');
  const serviceRoleKey = readServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    warnRateLimitFallback('missing_server_environment');
    return hitMemoryRateLimit(key, limit, windowMs);
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_edge_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_key_hash: await sha256Hex(key),
        p_limit: limit,
        p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
      }),
    });
    if (!response.ok) {
      warnRateLimitFallback(`rpc_http_${response.status}`);
      return hitMemoryRateLimit(key, limit, windowMs);
    }
    const payload = await response.json();
    const result = Array.isArray(payload) ? payload[0] : payload;
    if (!result || typeof result.limited !== 'boolean') {
      warnRateLimitFallback('rpc_invalid_payload');
      return hitMemoryRateLimit(key, limit, windowMs);
    }
    return {
      limited: result.limited,
      retryAfterSeconds: Math.max(1, Number(result.retry_after_seconds) || Math.ceil(windowMs / 1000)),
    };
  } catch {
    warnRateLimitFallback('rpc_request_failed');
    return hitMemoryRateLimit(key, limit, windowMs);
  }
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
  if (lowered.startsWith('data:')) return /^data:image\/(?:jpeg|jpg|png|webp|gif);/i.test(lowered);
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

    const sourceTag = match[1].toLowerCase();
    // Safari contenteditable emits DIV for paragraphs. Persist the same safe
    // structure as the browser sanitizer instead of joining adjacent lines.
    const tag = sourceTag === 'div' ? 'p' : sourceTag;
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
