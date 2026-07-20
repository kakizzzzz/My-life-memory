import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Menu, Search, X } from 'lucide-react';
import { HOME_COPY } from './copy/homeCopy';
import { APP_MOTION_SPRING } from './constants/motion';
import { addMonths, formatRecordMonth, formatRecordTime, getCalendarDateKey, getMonthTitle } from './lib/dateUtils';
import type { RecordsByDateGroup, RecordsCalendarMode, RecordsFilter } from './types/app';

type RecordsCopy = typeof HOME_COPY.en;

type RecordsScreenProps = {
  homeCopy: RecordsCopy;
  recordsByDate: RecordsByDateGroup[];
  recordsFilter: RecordsFilter;
  selectedRecordsDateKey: string | null;
  isRecordsMenuOpen: boolean;
  isRecordsCalendarOpen: boolean;
  recordsCalendarDate: Date;
  recordsCalendarMode: RecordsCalendarMode;
  recordsCalendarDays: Date[];
  recordsCalendarEmptyDays: unknown[];
  recordsCalendarMonths: Date[];
  recordDateKeys: Set<string>;
  calendarActivityDateKeys: Set<string>;
  languageLocale: string;
  screenTopPaddingClass: string;
  iconStrokeWidth: number;
  onToggleMenu: () => void;
  onOpenCalendar: () => void;
  onOpenSearch: () => void;
  onSetRecordsFilter: (filter: RecordsFilter) => void;
  onClearDateFilter: () => void;
  onOpenRecord: (starId: string, noteId: string) => void;
  onCloseCalendar: () => void;
  onToggleCalendarMode: () => void;
  onCalendarNavigate: (date: Date) => void;
  onSelectCalendarDate: (dateKey: string) => void;
  onSelectCalendarMonth: (month: Date) => void;
};

