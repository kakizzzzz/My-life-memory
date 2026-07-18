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

export type MemoryTemporalContext = {
  timeZone: string;
  currentUtcDateTime: string;
  currentLocalDate: string;
  currentLocalDateTime: string;
};

const partValue = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPart['type']) => (
  parts.find(part => part.type === type)?.value || ''
);

export const buildMemoryTemporalContext = (
  timeZoneValue: unknown,
  now = new Date(),
): MemoryTemporalContext => {
  const timeZone = normalizeTimeZone(timeZoneValue);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const date = `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}`;
  const time = `${partValue(parts, 'hour')}:${partValue(parts, 'minute')}:${partValue(parts, 'second')}`;
  return {
    timeZone,
    currentUtcDateTime: now.toISOString(),
    currentLocalDate: date,
    currentLocalDateTime: `${date}T${time}`,
  };
};
