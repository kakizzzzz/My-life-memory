import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { APP_CONTENT_FADE, APP_CONTENT_INITIAL_OPACITY } from './constants/motion';

export function AppPageTransitionLayer({
  children,
  scroll = false,
  isActive = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  isActive?: boolean;
}) {
  const outerClassName = scroll
    ? 'absolute inset-0 z-[900] overflow-x-hidden overflow-y-auto overscroll-contain bg-[var(--app-page)] [touch-action:pan-y] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    : 'absolute inset-0 z-[900] overflow-hidden bg-[var(--app-page)]';
  const contentClassName = scroll ? 'min-h-full w-full' : 'absolute inset-0';

  return (
    <div
      aria-hidden={!isActive}
      className={`${outerClassName} ${isActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        display: isActive ? undefined : 'none',
        WebkitOverflowScrolling: scroll ? 'touch' : undefined,
      }}
    >
      <motion.div
        initial={{ opacity: APP_CONTENT_INITIAL_OPACITY }}
        animate={{ opacity: isActive ? 1 : APP_CONTENT_INITIAL_OPACITY }}
        transition={APP_CONTENT_FADE}
        className={contentClassName}
        style={{ willChange: 'opacity' }}
      >
        {children}
      </motion.div>
    </div>
  );
}
