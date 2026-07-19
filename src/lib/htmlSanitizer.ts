import { normalizeRichTextSpans } from './richTextStyleSession';

const ALLOWED_RICH_TAGS = new Set(['P', 'BR', 'SPAN', 'U', 'FIGURE', 'IMG']);
const BLOCKED_RICH_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH']);
const SAFE_MEDIA_DATA_ATTR = /^data-media-[a-z0-9-]+$/i;
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);
const HTML_FIELD_KEYS = new Set(['titleHtml', 'contentHtml']);

const isSafeImageSrc = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('javascript:')) return false;
  if (lowered.startsWith('data:')) {
    return /^data:image\/(?:jpeg|jpg|png|webp|gif);/i.test(lowered);
  }
  if (lowered.startsWith('storage://')) return true;

  try {
    const origin = window.location.origin;
    const parsed = origin && origin !== 'null'
      ? new URL(trimmed, origin)
      : new URL(trimmed);
    return SAFE_IMAGE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
};

const sanitizeCssColor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || /url|expression|javascript|;/i.test(trimmed)) return '';
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', trimmed)) return '';
  return trimmed;
};

const sanitizeFontSize = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}(?:\.\d{1,2})?)px$/i);
  if (!match) return '';
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size < 8 || size > 72) return '';
  return `${size}px`;
};

const sanitizeTextDecorationLine = (value: string) => {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  const allowed = tokens.filter(token => token === 'underline' || token === 'none');
  return allowed.length === tokens.length ? allowed.join(' ') : '';
};

const copySafeStyle = (source: HTMLElement, target: HTMLElement) => {
  const legacyColor = source.tagName.toUpperCase() === 'FONT'
    ? sanitizeCssColor(source.getAttribute('color') || '')
    : '';
  const color = sanitizeCssColor(source.style.color) || legacyColor;
  const fontSize = sanitizeFontSize(source.style.fontSize);
  const textDecorationLine = sanitizeTextDecorationLine(source.style.textDecorationLine);

  if (color) target.style.color = color;
  if (fontSize) target.style.fontSize = fontSize;
  if (textDecorationLine) target.style.textDecorationLine = textDecorationLine;
};

const copyChildren = (source: Node, target: Node) => {
  source.childNodes.forEach(child => {
    const sanitized = sanitizeNode(child);
    if (sanitized) target.appendChild(sanitized);
  });
};

const sanitizeNode = (node: Node): Node | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent || '');
  }

  if (!(node instanceof HTMLElement)) {
    return null;
  }

  const tagName = node.tagName.toUpperCase();
  if (BLOCKED_RICH_TAGS.has(tagName)) return null;

  // Safari contenteditable uses DIV elements for new paragraphs. Normalize
  // them into the allowed P tag so saving does not collapse adjacent lines.
  if (tagName === 'DIV') {
    const paragraph = document.createElement('p');
    copySafeStyle(node, paragraph);
    copyChildren(node, paragraph);
    return paragraph;
  }

  if (!ALLOWED_RICH_TAGS.has(tagName)) {
    const styledSpan = document.createElement('span');
    copySafeStyle(node, styledSpan);
    if (styledSpan.style.length > 0) {
      copyChildren(node, styledSpan);
      return styledSpan;
    }
    const fragment = document.createDocumentFragment();
    copyChildren(node, fragment);
    return fragment;
  }

  if (tagName === 'BR') return document.createElement('br');

  if (tagName === 'IMG') {
    const src = node.getAttribute('src') || '';
    if (!isSafeImageSrc(src)) return null;

    const image = document.createElement('img');
    image.setAttribute('src', src.trim());
    image.setAttribute('referrerpolicy', 'no-referrer');
    const alt = node.getAttribute('alt');
    if (alt) image.setAttribute('alt', alt.slice(0, 240));

    Array.from(node.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (SAFE_MEDIA_DATA_ATTR.test(name)) {
        image.setAttribute(name, attribute.value.slice(0, 1024));
      }
    });

    return image;
  }

  const element = document.createElement(tagName.toLowerCase());

  if (tagName === 'FIGURE') {
    element.className = 'note-inline-image';
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('data-note-image', 'true');
  } else {
    copySafeStyle(node, element);
  }

  copyChildren(node, element);
  return element;
};

export const sanitizeRichHtml = (html?: string) => {
  if (!html || typeof document === 'undefined') return html || '';

  const template = document.createElement('template');
  template.innerHTML = html;
  const output = document.createElement('div');
  copyChildren(template.content, output);
  normalizeRichTextSpans(output);
  return output.innerHTML;
};

export const sanitizeRichHtmlFields = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeRichHtmlFields(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    next[key] = HTML_FIELD_KEYS.has(key) && typeof entry === 'string'
      ? sanitizeRichHtml(entry)
      : sanitizeRichHtmlFields(entry);
  });
  return next as T;
};
