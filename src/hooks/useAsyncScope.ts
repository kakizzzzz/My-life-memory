import React from 'react';

export type AsyncScopeToken = {
  key: string;
  generation: number;
};

export const updateAsyncScopeToken = (
  current: AsyncScopeToken,
  scopeKey: string,
): AsyncScopeToken => (
  current.key === scopeKey
    ? current
    : { key: scopeKey, generation: current.generation + 1 }
);

export const asyncScopeTokenMatches = (
  current: AsyncScopeToken,
  candidate: AsyncScopeToken,
) => (
  candidate.key === current.key
  && candidate.generation === current.generation
);

export const useAsyncScope = (scopeKey: string) => {
  const scopeRef = React.useRef<AsyncScopeToken>({
    key: scopeKey,
    generation: 0,
  });

  React.useLayoutEffect(() => {
    scopeRef.current = updateAsyncScopeToken(scopeRef.current, scopeKey);
  }, [scopeKey]);

  const captureScope = React.useCallback((): AsyncScopeToken => ({
    ...scopeRef.current,
  }), []);

  const isScopeCurrent = React.useCallback((token: AsyncScopeToken) => (
    asyncScopeTokenMatches(scopeRef.current, token)
  ), []);

  return {
    captureScope,
    isScopeCurrent,
  };
};
