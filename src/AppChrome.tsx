import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Camera, Copy, Download, Home, Lock, Map as MapIcon, MapPin, PieChart, Route, Save, Search, Share, Star, X } from 'lucide-react';
import { PhotoGpsStarIcon } from './PhotoGpsStarIcon';
import type { AppView, SearchField, UploadedImage } from './types/app';

type InitialPermissionCopy = {
  initialPermissionsTitle: string;
  initialPermissionsBody: string;
  notNow: string;
  permissionRequesting: string;
  openPermissions: string;
};

type AutoUserManualCopy = {
  userManual: string;
  manualIntro: string;
  manualSections: { title: string; body: string }[];
  manualIconsTitle: string;
  bottomMap: string;
  bottomStats: string;
  bottomNotes: string;
  bottomHome: string;
  starLabel: string;
  openPermissions: string;
  uploadPhotoLocation: string;
  readerAddPhoto: string;
  readerEdit: string;
  search: string;
  manualIconMap: string;
  manualIconStats: string;
  manualIconRecords: string;
  manualIconHome: string;
  manualIconStar: string;
  manualIconLocation: string;
  manualIconRoute: string;
  manualIconCamera: string;
  manualIconPhotoGps: string;
  manualIconSave: string;
  manualIconCopy: string;
  manualIconShare: string;
  manualIconSearch: string;
  closeManual: string;
};

type PasswordChangeCopy = {
  changePassword: string;
  closeManual: string;
  passwordNotViewable: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  changingPassword: string;
  savePassword: string;
};

type SearchModalCopy = {
  searchPlaceholder: string;
  runSearch: string;
};

type BottomNavigationCopy = {
  bottomMap: string;
  bottomStats: string;
  bottomNotes: string;
  bottomHome: string;
};

type GalleryPreviewCopy = {
  closeImagePreview: string;
  downloadImage: string;
};

type PermissionRequestState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';

