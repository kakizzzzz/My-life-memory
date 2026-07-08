import React from 'react';
import { BookOpen, ChevronRight, Download, KeyRound, Languages, Lock, MapPin, ShieldCheck } from 'lucide-react';
import type { CloudMcpTokenInfo } from './lib/cloudBackend';
import { LANGUAGE_OPTIONS } from './constants/language';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE, UI_ICON_STROKE } from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';
import type { HomePanel } from './types/app';

export type HomeSettingsPanel = Extract<HomePanel, 'settings' | 'language' | 'permissions' | 'manual' | 'apiSecurity' | 'mcp' | 'export'>;

type HomeCopy = typeof HOME_COPY.en;

export type SettingsMenuItem = {
  panel: Extract<HomePanel, 'language' | 'permissions' | 'manual' | 'apiSecurity' | 'mcp' | 'export'>;
  label: string;
  icon: React.ReactNode;
  hidden?: boolean;
};

type ManualIconGuideItem = {
  icon: React.ReactNode;
  label: string;
  body: string;
};

type ApiSecurityCard = {
  title: string;
  body: string;
};

type HomeSettingsPanelsProps = {
  activeHomePanel: HomeSettingsPanel;
  homeCopy: HomeCopy;
  language: string;
  permissionRequestState: 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';
  permissionStatusText: string;
  settingsMenuItems: SettingsMenuItem[];
  manualIconGuide: ManualIconGuideItem[];
  apiSecurityCards: ApiSecurityCard[];
  cloudMemoryApiEndpoint: string;
  cloudMcpEndpoint: string;
  mcpHeaderValue: string;
  mcpPlainToken: string;
  mcpTokenStatus: string;
  mcpTokens: CloudMcpTokenInfo[];
  isMcpTokenBusy: boolean;
  isExportingData: boolean;
  exportDataStatus: string;
  onOpenPanel: (panel: SettingsMenuItem['panel']) => void;
  onLanguageChange: (language: string) => void;
  onOpenPermissions: () => void;
  onSignOut: () => void;
  onExportUserData: () => void;
  onCopyMcpText: (text: string) => void;
  onCreateMcpToken: () => void;
  onRevokeMcpToken: (tokenId: string) => void;
};

export const isHomeSettingsPanel = (panel: HomePanel): panel is HomeSettingsPanel => (
  panel === 'settings' ||
  panel === 'language' ||
  panel === 'permissions' ||
  panel === 'manual' ||
  panel === 'apiSecurity' ||
  panel === 'mcp' ||
  panel === 'export'
);

