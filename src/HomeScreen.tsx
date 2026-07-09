import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Asterisk,
  AtSign,
  BookOpen,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  Home,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Lock,
  Map as MapIcon,
  MapPin,
  Palette,
  PieChart,
  Route,
  Save,
  Search,
  Settings,
  Share,
  ShieldCheck,
  Star,
  UserRound,
} from 'lucide-react';
import { HomeGalleryPanel, HomeProfilePanel, HomeThemePanel, type ThemeColorControl } from './HomePrimaryPanels';
import { HomeSettingsPanels, isHomeSettingsPanel, type SettingsMenuItem } from './HomeSettingsPanels';
import { LoginWorldMapBackground } from './LoginWorldMapBackground';
import { PhotoGpsStarIcon } from './PhotoGpsStarIcon';
import { getCloudMcpEndpoint, type CloudAuthAction, type CloudMcpTokenInfo } from './lib/cloudBackend';
import { supabaseFunctionUrl } from './lib/supabaseClient';
import { LANGUAGE_OPTIONS, LOGIN_LANGUAGE_LABELS } from './constants/language';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE } from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';
import type { HomePanel, SystemTheme, UploadedImage, UserProfile } from './types/app';

type HomeCopy = typeof HOME_COPY.en;
type PermissionRequestState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';

