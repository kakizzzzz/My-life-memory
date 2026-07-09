export const countSearchMatches = (text: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  let count = 0;
  let cursor = 0;
  const lowerText = text.toLowerCase();
  let matchIndex = lowerText.indexOf(normalizedQuery, cursor);

  while (matchIndex >= 0) {
    count += 1;
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  return count;
};

export const parseCoordinateSearch = (value: string): [number, number] | null => {
  const match = value.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
};