export function HomeSettingsPanels({
  activeHomePanel,
  homeCopy,
  language,
  permissionRequestState,
  permissionStatusText,
  settingsMenuItems,
  manualIconGuide,
  apiSecurityCards,
  cloudMemoryApiEndpoint,
  cloudMcpEndpoint,
  mcpHeaderValue,
  mcpPlainToken,
  mcpTokenStatus,
  mcpTokens,
  isMcpTokenBusy,
  isExportingData,
  exportDataStatus,
  onOpenPanel,
  onLanguageChange,
  onOpenPermissions,
  onSignOut,
  onExportUserData,
  onCopyMcpText,
  onCreateMcpToken,
  onRevokeMcpToken,
}: HomeSettingsPanelsProps) {
  if (activeHomePanel === 'settings') {
    return (
      <div className="mt-4 space-y-3">
        {settingsMenuItems.filter(item => !item.hidden).map(item => (
          <button
            type="button"
            key={item.panel}
            onClick={() => onOpenPanel(item.panel)}
            className="flex h-[52px] w-full items-center rounded-[14px] bg-[var(--app-card)] px-3 text-left text-black transition-transform active:scale-[0.99]"
          >
            <span className="mr-3 flex shrink-0 items-center justify-center text-black/60">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-black/60">{item.label}</span>
            <ChevronRight size={24} strokeWidth={UI_ICON_STROKE} className="ml-3 text-black/15" />
          </button>
        ))}
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.accountAccess}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98]"
          >
            {homeCopy.exit}
          </button>
        </div>
      </div>
    );
  }

  if (activeHomePanel === 'language') {
    return (
      <div className="mt-4">
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <Languages size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.language}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {LANGUAGE_OPTIONS.map(option => (
              <button
                type="button"
                key={option.value}
                onClick={() => onLanguageChange(option.value)}
                className={`h-9 rounded-full text-[14px] font-medium transition-colors ${language === option.value ? 'bg-[var(--app-dark)] text-white' : 'bg-[var(--app-soft-card)] text-black'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (activeHomePanel === 'permissions') {
    return (
      <div className="mt-4">
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <MapPin size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.openPermissionsHint}
          </div>
          <button
            type="button"
            onClick={onOpenPermissions}
            disabled={permissionRequestState === 'requesting'}
            className="h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {permissionRequestState === 'requesting' ? homeCopy.permissionRequesting : homeCopy.openPermissions}
          </button>
          {permissionStatusText && (
            <div className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/45">
              {permissionStatusText}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeHomePanel === 'manual') {
    return (
      <div className="mt-4">
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <BookOpen size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.userManual}
          </div>
          <div className="max-h-[58dvh] overflow-y-auto overscroll-contain pr-1" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="text-[13px] font-medium leading-snug text-black/55">
              {homeCopy.manualIntro}
            </div>
            <div className="mt-4 space-y-3">
              {homeCopy.manualSections.map(section => (
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
              {homeCopy.manualIconsTitle}
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
        </div>
      </div>
    );
  }

  if (activeHomePanel === 'apiSecurity') {
    return (
      <div className="mt-4 space-y-3">
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <ShieldCheck size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.apiSecurity}
          </div>
          <div className="space-y-2">
            <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <div className="text-[12px] font-medium text-black/42">{homeCopy.apiMemoryApiTitle}</div>
              <div className="mt-1 break-all text-[12px] font-medium leading-snug text-black/72">{cloudMemoryApiEndpoint || homeCopy.cloudConfigInvalid}</div>
            </div>
            <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <div className="text-[12px] font-medium text-black/42">{homeCopy.apiMcpSecurityTitle}</div>
              <div className="mt-1 break-all text-[12px] font-medium leading-snug text-black/72">{cloudMcpEndpoint || homeCopy.cloudConfigInvalid}</div>
            </div>
            <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpHeaderName}</div>
              <div className="mt-1 break-all text-[12px] font-medium leading-snug text-black/72">Bearer &lt;MCP Token&gt;</div>
            </div>
          </div>
        </div>

        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="space-y-3">
            {apiSecurityCards.map(card => (
              <div key={card.title}>
                <div className="text-[13px] font-semibold leading-tight text-black">
                  {card.title}
                </div>
                <div className="mt-1 text-[12px] font-medium leading-snug text-black/50">
                  {card.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (activeHomePanel === 'export') {
    return (
      <div className="mt-4">
        <div className="rounded-[14px] bg-[var(--app-card)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-medium text-black/60">
            <Download size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
            {homeCopy.exportData}
          </div>
          <button
            type="button"
            onClick={onExportUserData}
            disabled={isExportingData}
            className="h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {isExportingData ? homeCopy.exportingData : homeCopy.exportJson}
          </button>
          {exportDataStatus && (
            <div className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/45">
              {exportDataStatus}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-[14px] bg-[var(--app-card)] p-3">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-medium text-black/60">
          <KeyRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
          {homeCopy.mcpAccess}
        </div>
        <div className="space-y-2">
          <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
            <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpNameLabel}</div>
            <div className="mt-1 break-all text-[13px] font-medium leading-snug text-black/72">{homeCopy.mcpNameValue}</div>
          </div>
          <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
            <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpTransportLabel}</div>
            <div className="mt-1 break-all text-[13px] font-medium leading-snug text-black/72">{homeCopy.mcpTransportValue}</div>
          </div>
          <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
            <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpEndpoint}</div>
            <div className="mt-1 break-all text-[12px] font-medium leading-snug text-black/72">{cloudMcpEndpoint}</div>
            <button
              type="button"
              onClick={() => onCopyMcpText(cloudMcpEndpoint)}
              className="mt-2 h-8 w-full rounded-full bg-white/70 text-[12px] font-medium text-black transition-transform active:scale-[0.98]"
            >
              {homeCopy.mcpCopyEndpoint}
            </button>
          </div>
          <div className="rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
            <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpCustomHeader}</div>
            <div className="mt-2 rounded-[10px] bg-white/55 px-3 py-2">
              <div className="text-[12px] font-medium text-black/42">{homeCopy.mcpHeaderName}</div>
              <div className={`mt-1 break-all text-[12px] font-medium leading-snug ${mcpPlainToken ? 'text-black/72' : 'text-black/35'}`}>
                {mcpHeaderValue}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCopyMcpText(mcpHeaderValue)}
              disabled={!mcpPlainToken}
              className="mt-2 h-8 w-full rounded-full bg-white/70 text-[12px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-45"
            >
              {homeCopy.mcpCopyHeader}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateMcpToken}
          disabled={isMcpTokenBusy}
          className="mt-3 h-10 w-full rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {isMcpTokenBusy ? homeCopy.mcpGenerating : homeCopy.mcpGenerateToken}
        </button>
        {(mcpTokenStatus || mcpPlainToken) && (
          <div className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/45">
            {mcpTokenStatus || homeCopy.mcpTokenWarning}
          </div>
        )}
      </div>

      <div className="rounded-[14px] bg-[var(--app-card)] p-3">
        <div className="mb-2 text-[13px] font-medium text-black/45">{homeCopy.mcpTokenPrefix}</div>
        <div className="space-y-1.5">
          {mcpTokens.length > 0 ? mcpTokens.map(token => (
            <div key={token.id} className="flex items-center gap-2 rounded-[12px] bg-[var(--app-soft-card)] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-black/65">{token.name || homeCopy.mcpTokenPrefix}</div>
                <div className="truncate text-[11px] font-medium text-black/38">{token.tokenPrefix}</div>
              </div>
              <button
                type="button"
                onClick={() => onRevokeMcpToken(token.id)}
                disabled={isMcpTokenBusy}
                className="h-8 rounded-full bg-white/70 px-3 text-[12px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {homeCopy.mcpRevoke}
              </button>
            </div>
          )) : (
            <div className="px-1 text-[12px] font-medium leading-snug text-black/38">
              {homeCopy.mcpNoTokens}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
