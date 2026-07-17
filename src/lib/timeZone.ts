export const validTimeZoneOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return null;
  }
};

export const normalizeTimeZone = (value: unknown, fallback = 'UTC') => (
  validTimeZoneOrNull(value) || validTimeZoneOrNull(fallback) || 'UTC'
);

export const getLocalTimeZone = () => {
  if (typeof Intl === 'undefined') return 'UTC';
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
};
