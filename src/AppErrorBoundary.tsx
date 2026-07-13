import React, { type ErrorInfo, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  failed: boolean;
};

const getErrorCopy = () => {
  const language = document.documentElement.lang.toLowerCase();
  if (language.startsWith('zh')) {
    return {
      message: '页面暂时无法显示。重新载入后，已保存的数据不会受到影响。',
      reload: '重新载入',
    };
  }
  if (language.startsWith('ko')) {
    return {
      message: '페이지를 일시적으로 표시할 수 없습니다. 다시 불러와도 저장된 데이터는 영향을 받지 않습니다.',
      reload: '다시 불러오기',
    };
  }
  return {
    message: 'This page cannot be displayed right now. Reloading will not affect saved data.',
    reload: 'Reload',
  };
};

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('My Life Memory render failed.', {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const copy = getErrorCopy();

    return (
      <main className="fixed inset-0 flex min-h-[100svh] items-center justify-center bg-[#e5e5e5] px-8 text-center text-black">
        <section className="w-full max-w-sm" aria-live="assertive">
          <h1 className="text-3xl font-semibold">My life memory</h1>
          <p className="mt-5 text-base leading-7 text-neutral-600">
            {copy.message}
          </p>
          <button
            type="button"
            onClick={this.reload}
            className="mt-7 min-h-12 w-full rounded-md bg-neutral-700 px-5 py-3 text-base text-white"
          >
            {copy.reload}
          </button>
        </section>
      </main>
    );
  }
}
