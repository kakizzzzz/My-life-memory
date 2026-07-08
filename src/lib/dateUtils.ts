export const formatRecordTime = (timestamp: number, locale = 'en-US') => (
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
);

export const formatRecordMonth = (timestamp: number) => (
  `${new Date(timestamp).getFullYear()}/${String(new Date(timestamp).getMonth() + 1).padStart(2, '0')}`
);

export const getCalendarDateKey = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

export const dateFromCalendarDateKey = (dateKey: string | null) => {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  return getCalendarDateKey(date) === dateKey ? date : null;
};

export const getMonthTitle = (date: Date, locale = 'en-US') => (
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
);

export const addMonths = (date: Date, amount: number) => (
  new Date(date.getFullYear(), date.getMonth() + amount, 1)
);