export function InitialPermissionPrompt({
  isOpen,
  copy,
  permissionRequestState,
  iconStrokeWidth,
  onClose,
  onRequest,
}: {
  isOpen: boolean;
  copy: InitialPermissionCopy;
  permissionRequestState: PermissionRequestState;
  iconStrokeWidth: number;
  onClose: () => void;
  onRequest: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2300] flex items-end justify-center bg-black/25 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 pointer-events-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-[360px] rounded-[18px] bg-[var(--app-card)] p-4 text-black shadow-xl"
          >
            <div className="mb-2 flex items-center gap-2 text-[17px] font-medium leading-tight">
              <MapPin size={22} strokeWidth={iconStrokeWidth} />
              {copy.initialPermissionsTitle}
            </div>
            <div className="text-[13px] font-medium leading-snug text-black/55">
              {copy.initialPermissionsBody}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98]"
              >
                {copy.notNow}
              </button>
              <button
                type="button"
                onClick={onRequest}
                disabled={permissionRequestState === 'requesting'}
                className="h-11 rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {permissionRequestState === 'requesting' ? copy.permissionRequesting : copy.openPermissions}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AutoUserManualModal({
  isOpen,
  copy,
  iconStrokeWidth,
  onClose,
}: {
  isOpen: boolean;
  copy: AutoUserManualCopy;
  iconStrokeWidth: number;
  onClose: () => void;
}) {
  const manualIconGuide = [
    { icon: <MapIcon size={18} strokeWidth={iconStrokeWidth} />, label: copy.bottomMap, body: copy.manualIconMap },
    { icon: <PieChart size={18} strokeWidth={iconStrokeWidth} />, label: copy.bottomStats, body: copy.manualIconStats },
    { icon: <BookOpen size={18} strokeWidth={iconStrokeWidth} />, label: copy.bottomNotes, body: copy.manualIconRecords },
    { icon: <Home size={18} strokeWidth={iconStrokeWidth} />, label: copy.bottomHome, body: copy.manualIconHome },
    { icon: <Star size={18} strokeWidth={iconStrokeWidth} />, label: copy.starLabel, body: copy.manualIconStar },
    { icon: <MapPin size={18} strokeWidth={iconStrokeWidth} />, label: copy.openPermissions, body: copy.manualIconLocation },
    { icon: <Route size={18} strokeWidth={iconStrokeWidth} />, label: copy.manualSections[3]?.title || '', body: copy.manualIconRoute },
    { icon: <Camera size={18} strokeWidth={iconStrokeWidth} />, label: copy.readerAddPhoto, body: copy.manualIconCamera },
    { icon: <PhotoGpsStarIcon size={18} strokeWidth={iconStrokeWidth} />, label: copy.uploadPhotoLocation, body: copy.manualIconPhotoGps },
    { icon: <Save size={18} strokeWidth={iconStrokeWidth} />, label: copy.readerEdit, body: copy.manualIconSave },
    { icon: <Copy size={18} strokeWidth={iconStrokeWidth} />, label: copy.manualIconCopy, body: copy.manualIconCopy },
    { icon: <Share size={18} strokeWidth={iconStrokeWidth} />, label: copy.manualIconShare, body: copy.manualIconShare },
    { icon: <Search size={18} strokeWidth={iconStrokeWidth} />, label: copy.search, body: copy.manualIconSearch },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2320] flex items-center justify-center bg-black/30 px-5 py-[calc(env(safe-area-inset-top)+1rem)] pointer-events-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex max-h-[78dvh] w-full max-w-[370px] flex-col rounded-[18px] bg-[var(--app-card)] p-4 text-black shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[18px] font-medium leading-tight">
                <BookOpen size={23} strokeWidth={iconStrokeWidth} />
                <span className="truncate">{copy.userManual}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-soft-card)] text-black transition-transform active:scale-95"
                aria-label={copy.closeManual}
              >
                <X size={20} strokeWidth={iconStrokeWidth} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain pr-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="text-[13px] font-medium leading-snug text-black/55">
                {copy.manualIntro}
              </div>
              <div className="mt-4 space-y-3 pb-1">
                {copy.manualSections.map(section => (
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
              <div className="mt-5 text-[13px] font-semibold leading-tight text-black">
                {copy.manualIconsTitle}
              </div>
              <div className="mt-3 space-y-2.5 pb-1">
                {manualIconGuide.map(item => (
                  <div key={`${item.label}-${item.body}`} className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-soft-card)] text-black">
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold leading-tight text-black">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium leading-snug text-black/52">
                        {item.body}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PasswordChangeModal({
  isOpen,
  copy,
  iconStrokeWidth,
  currentPassword,
  newPassword,
  confirmPassword,
  status,
  isChanging,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  copy: PasswordChangeCopy;
  iconStrokeWidth: number;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  status: string;
  isChanging: boolean;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/35 px-5 py-[calc(env(safe-area-inset-top)+1rem)] pointer-events-auto"
        >
          <motion.form
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onSubmit={event => {
              event.preventDefault();
              onSubmit();
            }}
            className="w-full max-w-[360px] rounded-[18px] bg-[var(--app-card)] p-4 text-black shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[18px] font-medium leading-tight">
                <Lock size={23} strokeWidth={iconStrokeWidth} />
                <span className="truncate">{copy.changePassword}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-soft-card)] text-black transition-transform active:scale-95"
                aria-label={copy.closeManual}
              >
                <X size={20} strokeWidth={iconStrokeWidth} />
              </button>
            </div>
            <div className="mb-3 text-[12px] font-medium leading-snug text-black/45">
              {copy.passwordNotViewable}
            </div>
            <div className="space-y-2">
              <input
                value={currentPassword}
                onChange={event => onCurrentPasswordChange(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                placeholder={copy.currentPassword}
                aria-label={copy.currentPassword}
              />
              <input
                value={newPassword}
                onChange={event => onNewPasswordChange(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                placeholder={copy.newPassword}
                aria-label={copy.newPassword}
              />
              <input
                value={confirmPassword}
                onChange={event => onConfirmPasswordChange(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                placeholder={copy.confirmPassword}
                aria-label={copy.confirmPassword}
              />
            </div>
            {status && (
              <div className="mt-3 text-[12px] font-medium leading-snug text-black/45">
                {status}
              </div>
            )}
            <button
              type="submit"
              disabled={isChanging}
              className="mt-4 h-11 w-full rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {isChanging ? copy.changingPassword : copy.savePassword}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SearchModal({
  isOpen,
  activeSearchField,
  coordinateSearch,
  textSearch,
  copy,
  iconStrokeWidth,
  onClose,
  onActiveFieldChange,
  onCoordinateChange,
  onTextChange,
  onCoordinateSubmit,
  onTextSubmit,
}: {
  isOpen: boolean;
  activeSearchField: SearchField;
  coordinateSearch: string;
  textSearch: string;
  copy: SearchModalCopy;
  iconStrokeWidth: number;
  onClose: () => void;
  onActiveFieldChange: (field: SearchField) => void;
  onCoordinateChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onCoordinateSubmit: () => void;
  onTextSubmit: () => void;
}) {
  const searchInputClass = (field: SearchField) => (
    `h-12 rounded-full px-5 text-[15px] font-medium text-black outline-none transition-colors placeholder:text-black/25 ${
      activeSearchField === field ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
    }`
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1800] flex items-start justify-center bg-black/[0.28] px-6 pb-6 pt-[calc(env(safe-area-inset-top)+4.75rem)] pointer-events-auto"
          onPointerDown={onClose}
        >
          <motion.form
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-[360px]"
            onPointerDown={event => event.stopPropagation()}
            onSubmit={event => {
              event.preventDefault();
              if (activeSearchField === 'coordinate') {
                onCoordinateSubmit();
              } else {
                onTextSubmit();
              }
            }}
          >
            <div className="relative flex flex-col gap-2">
              <input
                value={coordinateSearch}
                onFocus={() => onActiveFieldChange('coordinate')}
                onPointerDown={() => onActiveFieldChange('coordinate')}
                onChange={event => onCoordinateChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') onCoordinateSubmit();
                }}
                placeholder="(35.8626, 129.1945)"
                className={`${searchInputClass('coordinate')} pr-14`}
              />
              <label className={`flex h-12 items-center rounded-full px-5 text-black transition-colors ${
                activeSearchField === 'text' ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
              }`}>
                <input
                  value={textSearch}
                  onFocus={() => onActiveFieldChange('text')}
                  onPointerDown={() => onActiveFieldChange('text')}
                  onChange={event => onTextChange(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent pr-10 text-[15px] font-medium outline-none placeholder:text-black/25"
                />
              </label>
              <button
                type="submit"
                className="absolute right-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black transition-colors hover:bg-black/5"
                style={{ top: activeSearchField === 'coordinate' ? 6 : 62 }}
                aria-label={copy.runSearch}
              >
                <Search size={28} strokeWidth={iconStrokeWidth} />
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function BottomNavigation({
  isVisible,
  activeView,
  copy,
  iconStrokeWidth,
  onMap,
  onStats,
  onRecords,
  onHome,
}: {
  isVisible: boolean;
  activeView: AppView;
  copy: BottomNavigationCopy;
  iconStrokeWidth: number;
  onMap: () => void;
  onStats: () => void;
  onRecords: () => void;
  onHome: () => void;
}) {
  if (!isVisible) return null;

  const bottomNavTransition = { type: 'spring', stiffness: 420, damping: 34 };
  const getBottomNavClass = (view: AppView) => (
    activeView === view
      ? 'bg-[var(--app-dark)] text-white rounded-full px-6 py-3 flex items-center justify-center transition-all duration-300 ease-out'
      : 'text-gray-800 rounded-full px-4 py-3 flex items-center justify-center hover:bg-[var(--app-card)] transition-all duration-300 ease-out'
  );

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
      <div className="bg-[var(--app-nav-surface)] backdrop-blur-lg rounded-[2rem] px-2.5 py-2 flex items-center gap-2.5 shadow-sm border border-[var(--app-icon)] transition-all duration-300 ease-out">
        <motion.button
          layout
          transition={bottomNavTransition}
          whileTap={{ scale: 0.96 }}
          onClick={onMap}
          className={getBottomNavClass('map')}
          aria-label={copy.bottomMap}
        >
          <MapIcon size={24} strokeWidth={iconStrokeWidth} />
        </motion.button>

        <motion.button
          layout
          transition={bottomNavTransition}
          whileTap={{ scale: 0.96 }}
          onClick={onStats}
          className={getBottomNavClass('stats')}
          aria-label={copy.bottomStats}
        >
          <PieChart size={24} strokeWidth={iconStrokeWidth} />
        </motion.button>

        <motion.button
          layout
          transition={bottomNavTransition}
          whileTap={{ scale: 0.96 }}
          onClick={onRecords}
          className={getBottomNavClass('records')}
          aria-label={copy.bottomNotes}
        >
          <BookOpen size={24} strokeWidth={iconStrokeWidth} />
        </motion.button>

        <motion.button
          layout
          transition={bottomNavTransition}
          whileTap={{ scale: 0.96 }}
          onClick={onHome}
          className={getBottomNavClass('home')}
          aria-label={copy.bottomHome}
        >
          <Home size={24} strokeWidth={iconStrokeWidth} />
        </motion.button>
      </div>
    </div>
  );
}

export function GalleryPreviewOverlay({
  image,
  copy,
  iconStrokeWidth,
  onClose,
  onDownload,
}: {
  image: UploadedImage | null;
  copy: GalleryPreviewCopy;
  iconStrokeWidth: number;
  onClose: () => void;
  onDownload: (image: UploadedImage) => void | Promise<void>;
}) {
  if (!image) return null;

  return (
    <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/80 p-4">
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        aria-label={copy.closeImagePreview}
      >
        <X size={22} strokeWidth={iconStrokeWidth} />
      </button>
      <button
        onClick={() => { void onDownload(image); }}
        className="absolute right-[4.25rem] top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        aria-label={copy.downloadImage}
      >
        <Download size={21} strokeWidth={iconStrokeWidth} />
      </button>
      <img
        src={image.src}
        alt={image.title}
        className="max-h-full max-w-full rounded-[18px] object-contain shadow-2xl"
      />
    </div>
  );
}
