export function PhotoGpsStarIcon({ size = 24, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3.2 16.25 7.3 12.1 3.1 8.75 8.85 8.1 12 3 15.15 8.1 20.9 8.75 16.7 12.1 20.8 16.25"
      />
      <path
        d="M8.95 16.35 12 12.85 15.05 16.35M12 12.85V18.35M7.2 19.7H16.8"
      />
    </svg>
  );
}
