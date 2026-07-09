import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, ChevronsLeft } from 'lucide-react';

export type SearchResultRecord = {
  id: string;
  starId: string;
  noteId: string;
  title: string;
  text: string;
  timestamp: number;
  matchCount: number;
};

type SearchResultsCopy = {
  back: string;
  searchResultsTitle: string;
  searchResultsFor: string;
  noSearchResults: string;
};

type SearchResultsScreenProps = {
  records: SearchResultRecord[];
  query: string;
  copy: SearchResultsCopy;
  languageLocale: string;
  screenTopPaddingClass: string;
  iconStrokeWidth: number;
  onBack: () => void;
  onOpenRecord: (starId: string, noteId: string) => void;
  formatRecordMonth: (timestamp: number) => string;
  formatRecordTime: (timestamp: number, locale?: string) => string;
};

const getSearchPreviewText = (text: string, query: string, maxLength = 96) => {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedText || normalizedText.length <= maxLength) return normalizedText;
  if (!normalizedQuery) return `${normalizedText.slice(0, maxLength).trim()}...`;

  const matchIndex = normalizedText.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex < 0) return `${normalizedText.slice(0, maxLength).trim()}...`;

  const start = Math.max(0, matchIndex - Math.floor((maxLength - normalizedQuery.length) / 2));
  const end = Math.min(normalizedText.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`;
};

function SearchHighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedQuery.length;
    parts.push(
      <mark key={`${matchIndex}-${matchEnd}`} className="rounded-[3px] bg-[#EDC727] px-[1px] text-black">
        {text.slice(matchIndex, matchEnd)}
      </mark>
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}

export function SearchResultsScreen({
  records,
  query,
  copy,
  languageLocale,
  screenTopPaddingClass,
  iconStrokeWidth,
  onBack,
  onOpenRecord,
  formatRecordMonth,
  formatRecordTime,
}: SearchResultsScreenProps) {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 1 }}
      transition={{ duration: 0 }}
      className="absolute inset-0 z-[950] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={`flex-1 overflow-y-auto px-8 pb-20 ${screenTopPaddingClass}`}
      >
        <div className="mx-auto w-full max-w-[430px]">
          <button
            onClick={onBack}
            className="mb-12 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
            aria-label={copy.back}
          >
            <ChevronsLeft size={30} strokeWidth={iconStrokeWidth} />
          </button>

          <div className="mb-8">
            <h1 className="text-[36px] font-extrabold leading-[1.08] tracking-tight text-black">
              {copy.searchResultsTitle}
            </h1>
            <div className="mt-1 text-[28px] font-extrabold leading-[1.08] tracking-tight text-black">
              {copy.searchResultsFor} <span className="text-black/48">&quot;{trimmedQuery}&quot;</span>
            </div>
          </div>

          {records.length > 0 ? (
            <div className="flex flex-col gap-5">
              {records.map(record => {
                const sourceText = record.text.toLowerCase().includes(normalizedQuery) ? record.text : record.title;
                const previewText = getSearchPreviewText(sourceText || record.title, query, 112);

                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onOpenRecord(record.starId, record.noteId)}
                    className="relative flex min-h-[92px] w-full items-center gap-3 rounded-[18px] bg-[var(--app-card)] px-5 py-4 pr-12 text-left shadow-sm transition-transform active:scale-[0.99]"
                  >
                    <span className="absolute right-[-7px] top-[-10px] flex h-9 min-w-9 items-center justify-center rounded-full bg-[var(--app-icon)] px-2 text-[14px] font-extrabold text-black shadow-sm">
                      {record.matchCount}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block overflow-hidden text-[14px] font-medium leading-snug text-black/82"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        <SearchHighlightedText text={previewText} query={query} />
                      </span>
                      <span className="mt-2 block text-[11px] font-medium text-black/35">
                        {formatRecordMonth(record.timestamp)} {formatRecordTime(record.timestamp, languageLocale)}
                      </span>
                    </span>
                    <ChevronRight className="shrink-0 text-black/28" size={24} strokeWidth={iconStrokeWidth} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[18px] bg-[var(--app-card)] px-5 py-7 text-center text-[15px] font-medium text-black/42 shadow-sm">
              {copy.noSearchResults}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
