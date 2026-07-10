export const cssColorToHex = (color: string, fallback = '#D2936D') => {
  if (!color) return fallback;
  if (color.startsWith('#')) return color;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return fallback;
  return `#${[match[1], match[2], match[3]]
    .map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
};

export const createClientId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11)
);

export const copyToClipboard = async (text: string) => {
  if (!text) throw new Error('Nothing to copy.');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Clipboard copy was rejected.');
  } finally {
    textarea.remove();
  }
};
