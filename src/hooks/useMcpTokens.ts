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
  const requestGenerationRef = React.useRef(0);
  const statusTimerRef = React.useRef<number | null>(null);

  const clearStatusTimer = React.useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const loadMcpTokens = React.useCallback(async (generation: number) => {
    if (!isCloudBackendEnabled || !isSignedIn) return;
    try {
      const tokens = await listCloudMcpTokens();
      if (requestGenerationRef.current !== generation) return;
      setMcpTokens(tokens);
    } catch (error) {
      if (requestGenerationRef.current !== generation) return;
      console.error('Could not load MCP tokens:', error);
      setMcpTokens([]);
      setMcpTokenStatus(copy.mcpFailed);
    }
  }, [copy.mcpFailed, isSignedIn]);

  const handleCreateMcpToken = React.useCallback(async () => {
    if (isMcpTokenBusy) return;
    const generation = requestGenerationRef.current;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    setMcpPlainToken('');
    try {
      const result = await createCloudMcpToken(`${account || 'My'} MCP`);
      if (requestGenerationRef.current !== generation) return;
      setMcpPlainToken(result.token);
      setMcpTokens([result.tokenInfo]);
      setMcpTokenStatus(copy.mcpTokenReady);
    } catch (error) {
      if (requestGenerationRef.current !== generation) return;
      console.error('Could not create MCP token:', error);
      setMcpTokenStatus(copy.mcpFailed);
    } finally {
      if (requestGenerationRef.current === generation) setIsMcpTokenBusy(false);
    }
  }, [account, copy.mcpFailed, copy.mcpTokenReady, isMcpTokenBusy]);

  const handleCopyMcpText = React.useCallback(async (text: string) => {
    const generation = requestGenerationRef.current;
    try {
      await copyToClipboard(text);
      if (requestGenerationRef.current !== generation) return;
      clearStatusTimer();
      setMcpTokenStatus(copy.mcpCopied);
      statusTimerRef.current = window.setTimeout(() => {
        statusTimerRef.current = null;
        if (requestGenerationRef.current === generation) setMcpTokenStatus('');
      }, 800);
    } catch (error) {
      if (requestGenerationRef.current !== generation) return;
      console.error('Could not copy MCP text:', error);
      setMcpTokenStatus(copy.mcpFailed);
    }
  }, [clearStatusTimer, copy.mcpCopied, copy.mcpFailed]);

  const handleRevokeMcpToken = React.useCallback(async (tokenId: string) => {
    if (isMcpTokenBusy) return;
    const generation = requestGenerationRef.current;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    try {
      await revokeCloudMcpToken(tokenId);
      if (requestGenerationRef.current !== generation) return;
      setMcpTokens(current => current.filter(token => token.id !== tokenId));
      setMcpTokenStatus(copy.mcpRevoked);
    } catch (error) {
      if (requestGenerationRef.current !== generation) return;
      console.error('Could not revoke MCP token:', error);
      setMcpTokenStatus(copy.mcpFailed);
    } finally {
      if (requestGenerationRef.current === generation) setIsMcpTokenBusy(false);
    }
  }, [copy.mcpFailed, copy.mcpRevoked, isMcpTokenBusy]);

  React.useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    clearStatusTimer();
    setMcpTokens([]);
    setMcpPlainToken('');
    setMcpTokenStatus('');
    setIsMcpTokenBusy(false);

    if (isSignedIn && activeHomePanel === 'mcp' && isCloudBackendEnabled) {
      void loadMcpTokens(generation);
    }
  }, [account, activeHomePanel, clearStatusTimer, isSignedIn, loadMcpTokens]);

  React.useEffect(() => () => {
    requestGenerationRef.current += 1;
    clearStatusTimer();
  }, [clearStatusTimer]);

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
