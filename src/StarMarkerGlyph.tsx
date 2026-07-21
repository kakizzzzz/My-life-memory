import React from 'react';

export function StarMarkerGlyph({ size = 36, color = '#EDC727' }: { size?: number; color?: string }) {
  const gradientId = React.useId().replace(/:/g, '');

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="15%" stopColor={color} />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <polygon
        points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76"
        fill={color}
        stroke={color}
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      <polygon
        points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76"
        fill={`url(#${gradientId})`}
        stroke={`url(#${gradientId})`}
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
