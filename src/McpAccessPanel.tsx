import { Copy, KeyRound } from 'lucide-react';
import type { CloudMcpTokenInfo } from './lib/cloudBackend';
import { HOME_SETTINGS_ICON_SIZE, HOME_SETTINGS_ICON_STROKE, UI_ICON_STROKE } from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';

type HomeCopy = typeof HOME_COPY.en;

type McpAccessPanelProps = {
  homeCopy: HomeCopy;
  cloudMcpEndpoint: string;
  mcpHeaderValue: string;
  mcpPlainToken: string;
  mcpTokenStatus: string;
  mcpTokens: CloudMcpTokenInfo[];
  isMcpTokenBusy: boolean;
  onCopyMcpText: (text: string) => void;
  onCreateMcpToken: () => void;
  onRevokeMcpToken: (tokenId: string) => void;
};

type CopyActionProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

function CopyAction({ label, disabled = false, onClick }: CopyActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--app-soft-card)] text-black/65 transition-transform active:scale-[0.96] disabled:opacity-35"
    >
      <Copy size={19} strokeWidth={UI_ICON_STROKE} />
    </button>
  );
}

export function McpAccessPanel({
  homeCopy,
  cloudMcpEndpoint,
  mcpHeaderValue,
  mcpPlainToken,
  mcpTokenStatus,
  mcpTokens,
  isMcpTokenBusy,
  onCopyMcpText,
  onCreateMcpToken,
  onRevokeMcpToken,
}: McpAccessPanelProps) {
  return (
    <div className="mt-4 pb-4">
      <section className="rounded-[14px] bg-[var(--app-card)] p-3.5">
        <div className="flex items-center gap-2 text-[14px] font-medium text-black/65">
          <KeyRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
          {homeCopy.mcpAccess}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-black/42">{homeCopy.mcpNameLabel}</div>
            <div className="mt-1 truncate text-[13px] font-medium text-black/72">{homeCopy.mcpNameValue}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-black/42">{homeCopy.mcpTransportLabel}</div>
            <div className="mt-1 text-[13px] font-medium leading-tight text-black/72">{homeCopy.mcpTransportValue}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-black/[0.07] pt-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 py-0.5">
              <div className="text-[11px] font-medium text-black/42">{homeCopy.mcpEndpoint}</div>
              <div className="mt-1 break-all text-[12px] font-medium leading-snug text-black/72">
                {cloudMcpEndpoint}
              </div>
            </div>
            <CopyAction
              label={homeCopy.mcpCopyEndpoint}
              disabled={!cloudMcpEndpoint}
              onClick={() => onCopyMcpText(cloudMcpEndpoint)}
            />
          </div>
        </div>

        <div className="mt-3 border-t border-black/[0.07] pt-3">
          <div className="text-[11px] font-medium text-black/42">{homeCopy.mcpCustomHeader}</div>
          <div className="mt-1.5 flex items-start gap-3">
            <div className="min-w-0 flex-1 py-0.5">
              <div className="text-[12px] font-medium text-black/62">{homeCopy.mcpHeaderName}</div>
              <div className={`mt-1 break-all text-[12px] font-medium leading-snug ${mcpPlainToken ? 'text-black/72' : 'text-black/35'}`}>
                {mcpHeaderValue}
              </div>
            </div>
            <CopyAction
              label={homeCopy.mcpCopyHeader}
              disabled={!mcpPlainToken}
              onClick={() => onCopyMcpText(mcpHeaderValue)}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onCreateMcpToken}
          disabled={isMcpTokenBusy}
          className="mt-4 h-11 w-full rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {isMcpTokenBusy ? homeCopy.mcpGenerating : homeCopy.mcpGenerateToken}
        </button>

        {(mcpTokenStatus || mcpPlainToken) && (
          <div role="status" aria-live="polite" className="mt-2 px-1 text-[12px] font-medium leading-snug text-black/45">
            {mcpTokenStatus || homeCopy.mcpTokenWarning}
          </div>
        )}

        <div className="mt-4 border-t border-black/[0.07] pt-3">
          <div className="mb-2 text-[12px] font-medium text-black/42">{homeCopy.mcpTokenPrefix}</div>
          {mcpTokens.length > 0 ? mcpTokens.map(token => (
            <div key={token.id} className="flex min-h-11 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-black/65">{token.name || homeCopy.mcpTokenPrefix}</div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-black/38">{token.tokenPrefix}</div>
              </div>
              <button
                type="button"
                onClick={() => onRevokeMcpToken(token.id)}
                disabled={isMcpTokenBusy}
                className="h-9 shrink-0 rounded-full bg-[var(--app-soft-card)] px-3 text-[12px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {homeCopy.mcpRevoke}
              </button>
            </div>
          )) : (
            <div className="text-[12px] font-medium leading-snug text-black/38">
              {homeCopy.mcpNoTokens}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
