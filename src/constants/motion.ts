export const APP_MOTION_SPRING = {
  type: 'spring',
  duration: 0.32,
  bounce: 0,
} as const;

export const APP_NAV_SPRING = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.7,
} as const;

export const APP_CONTENT_INITIAL_OPACITY = 0.96;

export const APP_CONTENT_FADE = {
  duration: 0.12,
  ease: [0.22, 1, 0.36, 1],
} as const;
