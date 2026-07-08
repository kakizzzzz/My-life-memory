import type { MapStyle } from './types/app';

export function MapStyleThumbnail({ styleName }: { styleName: MapStyle }) {
  const palette = {
    light: {
      background: '#e7e7e7',
      water: '#d4d4d4',
      land: '#ededed',
      major: '#ffffff',
      minor: '#bcbcbc',
      point: '#9f9f9f',
    },
    dark: {
      background: '#172630',
      water: '#243947',
      land: '#20313b',
      major: '#8da5b1',
      minor: '#526a75',
      point: '#b5c2c8',
    },
    aerial: {
      background: '#456c5c',
      water: '#365f73',
      land: '#6f7f55',
      major: '#d8cda8',
      minor: '#8c8c69',
      point: '#f0e8c9',
    },
  }[styleName];

  return (
    <div className="h-full w-full overflow-hidden" style={{ background: palette.background }}>
      <svg viewBox="0 0 48 48" className="h-full w-full" fill="none" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-4 31 C7 24 14 28 22 22 C30 16 35 18 52 7 L52 52 L-4 52 Z" fill={palette.water} opacity={styleName === 'light' ? 0.72 : 0.9} />
        <path d="M-5 10 C7 2 15 8 23 5 C32 2 39 7 53 -2 L53 18 C41 23 31 20 24 25 C16 31 7 26 -5 34 Z" fill={palette.land} opacity={styleName === 'aerial' ? 0.85 : 0.58} />
        <path d="M-5 38 C9 31 18 38 28 31 C37 25 42 28 53 21" stroke={palette.major} strokeWidth="4.4" strokeLinecap="round" opacity={styleName === 'aerial' ? 0.6 : 0.74} />
        <path d="M2 9 C11 16 17 18 25 16 C33 14 39 18 47 25" stroke={palette.major} strokeWidth="3" strokeLinecap="round" opacity={styleName === 'aerial' ? 0.5 : 0.72} />
        <path d="M12 -4 C13 9 14 19 17 28 C20 36 22 42 23 52" stroke={palette.minor} strokeWidth="2.1" strokeLinecap="round" opacity={styleName === 'light' ? 0.62 : 0.72} />
        <path d="M34 -4 C30 7 30 14 34 22 C38 30 38 38 34 52" stroke={palette.minor} strokeWidth="2.1" strokeLinecap="round" opacity={styleName === 'light' ? 0.54 : 0.7} />
        <circle cx="31.5" cy="19" r="2.4" fill={palette.point} opacity="0.86" />
      </svg>
    </div>
  );
}
