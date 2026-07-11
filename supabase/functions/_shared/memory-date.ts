export const dateKeyFor = (timestamp: unknown, timeZone = 'Asia/Shanghai') => {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '';
  const number = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(number)) return '';
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value || '';
  const month = parts.find(part => part.type === 'month')?.value || '';
  const day = parts.find(part => part.type === 'day')?.value || '';
  return year && month && day ? `${year}-${month}-${day}` : '';
};

export const isInDateRange = (
  timestamp: unknown,
  dateFrom = '',
  dateTo = '',
  timeZone = 'Asia/Shanghai'
) => {
  const key = dateKeyFor(timestamp, timeZone);
  if (!key) return false;
  return (!dateFrom || key >= dateFrom) && (!dateTo || key <= dateTo);
};
