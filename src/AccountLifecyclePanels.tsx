import React from 'react';
import { Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE } from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';

type HomeCopy = typeof HOME_COPY.en;

function PrivacyNoticeBody({ homeCopy }: { homeCopy: HomeCopy }) {
  return (
    <>
      <div className="text-[13px] font-medium leading-snug text-black/55">
        {homeCopy.privacyIntro}
      </div>
      <div className="mt-4 space-y-3">
        {homeCopy.privacySections.map(section => (
          <div key={section.title}>
            <div className="text-[13px] font-semibold leading-tight text-black">
              {section.title}
            </div>
            <div className="mt-1 text-[12px] font-medium leading-snug text-black/50">
              {section.body}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function PrivacyNoticeContent({ homeCopy }: { homeCopy: HomeCopy }) {
  return (
    <div className="rounded-[14px] bg-[var(--app-card)] p-3">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-medium text-black/60">
        <ShieldCheck size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
        {homeCopy.privacyNotice}
      </div>
      <PrivacyNoticeBody homeCopy={homeCopy} />
    </div>
  );
}

export function PrivacyConsentDialog({
  open,
  homeCopy,
  isBusy,
  onDecline,
  onAgree,
}: {
  open: boolean;
  homeCopy: HomeCopy;
  isBusy: boolean;
  onDecline: () => void;
  onAgree: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 px-6 py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-consent-title"
    >
      <div className="flex max-h-[82dvh] w-full max-w-[390px] flex-col overflow-hidden rounded-[18px] bg-[var(--app-card)] p-4 shadow-xl">
        <div id="privacy-consent-title" className="flex items-center gap-2 text-[18px] font-semibold text-black">
          <ShieldCheck size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
          {homeCopy.privacyConsentTitle}
        </div>
        <div className="mt-2 text-[12px] font-medium leading-snug text-black/55">
          {homeCopy.privacyConsentPrompt}
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [touch-action:pan-y]" style={{ WebkitOverflowScrolling: 'touch' }}>
          <PrivacyNoticeBody homeCopy={homeCopy} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDecline}
            disabled={isBusy}
            className="h-11 rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {homeCopy.privacyConsentDecline}
          </button>
          <button
            type="button"
            onClick={onAgree}
            disabled={isBusy}
            className="h-11 rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {homeCopy.privacyConsentAgree}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountDeletionPanel({
  homeCopy,
  password,
  status,
  isDeleting,
  onPasswordChange,
  onDelete,
}: {
  homeCopy: HomeCopy;
  password: string;
  status: string;
  isDeleting: boolean;
  onPasswordChange: (value: string) => void;
  onDelete: () => void;
}) {
  const [isFinalConfirmationOpen, setIsFinalConfirmationOpen] = React.useState(false);

  const confirmDeletion = React.useCallback(() => {
    setIsFinalConfirmationOpen(false);
    onDelete();
  }, [onDelete]);

  return (
    <div className="mt-4">
      <div className="rounded-[14px] bg-[var(--app-card)] p-3">
        <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
          <Trash2 size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
          {homeCopy.accountDelete}
        </div>
        <div className="text-[12px] font-medium leading-snug text-black/52">
          {homeCopy.accountDeleteIntro}
        </div>
        <div className="mt-2 text-[12px] font-medium leading-snug text-black/68">
          {homeCopy.accountDeleteWarning}
        </div>
        <label className="mt-4 flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
          <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
          <input
            value={password}
            onChange={event => onPasswordChange(event.target.value)}
            type="password"
            autoComplete="current-password"
            disabled={isDeleting}
            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30 disabled:opacity-60"
            placeholder={homeCopy.accountDeletePassword}
          />
        </label>
        <button
          type="button"
          onClick={() => setIsFinalConfirmationOpen(true)}
          disabled={isDeleting || !password}
          className="mt-3 h-10 w-full rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-45"
        >
          {isDeleting ? homeCopy.accountDeleting : homeCopy.accountDeleteConfirm}
        </button>
        {status && (
          <div className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/55">
            {status}
          </div>
        )}
      </div>

      {isFinalConfirmationOpen && (
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 px-7"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-delete-final-title"
        >
          <div className="w-full max-w-[360px] rounded-[18px] bg-[var(--app-card)] p-4 shadow-xl">
            <div id="account-delete-final-title" className="flex items-center gap-2 text-[18px] font-semibold text-black">
              <Trash2 size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
              {homeCopy.accountDeleteFinalTitle}
            </div>
            <div className="mt-3 text-[13px] font-medium leading-snug text-black/58">
              {homeCopy.accountDeleteFinalBody}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsFinalConfirmationOpen(false)}
                disabled={isDeleting}
                className="h-11 rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {homeCopy.accountDeleteCancel}
              </button>
              <button
                type="button"
                onClick={confirmDeletion}
                disabled={isDeleting}
                className="h-11 rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {homeCopy.accountDeleteFinalConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
