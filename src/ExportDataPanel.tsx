import React from 'react';
import { Download } from 'lucide-react';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE } from './constants/ui';
import { getCalendarDateKey } from './lib/dateUtils';
import type { UserDataExportRange } from './lib/userDataExport';
import { HOME_COPY } from './copy/homeCopy';

type HomeCopy = typeof HOME_COPY.en;
type ExportRangeMode = 'all' | 'range';

const getDefaultExportDates = () => {
  const today = new Date();
  return {
    startDate: getCalendarDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: getCalendarDateKey(today),
  };
};

export function ExportDataPanel({
  homeCopy,
  isExportingData,
  exportDataStatus,
  exportDataProgress,
  onExportUserData,
}: {
  homeCopy: HomeCopy;
  isExportingData: boolean;
  exportDataStatus: string;
  exportDataProgress: number | null;
  onExportUserData: (range: UserDataExportRange) => void;
}) {
  const defaultDates = React.useMemo(getDefaultExportDates, []);
  const [rangeMode, setRangeMode] = React.useState<ExportRangeMode>('all');
  const [startDate, setStartDate] = React.useState(defaultDates.startDate);
  const [endDate, setEndDate] = React.useState(defaultDates.endDate);
  const isRangeInvalid = rangeMode === 'range' && (
    !startDate || !endDate || startDate > endDate
  );

  const confirmExport = () => {
    if (isRangeInvalid || isExportingData) return;
    const range = rangeMode === 'range' ? { startDate, endDate } : {};
    onExportUserData(range);
  };

  return (
    <div className="mt-4">
      <div className="rounded-[14px] bg-[var(--app-card)] p-3">
        <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
          <Download size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
          {homeCopy.exportData}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 rounded-[14px] bg-[var(--app-soft-card)] p-1.5">
          {(['all', 'range'] as ExportRangeMode[]).map(mode => (
            <button
              type="button"
              key={mode}
              onClick={() => setRangeMode(mode)}
              disabled={isExportingData}
              className={`h-10 rounded-full text-[14px] font-medium transition-colors disabled:opacity-60 ${rangeMode === mode ? 'bg-[var(--app-dark)] text-white' : 'text-black/55'}`}
            >
              {mode === 'all' ? homeCopy.exportRangeAll : homeCopy.exportRangeCustom}
            </button>
          ))}
        </div>

        {rangeMode === 'range' && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="min-w-0 rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <span className="block text-[11px] font-medium text-black/42">{homeCopy.exportRangeStart}</span>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                disabled={isExportingData}
                onChange={event => setStartDate(event.target.value)}
                className="mt-1 block w-full min-w-0 bg-transparent font-medium text-black outline-none disabled:opacity-60"
              />
            </label>
            <label className="min-w-0 rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <span className="block text-[11px] font-medium text-black/42">{homeCopy.exportRangeEnd}</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                disabled={isExportingData}
                onChange={event => setEndDate(event.target.value)}
                className="mt-1 block w-full min-w-0 bg-transparent font-medium text-black outline-none disabled:opacity-60"
              />
            </label>
          </div>
        )}

        {isRangeInvalid && (
          <div className="mb-3 px-1 text-[12px] font-medium text-black/48">
            {homeCopy.exportRangeInvalid}
          </div>
        )}

        <button
          type="button"
          onClick={confirmExport}
          disabled={isRangeInvalid || isExportingData}
          className="h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {isExportingData ? homeCopy.exportingData : homeCopy.exportJson}
        </button>
        {exportDataProgress !== null && (
          <div
            className="mt-3"
            role="progressbar"
            aria-label={exportDataStatus || homeCopy.exportingData}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportDataProgress}
          >
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-[var(--app-dark)] transition-[width] duration-200 ease-out"
                style={{ width: `${exportDataProgress}%` }}
              />
            </div>
            <div className="mt-1 text-right text-[11px] font-medium tabular-nums text-black/38">
              {exportDataProgress}%
            </div>
          </div>
        )}
        {exportDataStatus && (
          <div className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/45">
            {exportDataStatus}
          </div>
        )}
      </div>
    </div>
  );
}