type HomeScreenProps = {
  isOpen: boolean;
  isSignedIn: boolean;
  homeCopy: HomeCopy;
  language: string;
  screenTopPaddingClass: string;
  iconStrokeWidth: number;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  homeScrollRef: React.RefObject<HTMLDivElement | null>;
  onAvatarInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  authMode: CloudAuthAction;
  isAuthBusy: boolean;
  cloudAuthHydrating: boolean;
  cloudConfigError: string;
  loginAccount: string;
  loginPassword: string;
  registerInviteCode: string;
  loginError: string;
  onLoginAccountChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegisterInviteCodeChange: (value: string) => void;
  onLanguageChange: (language: string) => void;
  onAuthModeChange: (mode: CloudAuthAction) => void;
  onLoginErrorChange: (value: string) => void;
  onPasswordRevealChange: (value: boolean | ((previous: boolean) => boolean)) => void;
  onLoginSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onRegisterSubmit: (event?: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  profile: UserProfile;
  profileAvatarSrc: string;
  activeHomePanel: HomePanel;
  onActiveHomePanelChange: (panel: HomePanel) => void;
  onCloseHomePanel: () => void;
  isCloudBackendEnabled: boolean;
  isPasswordRevealed: boolean;
  passwordChangeStatus: string;
  onProfileNameChange: (name: string) => void;
  onProfilePasswordChange: (password: string) => void;
  onOpenPasswordChange: () => void;
  systemTheme: SystemTheme;
  activeThemeColorKey: keyof SystemTheme | null;
  showThemeCustomPicker: boolean;
  onThemePresetSelect: (theme: SystemTheme) => void;
  onThemeColorMenuToggle: (key: keyof SystemTheme) => void;
  onThemeColorChange: (key: keyof SystemTheme, color: string) => void;
  onToggleThemeCustomPicker: () => void;
  uploadedImages: UploadedImage[];
  onPreviewImage: (image: UploadedImage) => void;
  permissionRequestState: PermissionRequestState;
  permissionStatusText: string;
  mcpPlainToken: string;
  mcpTokenStatus: string;
  mcpTokens: CloudMcpTokenInfo[];
  isMcpTokenBusy: boolean;
  isExportingData: boolean;
  exportDataStatus: string;
  onOpenPermissions: () => void;
  onSignOut: () => void;
  onExportUserData: () => void;
  onCopyMcpText: (text: string) => void;
  onCreateMcpToken: () => void;
  onRevokeMcpToken: (tokenId: string) => void;
};

export function HomeScreen({
  isOpen,
  isSignedIn,
  homeCopy,
  language,
  screenTopPaddingClass,
  iconStrokeWidth,
  avatarInputRef,
  homeScrollRef,
  onAvatarInput,
  authMode,
  isAuthBusy,
  cloudAuthHydrating,
  cloudConfigError,
  loginAccount,
  loginPassword,
  registerInviteCode,
  loginError,
  onLoginAccountChange,
  onLoginPasswordChange,
  onRegisterInviteCodeChange,
  onLanguageChange,
  onAuthModeChange,
  onLoginErrorChange,
  onPasswordRevealChange,
  onLoginSubmit,
  onRegisterSubmit,
  profile,
  profileAvatarSrc,
  activeHomePanel,
  onActiveHomePanelChange,
  onCloseHomePanel,
  isCloudBackendEnabled,
  isPasswordRevealed,
  passwordChangeStatus,
  onProfileNameChange,
  onProfilePasswordChange,
  onOpenPasswordChange,
  systemTheme,
  activeThemeColorKey,
  showThemeCustomPicker,
  onThemePresetSelect,
  onThemeColorMenuToggle,
  onThemeColorChange,
  onToggleThemeCustomPicker,
  uploadedImages,
  onPreviewImage,
  permissionRequestState,
  permissionStatusText,
  mcpPlainToken,
  mcpTokenStatus,
  mcpTokens,
  isMcpTokenBusy,
  isExportingData,
  exportDataStatus,
  onOpenPermissions,
  onSignOut,
  onExportUserData,
  onCopyMcpText,
  onCreateMcpToken,
  onRevokeMcpToken,
}: HomeScreenProps) {
  const homeMenuItems: { panel: Extract<HomePanel, 'profile' | 'theme' | 'gallery' | 'settings'>; label: string; icon: React.ReactNode }[] = [
    { panel: 'profile', label: homeCopy.modify, icon: <Database size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'theme', label: homeCopy.theme, icon: <Palette size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'gallery', label: homeCopy.gallery, icon: <ImageIcon size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'settings', label: homeCopy.settings, icon: <Settings size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
  ];
  const settingsSubpageTitles: Partial<Record<Exclude<HomePanel, null>, string>> = {
    language: homeCopy.language,
    permissions: homeCopy.openPermissionsHint,
    manual: homeCopy.userManual,
    apiSecurity: homeCopy.apiSecurity,
    mcp: homeCopy.mcpAccess,
    export: homeCopy.exportData,
  };
  const activeHomeTitle = settingsSubpageTitles[activeHomePanel] ||
    homeMenuItems.find(item => item.panel === activeHomePanel)?.label ||
    homeCopy.settings;
  const cloudMcpEndpoint = getCloudMcpEndpoint();
  const cloudMemoryApiEndpoint = supabaseFunctionUrl('memory-api');
  const mcpHeaderValue = mcpPlainToken ? `Bearer ${mcpPlainToken}` : homeCopy.mcpHeaderValueHint;
  const apiSecurityCards = [
    { title: homeCopy.apiMemoryApiTitle, body: homeCopy.apiMemoryApiBody },
    { title: homeCopy.apiMcpSecurityTitle, body: homeCopy.apiMcpSecurityBody },
    { title: homeCopy.apiTokenSecurityTitle, body: homeCopy.apiTokenSecurityBody },
    { title: homeCopy.apiStorageSecurityTitle, body: homeCopy.apiStorageSecurityBody },
    { title: homeCopy.apiDirectApiTitle, body: homeCopy.apiDirectApiBody },
    { title: homeCopy.apiNeverExposeTitle, body: homeCopy.apiNeverExposeBody },
  ];
  const themeColorControls: ThemeColorControl[] = [
    { key: 'page', label: homeCopy.base },
    { key: 'card', label: homeCopy.card },
    { key: 'icon', label: homeCopy.icon },
    { key: 'dark', label: homeCopy.dark },
  ];
  const settingsMenuItems: SettingsMenuItem[] = [
    { panel: 'language', label: homeCopy.language, icon: <Languages size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'permissions', label: homeCopy.openPermissionsHint, icon: <MapPin size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'manual', label: homeCopy.userManual, icon: <BookOpen size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'apiSecurity', label: homeCopy.apiSecurity, icon: <ShieldCheck size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />, hidden: !isCloudBackendEnabled },
    { panel: 'mcp', label: homeCopy.mcpAccess, icon: <KeyRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />, hidden: !isCloudBackendEnabled },
    { panel: 'export', label: homeCopy.exportData, icon: <Download size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
  ];
  const manualIconGuide = [
    { icon: <MapIcon size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.bottomMap, body: homeCopy.manualIconMap },
    { icon: <PieChart size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.bottomStats, body: homeCopy.manualIconStats },
    { icon: <BookOpen size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.bottomNotes, body: homeCopy.manualIconRecords },
    { icon: <Home size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.bottomHome, body: homeCopy.manualIconHome },
    { icon: <Star size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.starLabel, body: homeCopy.manualIconStar },
    { icon: <MapPin size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.openPermissions, body: homeCopy.manualIconLocation },
    { icon: <Route size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.manualSections[3].title, body: homeCopy.manualIconRoute },
    { icon: <Camera size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.readerAddPhoto, body: homeCopy.manualIconCamera },
    { icon: <PhotoGpsStarIcon size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.uploadPhotoLocation, body: homeCopy.manualIconPhotoGps },
    { icon: <Save size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.readerEdit, body: homeCopy.manualIconSave },
    { icon: <Copy size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.manualIconCopy, body: homeCopy.manualIconCopy },
    { icon: <Share size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.manualIconShare, body: homeCopy.manualIconShare },
    { icon: <Search size={18} strokeWidth={iconStrokeWidth} />, label: homeCopy.search, body: homeCopy.manualIconSearch },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          transition={{ duration: 0 }}
          className="home-screen absolute inset-0 z-[900] flex justify-center overflow-hidden bg-[var(--app-page)] pointer-events-auto"
        >
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onAvatarInput}
          />

          <div ref={homeScrollRef} className={`relative h-full w-full max-w-[430px] overflow-y-auto overscroll-contain px-10 pb-28 [touch-action:pan-y] ${screenTopPaddingClass}`} style={{ WebkitOverflowScrolling: 'touch' }}>
            {!isSignedIn ? (
              <>
                <LoginWorldMapBackground />
                <div className="absolute right-3 top-4 z-20 flex rounded-full bg-[var(--app-card)] p-1 shadow-sm">
                  {LANGUAGE_OPTIONS.map(option => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => onLanguageChange(option.value)}
                      className={`h-8 min-w-8 rounded-full px-2 text-[12px] font-semibold transition-colors ${language === option.value ? 'bg-[var(--app-dark)] text-white' : 'text-black/55'}`}
                      aria-label={option.label}
                    >
                      {LOGIN_LANGUAGE_LABELS[option.value] || option.label}
                    </button>
                  ))}
                </div>
                {cloudAuthHydrating ? (
                  <div className="relative z-10 flex min-h-full flex-col items-center justify-center">
                    <div className="relative flex w-full flex-col items-center">
                      <div className="relative z-10 mb-8 w-full text-center">
                        <h1 className="app-display-title text-[36px] font-bold leading-none text-black">
                          My life memory
                        </h1>
                      </div>
                      <div className="relative z-10 w-full rounded-[18px] bg-[var(--app-card)] p-4 text-center text-[15px] font-medium text-black/55">
                        {homeCopy.restoringSession}
                      </div>
                    </div>
                  </div>
                ) : (
                <form
                  onSubmit={authMode === 'register' ? onRegisterSubmit : onLoginSubmit}
                  className="relative z-10 flex min-h-full flex-col items-center justify-center"
                >
                  <div className="relative flex w-full flex-col items-center">
                    <div className="relative z-10 mb-8 w-full text-center">
                      <h1 className="app-display-title text-[36px] font-bold leading-none text-black">
                        My life memory
                      </h1>
                    </div>
                    <div className="relative z-10 w-full rounded-[18px] bg-[var(--app-card)] p-4">
                      <div className="mb-4 flex items-center gap-2 text-[18px] font-medium text-black">
                        <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                        {authMode === 'register' ? homeCopy.registerTitle : homeCopy.loginTitle}
                      </div>
                      <div className="mb-4 text-[15px] font-medium leading-tight text-black/45">
                        {authMode === 'register' ? homeCopy.registerHint : homeCopy.loginHint}
                      </div>
                      {cloudConfigError && (
                        <div className="mb-4 rounded-[12px] bg-black/8 px-3 py-2 text-[12px] leading-5 text-black/65">
                          {homeCopy.cloudConfigInvalid}
                        </div>
                      )}
                      <div className="space-y-3">
                        <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                          <AtSign size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                          <input
                            value={loginAccount}
                            onChange={event => {
                              onLoginAccountChange(event.target.value);
                              onLoginErrorChange('');
                              onPasswordRevealChange(false);
                            }}
                            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                            placeholder={homeCopy.account}
                          />
                        </label>
                        <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                          <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                          <input
                            value={loginPassword}
                            onChange={event => {
                              onLoginPasswordChange(event.target.value);
                              onLoginErrorChange('');
                              onPasswordRevealChange(false);
                            }}
                            type="password"
                            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                            placeholder={authMode === 'register' ? homeCopy.registerPassword : homeCopy.loginPassword}
                          />
                        </label>
                        {authMode === 'register' && (
                          <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                            <Asterisk size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                            <input
                              value={registerInviteCode}
                              onChange={event => {
                                onRegisterInviteCodeChange(event.target.value);
                                onLoginErrorChange('');
                              }}
                              type="password"
                              autoComplete="off"
                              className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                              placeholder={homeCopy.inviteCode}
                            />
                          </label>
                        )}
                      </div>
                      {loginError && (
                        <div className="mt-3 text-[13px] font-medium text-black/45">
                          {loginError}
                        </div>
                      )}
                      <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                          type="submit"
                          disabled={isAuthBusy}
                          onClick={event => {
                            if (authMode !== 'login') {
                              event.preventDefault();
                            }
                            onAuthModeChange('login');
                            onRegisterInviteCodeChange('');
                          }}
                          className="h-[48px] rounded-full bg-[var(--app-dark)] text-[16px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                        >
                          {isAuthBusy && authMode === 'login' ? homeCopy.loggingIn : homeCopy.login}
                        </button>
                        <button
                          type="button"
                          disabled={isAuthBusy}
                          onClick={event => {
                            if (authMode !== 'register') {
                              onAuthModeChange('register');
                              onLoginErrorChange('');
                              onPasswordRevealChange(false);
                              return;
                            }
                            void onRegisterSubmit(event);
                          }}
                          className="h-[48px] rounded-full bg-[var(--app-soft-surface)] text-[16px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
                        >
                          {isAuthBusy && authMode === 'register' ? homeCopy.registering : homeCopy.register}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
                )}
              </>
            ) : !activeHomePanel && (
              <>
                <div className="flex items-center gap-8">
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] bg-[var(--app-card)] text-black"
                    aria-label={homeCopy.uploadAvatar}
                  >
                    {profileAvatarSrc ? (
                      <img src={profileAvatarSrc} alt={homeCopy.userAvatarAlt} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[var(--app-card)]">
                        <UserRound size={42} strokeWidth={iconStrokeWidth} />
                      </div>
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="truncate text-[26px] font-semibold leading-tight text-black">{profile.name || homeCopy.userFallback}</div>
                    <div className="mt-1.5 text-[14px] font-medium leading-tight text-black">ID:{profile.account || '----'}</div>
                  </div>
                </div>

                <div className="mt-14 space-y-2.5">
                  {homeMenuItems.map(item => (
                    <button
                      key={item.panel}
                      onClick={() => onActiveHomePanelChange(item.panel)}
                      className="flex h-[58px] w-full items-center rounded-[14px] bg-[var(--app-card)] px-4 text-left text-black transition-transform active:scale-[0.99]"
                    >
                      <span className="mr-4 flex shrink-0 items-center justify-center text-black">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-[18px] font-medium leading-tight">{item.label}</span>
                      <ChevronRight
                        size={28}
                        strokeWidth={iconStrokeWidth}
                        className="ml-3 text-black/15"
                      />
                    </button>
                  ))}
                </div>
              </>
            )}

            {isSignedIn && activeHomePanel && (
              <button
                type="button"
                onClick={onCloseHomePanel}
                className="mb-5 isolate flex h-11 items-center gap-2 overflow-hidden rounded-full bg-[var(--app-card)] px-4 text-[18px] font-medium text-black no-underline outline-none"
                aria-label={homeCopy.back}
              >
                <ChevronLeft size={24} strokeWidth={iconStrokeWidth} />
                <span className="block translate-y-[-1px] leading-none no-underline [text-decoration:none]">{activeHomeTitle}</span>
              </button>
            )}

            <AnimatePresence mode="wait">
              {isSignedIn && activeHomePanel === 'profile' && (
                <HomeProfilePanel
                  homeCopy={homeCopy}
                  profile={profile}
                  profileAvatarSrc={profileAvatarSrc}
                  isCloudBackendEnabled={isCloudBackendEnabled}
                  isPasswordRevealed={isPasswordRevealed}
                  passwordChangeStatus={passwordChangeStatus}
                  onAvatarClick={() => avatarInputRef.current?.click()}
                  onProfileNameChange={onProfileNameChange}
                  onProfilePasswordChange={onProfilePasswordChange}
                  onOpenPasswordChange={onOpenPasswordChange}
                  onTogglePasswordReveal={() => onPasswordRevealChange(previous => !previous)}
                />
              )}

              {isSignedIn && activeHomePanel === 'theme' && (
                <HomeThemePanel
                  homeCopy={homeCopy}
                  language={language}
                  systemTheme={systemTheme}
                  themeColorControls={themeColorControls}
                  activeThemeColorKey={activeThemeColorKey}
                  showThemeCustomPicker={showThemeCustomPicker}
                  onPresetSelect={onThemePresetSelect}
                  onThemeColorMenuToggle={onThemeColorMenuToggle}
                  onThemeColorChange={onThemeColorChange}
                  onToggleThemeCustomPicker={onToggleThemeCustomPicker}
                />
              )}

              {isSignedIn && activeHomePanel === 'gallery' && (
                <HomeGalleryPanel
                  homeCopy={homeCopy}
                  uploadedImages={uploadedImages}
                  onPreviewImage={onPreviewImage}
                />
              )}

              {isSignedIn && isHomeSettingsPanel(activeHomePanel) && (
                <HomeSettingsPanels
                  activeHomePanel={activeHomePanel}
                  homeCopy={homeCopy}
                  language={language}
                  permissionRequestState={permissionRequestState}
                  permissionStatusText={permissionStatusText}
                  settingsMenuItems={settingsMenuItems}
                  manualIconGuide={manualIconGuide}
                  apiSecurityCards={apiSecurityCards}
                  cloudMemoryApiEndpoint={cloudMemoryApiEndpoint}
                  cloudMcpEndpoint={cloudMcpEndpoint}
                  mcpHeaderValue={mcpHeaderValue}
                  mcpPlainToken={mcpPlainToken}
                  mcpTokenStatus={mcpTokenStatus}
                  mcpTokens={mcpTokens}
                  isMcpTokenBusy={isMcpTokenBusy}
                  isExportingData={isExportingData}
                  exportDataStatus={exportDataStatus}
                  onOpenPanel={onActiveHomePanelChange}
                  onLanguageChange={onLanguageChange}
                  onOpenPermissions={onOpenPermissions}
                  onSignOut={onSignOut}
                  onExportUserData={onExportUserData}
                  onCopyMcpText={onCopyMcpText}
                  onCreateMcpToken={onCreateMcpToken}
                  onRevokeMcpToken={onRevokeMcpToken}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
