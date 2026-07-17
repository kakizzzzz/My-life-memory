import { Eye, EyeOff, Lock, Palette, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE, UI_ICON_STROKE } from './constants/ui';
import { THEME_PICKER_COLORS, THEME_PRESETS } from './constants/theme';
import { HOME_COPY } from './copy/homeCopy';
import type { SystemTheme, UploadedImage, UserProfile } from './types/app';

type HomeCopy = typeof HOME_COPY.en;

export type ThemeColorControl = {
  key: keyof SystemTheme;
  label: string;
};

type HomeProfilePanelProps = {
  homeCopy: HomeCopy;
  profile: UserProfile;
  profileAvatarSrc: string;
  isCloudBackendEnabled: boolean;
  isPasswordRevealed: boolean;
  passwordChangeStatus: string;
  onAvatarClick: () => void;
  onProfileNameChange: (name: string) => void;
  onProfilePasswordChange: (password: string) => void;
  onOpenPasswordChange: () => void;
  onTogglePasswordReveal: () => void;
};

type HomeThemePanelProps = {
  homeCopy: HomeCopy;
  language: string;
  systemTheme: SystemTheme;
  themeColorControls: ThemeColorControl[];
  activeThemeColorKey: keyof SystemTheme | null;
  showThemeCustomPicker: boolean;
  onPresetSelect: (theme: SystemTheme) => void;
  onThemeColorMenuToggle: (key: keyof SystemTheme) => void;
  onThemeColorChange: (key: keyof SystemTheme, color: string) => void;
  onToggleThemeCustomPicker: () => void;
};

type HomeGalleryPanelProps = {
  homeCopy: HomeCopy;
  uploadedImages: UploadedImage[];
  onPreviewImage: (image: UploadedImage) => void;
};

