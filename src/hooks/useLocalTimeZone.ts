import React from 'react';
import { getLocalTimeZone } from '../lib/timeZone';

export const useLocalTimeZone = () => {
  const [timeZone, setTimeZone] = React.useState(getLocalTimeZone);

  React.useEffect(() => {
    const refresh = () => setTimeZone(current => {
      const next = getLocalTimeZone();
      return next === current ? current : next;
    });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  return timeZone;
};