export function RecordsScreen({
  homeCopy,
  recordsByDate,
  recordsFilter,
  selectedRecordsDateKey,
  isRecordsMenuOpen,
  isRecordsCalendarOpen,
  recordsCalendarDate,
  recordsCalendarMode,
  recordsCalendarDays,
  recordsCalendarEmptyDays,
  recordsCalendarMonths,
  recordDateKeys,
  calendarActivityDateKeys,
  languageLocale,
  screenTopPaddingClass,
  iconStrokeWidth,
  onToggleMenu,
  onOpenCalendar,
  onOpenSearch,
  onSetRecordsFilter,
  onClearDateFilter,
  onOpenRecord,
  onCloseCalendar,
  onToggleCalendarMode,
  onCalendarNavigate,
  onSelectCalendarDate,
  onSelectCalendarMonth,
}: RecordsScreenProps) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--app-page)] font-sans">
      <div className={`flex-1 overflow-y-auto px-6 pb-32 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${screenTopPaddingClass}`}>
        <div className="mb-4 flex items-start justify-between">
          <h1 className="mt-1 text-4xl font-bold tracking-tight text-black">{homeCopy.recordsTitle}</h1>
          <div className="relative flex flex-col gap-2">
            <button
              onClick={onToggleMenu}
              className="relative z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black transition-colors"
              aria-label={homeCopy.recordsMenu}
            >
              {isRecordsMenuOpen ? <ChevronDown size={28} strokeWidth={iconStrokeWidth} /> : <Menu size={24} strokeWidth={iconStrokeWidth} />}
            </button>

            <AnimatePresence>
              {isRecordsMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={APP_MOTION_SPRING}
                  className="absolute left-0 top-[56px] z-10 flex flex-col gap-2"
                >
                  <button
                    onClick={onOpenCalendar}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm"
                    aria-label={homeCopy.calendar}
                  >
                    <CalendarDays size={24} strokeWidth={iconStrokeWidth} />
                  </button>
                  <button
                    onClick={onOpenSearch}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm"
                    aria-label={homeCopy.searchRecords}
                  >
                    <Search size={28} strokeWidth={iconStrokeWidth} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-3">
          {([
            ['all', homeCopy.allRecords],
            ['monthly', homeCopy.monthlyRecords],
            ['annual', homeCopy.annualRecords],
          ] as [RecordsFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => onSetRecordsFilter(value)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${recordsFilter === value ? 'bg-[var(--app-dark)] text-white' : 'bg-[var(--app-card)] text-black'}`}
            >
              {label}
            </button>
          ))}
          {selectedRecordsDateKey && (
            <button
              onClick={onClearDateFilter}
              className="rounded-full bg-[var(--app-card)] px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-[var(--app-soft-card)]"
            >
              {homeCopy.clearDateFilter}
            </button>
          )}
        </div>

        <div className="relative mt-2">
          {recordsByDate.length > 0 && (
            <div className="absolute bottom-[-20px] left-[11px] top-6 w-[2px] rounded-full bg-[var(--app-card)]" />
          )}

          {recordsByDate.length > 0 ? recordsByDate.map(group => {
            const [firstRecord] = group.records;
            return (
              <div key={group.dateKey} className="mb-10">
                <div className="mb-4 flex items-baseline gap-2 pl-8">
                  <span className="text-3xl font-extrabold leading-none tracking-tight text-gray-900">{firstRecord.day}</span>
                  <span className="text-sm font-medium text-gray-400">{formatRecordMonth(firstRecord.timestamp)}</span>
                </div>

                <div className="flex flex-col gap-4">
                  {group.records.map(record => (
                    <button
                      key={record.id}
                      onClick={() => onOpenRecord(record.starId, record.noteId)}
                      className="relative block w-full pl-8 text-left"
                    >
                      <span className="absolute left-[12px] top-[calc(50%-24px)] h-[2px] w-[20px] bg-[var(--app-card)]" />
                      <span className="absolute left-[12px] top-[calc(50%+22px)] h-[2px] w-[20px] bg-[var(--app-card)]" />
                      <span
                        className="absolute left-[6px] top-1/2 z-10 box-content h-[12px] w-[12px] -translate-y-1/2 rounded-full border-2 border-[var(--app-page)] ring-[3px] ring-[var(--app-page)]"
                        style={{ backgroundColor: record.color }}
                      />
                      <span className="record-preview-card block rounded-[20px] bg-[var(--app-card-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
                        <span className="record-preview-text block text-[15px] font-medium leading-relaxed text-black/80">
                          {record.text || record.title}
                        </span>
                        <span className="record-preview-time flex justify-end text-xs font-medium text-gray-400">
                          {formatRecordTime(record.timestamp, languageLocale)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          }) : (
            <div className="pt-20 text-center text-[16px] font-medium text-black/35">
              {homeCopy.noRecords}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isRecordsCalendarOpen && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={APP_MOTION_SPRING}
            className="absolute inset-0 z-[1000] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
          >
            <div className={`flex flex-1 flex-col items-center overflow-y-auto px-6 pb-32 ${screenTopPaddingClass}`}>
              <div className="w-full max-w-[360px]">
                <div className="mb-6 flex items-start justify-between">
                  <h1 className="mt-1 text-[32px] font-bold tracking-tight text-black">{homeCopy.calendar}</h1>
                  <button
                    onClick={onCloseCalendar}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
                    aria-label={homeCopy.closeCalendar}
                  >
                    <X size={24} strokeWidth={iconStrokeWidth} />
                  </button>
                </div>

                <div className="rounded-[20px] bg-[var(--app-card-surface)] p-5 shadow-sm">
                  <div className="mb-6 flex items-center justify-between">
                    <button
                      onClick={onToggleCalendarMode}
                      className="group flex items-center gap-1 transition-opacity hover:opacity-70"
                    >
                      <h2 className="text-[20px] font-bold tracking-tight text-gray-900">
                        {recordsCalendarMode === 'month' ? getMonthTitle(recordsCalendarDate, languageLocale) : recordsCalendarDate.getFullYear()}
                      </h2>
                      <ChevronDown size={18} className="text-gray-400 transition-colors group-hover:text-gray-600" />
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => onCalendarNavigate(addMonths(recordsCalendarDate, recordsCalendarMode === 'month' ? -1 : -12))}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-card)] text-black/65 transition-colors hover:bg-[var(--app-page)]"
                        aria-label={homeCopy.previousCalendarPage}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => onCalendarNavigate(addMonths(recordsCalendarDate, recordsCalendarMode === 'month' ? 1 : 12))}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-card)] text-black/65 transition-colors hover:bg-[var(--app-page)]"
                        aria-label={homeCopy.nextCalendarPage}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false} mode="sync">
                    {recordsCalendarMode === 'month' ? (
                      <motion.div
                        key="month"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={APP_MOTION_SPRING}
                      >
                        <div className="mb-3 grid grid-cols-7">
                          {homeCopy.weekdays.map(day => (
                            <div key={day} className="text-center text-[10px] font-bold tracking-wider text-gray-400">
                              {day}
                            </div>
                          ))}
                        </div>
                        <div className="mb-4 h-[1px] w-full bg-gray-100" />
                        <div className="grid grid-cols-7 gap-x-1 gap-y-2">
                          {recordsCalendarEmptyDays.map((_, index) => (
                            <div key={`empty-${index}`} className="h-10" />
                          ))}
                          {recordsCalendarDays.map(day => {
                            const dateKey = getCalendarDateKey(day);
                            const hasRecord = recordDateKeys.has(dateKey);
                            const hasCalendarActivity = calendarActivityDateKeys.has(dateKey);
                            const isToday = getCalendarDateKey(new Date()) === dateKey;

                            return (
                              <button
                                key={dateKey}
                                type="button"
                                disabled={!hasRecord}
                                onClick={() => {
                                  if (!hasRecord) return;
                                  onSelectCalendarDate(dateKey);
                                }}
                                className="relative flex h-10 flex-col items-center justify-center"
                              >
                                <div className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[14px] font-semibold tracking-tight transition-colors ${isToday ? 'bg-[var(--app-dark)] text-white' : 'text-gray-800 hover:bg-[var(--app-card)]'}`}>
                                  {day.getDate()}
                                </div>
                                {hasCalendarActivity && !isToday && (
                                  <div className="absolute bottom-0 h-[4px] w-[4px] rounded-full bg-[var(--app-icon)]" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="year"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={APP_MOTION_SPRING}
                        className="grid grid-cols-3 gap-x-2 gap-y-4 pt-2"
                      >
                        {recordsCalendarMonths.map(month => {
                          const isCurrentMonth = month.getMonth() === recordsCalendarDate.getMonth();
                          return (
                            <button
                              key={month.getMonth()}
                              onClick={() => onSelectCalendarMonth(month)}
                              className={`flex flex-col items-center rounded-2xl p-3 transition-colors ${isCurrentMonth ? 'bg-[var(--app-dark)] text-white' : 'text-gray-800 hover:bg-[var(--app-card)]'}`}
                            >
                              <span className="text-[14px] font-semibold">
                                {new Intl.DateTimeFormat(languageLocale, { month: 'short' }).format(month)}
                              </span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