export function HomeProfilePanel({
  homeCopy,
  profile,
  profileAvatarSrc,
  isCloudBackendEnabled,
  isPasswordRevealed,
  passwordChangeStatus,
  onAvatarClick,
  onProfileNameChange,
  onProfilePasswordChange,
  onOpenPasswordChange,
  onTogglePasswordReveal,
}: HomeProfilePanelProps) {
  return (
    <motion.div
      key="profile-panel"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 0 }}
      transition={{ duration: 0.12 }}
      className="mt-4 rounded-[18px] bg-[var(--app-card)] p-4"
    >
      <div className="mb-3 flex items-center gap-2 text-[18px] font-medium text-black">
        <UserRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
        {homeCopy.modify}
      </div>
      <button
        onClick={onAvatarClick}
        className="mb-4 h-24 w-24 overflow-hidden rounded-[18px] bg-[var(--app-soft-surface)] text-black"
        aria-label={homeCopy.uploadAvatar}
      >
        {profileAvatarSrc ? (
          <img src={profileAvatarSrc} alt={homeCopy.userAvatarAlt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UserRound size={42} strokeWidth={UI_ICON_STROKE} />
          </div>
        )}
      </button>
      <div className="space-y-3">
        <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
          <UserRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
          <input
            value={profile.name}
            onChange={event => onProfileNameChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
            placeholder={homeCopy.userName}
          />
        </label>
        {isCloudBackendEnabled ? (
          <div className="rounded-[12px] bg-[var(--app-soft-surface)] p-3 text-black">
            <div className="flex min-h-11 items-center gap-3">
              <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
              <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-black/45">
                {homeCopy.passwordManaged}
              </span>
              <button
                type="button"
                onClick={onOpenPasswordChange}
                className="shrink-0 rounded-full bg-[var(--app-card)] px-3 py-1.5 text-[12px] font-medium text-black transition-transform active:scale-95"
              >
                {homeCopy.changePassword}
              </button>
            </div>
            {passwordChangeStatus && (
              <div className="mt-2 pl-9 text-[12px] font-medium leading-snug text-black/45">
                {passwordChangeStatus}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
            <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
            <input
              value={profile.password}
              onChange={event => onProfilePasswordChange(event.target.value)}
              type={isPasswordRevealed ? 'text' : 'password'}
              className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
              placeholder={homeCopy.loginPassword}
              aria-label={homeCopy.loginPassword}
            />
            <button
              type="button"
              onClick={onTogglePasswordReveal}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--app-card)] text-black transition-transform active:scale-95"
              aria-label={isPasswordRevealed ? homeCopy.hidePassword : homeCopy.showPassword}
              title={isPasswordRevealed ? homeCopy.hidePassword : homeCopy.showPassword}
            >
              {isPasswordRevealed ? (
                <EyeOff size={18} strokeWidth={UI_ICON_STROKE} />
              ) : (
                <Eye size={18} strokeWidth={UI_ICON_STROKE} />
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function HomeThemePanel({
  homeCopy,
  language,
  systemTheme,
  themeColorControls,
  activeThemeColorKey,
  showThemeCustomPicker,
  onPresetSelect,
  onThemeColorMenuToggle,
  onThemeColorChange,
  onToggleThemeCustomPicker,
}: HomeThemePanelProps) {
  return (
    <motion.div
      key="theme-panel"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="mt-4 rounded-[18px] bg-[var(--app-card)] p-4"
    >
      <div className="mb-3 flex items-center gap-2 text-[18px] font-medium text-black">
        <Palette size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
        {homeCopy.theme}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {THEME_PRESETS.map(preset => (
          <button
            key={preset.label.en}
            onClick={() => onPresetSelect(preset.theme)}
            className="rounded-[14px] bg-[var(--app-soft-surface)] p-2 text-left"
          >
            <div className="flex gap-1">
              {Object.values(preset.theme).map(color => (
                <span key={color} className="h-6 flex-1 rounded-[7px]" style={{ backgroundColor: color }} />
              ))}
            </div>
            <div className="mt-2 text-[14px] font-medium leading-tight text-black">{preset.label[language] || preset.label.en}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {themeColorControls.map(control => (
          <div key={control.key} className="relative">
            <button
              onClick={() => onThemeColorMenuToggle(control.key)}
              className="flex h-10 w-full items-center justify-between rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-[15px] font-medium text-black"
            >
              <span className="min-w-0 truncate">{control.label}</span>
              <span className="ml-3 flex shrink-0 items-center gap-2">
                <span className="text-[12px] font-semibold leading-none text-black/45">
                  {systemTheme[control.key].replace('#', '').toUpperCase()}
                </span>
                <span
                  className="h-6 w-10 rounded-[8px] border border-black/10"
                  style={{ backgroundColor: systemTheme[control.key] }}
                />
              </span>
            </button>

            {activeThemeColorKey === control.key && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-[40] flex flex-col items-center">
                <div className="bg-[var(--app-dark)] w-[124px] rounded-[20px] p-2.5 shadow-lg relative box-border">
                  <div className="grid grid-cols-4 gap-2">
                    {THEME_PICKER_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => onThemeColorChange(control.key, color)}
                        className="w-[20px] h-[20px] rounded-full"
                        style={{
                          backgroundColor: color,
                          boxShadow: systemTheme[control.key] === color ? '0 0 0 1.5px white' : 'none'
                        }}
                      />
                    ))}
                    <button
                      onClick={onToggleThemeCustomPicker}
                      className="w-[20px] h-[20px] rounded-[6px] relative overflow-hidden"
                      style={{ boxShadow: showThemeCustomPicker || !THEME_PICKER_COLORS.includes(systemTheme[control.key]) ? '0 0 0 1.5px white' : 'none' }}
                    >
                      <div className="w-full h-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] absolute inset-0 pointer-events-none" />
                    </button>
                  </div>
                </div>

                {showThemeCustomPicker && (
                  <div className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
                    <HexColorPicker color={systemTheme[control.key]} onChange={color => onThemeColorChange(control.key, color)} />
                    <div className="flex items-center w-full">
                      <span className="text-white/70 font-mono text-[13px] leading-none pt-[1px] mr-1">#</span>
                      <HexColorInput
                        color={systemTheme[control.key]}
                        onChange={color => onThemeColorChange(control.key, color)}
                        className="flex-1 min-w-0 h-[22px] bg-white/10 border border-white/20 text-white rounded-[6px] px-1.5 text-[12px] font-mono uppercase focus:outline-none focus:border-white/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function HomeGalleryPanel({ homeCopy, uploadedImages, onPreviewImage }: HomeGalleryPanelProps) {
  return (
    <motion.div
      key="gallery-panel"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="mt-4"
    >
      {uploadedImages.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {uploadedImages.map((image, index) => (
            <button
              key={image.id}
              onClick={() => onPreviewImage(image)}
              className="aspect-square overflow-hidden rounded-[12px]"
              title={image.title}
            >
              <img
                src={image.src}
                alt={image.title}
                loading={index < 6 ? 'eager' : 'lazy'}
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2 py-8 text-center text-[15px] font-medium text-black/45">
          {homeCopy.noImages}
        </div>
      )}
    </motion.div>
  );
}
