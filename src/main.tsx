import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import { AppErrorBoundary } from './AppErrorBoundary';
import { CloudSyncToast } from './CloudSyncToast';
import { APP_MOTION_SPRING } from './constants/motion';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={APP_MOTION_SPRING}>
      <AppErrorBoundary>
        <App />
        <CloudSyncToast />
      </AppErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('App shell service worker could not be registered:', error);
    });
  });
}
