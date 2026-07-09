import React from 'react';
import {
  createCloudMcpToken,
  listCloudMcpTokens,
  revokeCloudMcpToken,
} from '../lib/cloudBackend';
import { isCloudBackendEnabled } from '../lib/supabaseClient';
import { copyToClipboard } from '../lib/generalUtils';
import type { CloudMcpTokenInfo } from '../lib/cloudBackend';
import type { HomePanel } from '../types/app';

type McpTokenCopy = {
  mcpFailed: string;
  mcpTokenReady: string;
  mcpCopied: string;
  mcpRevoked: string;
};

export const useMcpTokens = ({
  isSignedIn,
  activeHomePanel,
  account,
  copy,
}: {
  isSignedIn: boolean;
  activeHomePanel: HomePanel;
  account: string;
  copy: McpTokenCopy;
}) => {
  const [mcpTokens, setMcpTokens] = React.useState<CloudMcpTokenInfo[]>([]);
  const [mcpPlainToken, setMcpPlainToken] = React.useState('');
  const [mcpTokenStatus, setMcpTokenStatus] = React.useState('');
  const [isMcpTokenBusy, setIsMcpTokenBusy] = React.useState(false);

  const loadMcpTokens = React.useCallback(async () => {
    if (!isCloudBackendEnabled || !isSignedIn) return;
    try {
      const tokens = await listCloudMcpTokens();
      setMcpTokens(tokens);
    } catch (error) {
      console.error('Could not load MCP tokens:', error);
      setMcpTokenStatus(copy.mcpFailed);
    }
  }, [copy.mcpFailed, isSignedIn]);

  const handleCreateMcpToken = React.useCallback(async () => {
    if (isMcpTokenBusy) return;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    setMcpPlainToken('');
    try {
      const result = await createCloudMcpToken(`${account || 'My'} MCP`);
      setMcpPlainToken(result.token);
      setMcpTokens([result.tokenInfo]);
      setMcpTokenStatus(copy.mcpTokenReady);
    } catch (error) {
      console.error('Could not create MCP token:', error);
      setMcpTokenStatus(copy.mcpFailed);
    } finally {
      setIsMcpTokenBusy(false);
    }
  }, [account, copy.mcpFailed, copy.mcpTokenReady, isMcpTokenBusy]);

  const handleCopyMcpText = React.useCallback(async (text: string) => {
    try {
      await copyToClipboard(text);
      setMcpTokenStatus(copy.mcpCopied);
      window.setTimeout(() => setMcpTokenStatus(''), 800);
    } catch (error) {
      console.error('Could not copy MCP text:', error);
      setMcpTokenStatus(copy.mcpFailed);
    }
  }, [copy.mcpCopied, copy.mcpFailed]);

  const handleRevokeMcpToken = React.useCallback(async (tokenId: string) => {
    if (isMcpTokenBusy) return;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    try {
      await revokeCloudMcpToken(tokenId);
      setMcpTokens(current => current.filter(token => token.id !== tokenId));
      setMcpTokenStatus(copy.mcpRevoked);
    } catch (error) {
      console.error('Could not revoke MCP token:', error);
      setMcpTokenStatus(copy.mcpFailed);
    } finally {
      setIsMcpTokenBusy(false);
    }
  }, [copy.mcpFailed, copy.mcpRevoked, isMcpTokenBusy]);

  React.useEffect(() => {
    if (isSignedIn && activeHomePanel === 'mcp' && isCloudBackendEnabled) {
      void loadMcpTokens();
      return;
    }
    setMcpPlainToken('');
    setMcpTokenStatus('');
  }, [activeHomePanel, isSignedIn, loadMcpTokens]);

  return {
    mcpTokens,
    mcpPlainToken,
    mcpTokenStatus,
    isMcpTokenBusy,
    handleCreateMcpToken,
    handleCopyMcpText,
    handleRevokeMcpToken,
  };
};
