const isInsideRotatedEllipse = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation = 0
) => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const rotatedX = dx * cos + dy * sin;
  const rotatedY = -dx * sin + dy * cos;

  return ((rotatedX * rotatedX) / (rx * rx)) + ((rotatedY * rotatedY) / (ry * ry)) <= 1;
};

const LOGIN_WORLD_MAP_WIDTH = 430;
const LOGIN_WORLD_MAP_HEIGHT = 932;
const LOGIN_WORLD_MAP_DOT_SPACING = 7;

const isLoginWorldMapLand = (x: number, y: number) => (
  isInsideRotatedEllipse(x, y, 0.10, 0.25, 0.18, 0.08, -0.25) ||
  isInsideRotatedEllipse(x, y, 0.20, 0.34, 0.15, 0.12, 0.08) ||
  isInsideRotatedEllipse(x, y, 0.30, 0.44, 0.08, 0.04, 0.25) ||
  isInsideRotatedEllipse(x, y, 0.31, 0.57, 0.10, 0.14, 0.12) ||
  isInsideRotatedEllipse(x, y, 0.48, 0.26, 0.10, 0.06, -0.1) ||
  isInsideRotatedEllipse(x, y, 0.54, 0.36, 0.09, 0.06, -0.08) ||
  isInsideRotatedEllipse(x, y, 0.55, 0.50, 0.10, 0.14, -0.1) ||
  isInsideRotatedEllipse(x, y, 0.72, 0.31, 0.20, 0.10, 0.03) ||
  isInsideRotatedEllipse(x, y, 0.82, 0.41, 0.15, 0.11, 0.12) ||
  isInsideRotatedEllipse(x, y, 0.68, 0.50, 0.06, 0.08, -0.15) ||
  isInsideRotatedEllipse(x, y, 0.79, 0.57, 0.09, 0.05, 0.35) ||
  isInsideRotatedEllipse(x, y, 0.83, 0.68, 0.10, 0.05, 0.08) ||
  isInsideRotatedEllipse(x, y, 0.47, 0.82, 0.45, 0.04, 0)
);

const LOGIN_WORLD_MAP_DOTS = Array.from({
  length: Math.ceil(LOGIN_WORLD_MAP_HEIGHT / LOGIN_WORLD_MAP_DOT_SPACING) + 1,
}).flatMap((_, row) => (
  Array.from({
    length: Math.ceil(LOGIN_WORLD_MAP_WIDTH / LOGIN_WORLD_MAP_DOT_SPACING) + 1,
  }).flatMap((__, col) => {
    const x = col * LOGIN_WORLD_MAP_DOT_SPACING + (row % 2 ? LOGIN_WORLD_MAP_DOT_SPACING / 2 : 0);
    const y = row * LOGIN_WORLD_MAP_DOT_SPACING;
    const normalizedX = x / LOGIN_WORLD_MAP_WIDTH;
    const normalizedY = y / LOGIN_WORLD_MAP_HEIGHT;
    if (!isLoginWorldMapLand(normalizedX, normalizedY)) return [];

    return [{
      x,
      y,
      opacity: 0.08 + ((col * 3 + row) % 6) * 0.018,
    }];
  })
));

export function LoginWorldMapBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${LOGIN_WORLD_MAP_WIDTH} ${LOGIN_WORLD_MAP_HEIGHT}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        style={{ color: 'var(--app-dark)' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="login-map-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.18" />
            <stop offset="14%" stopColor="white" stopOpacity="0.50" />
            <stop offset="78%" stopColor="white" stopOpacity="0.72" />
            <stop offset="100%" stopColor="white" stopOpacity="0.30" />
          </linearGradient>
          <mask id="login-map-mask">
            <rect width={LOGIN_WORLD_MAP_WIDTH} height={LOGIN_WORLD_MAP_HEIGHT} fill="url(#login-map-fade)" />
          </mask>
        </defs>
        <g mask="url(#login-map-mask)">
          {LOGIN_WORLD_MAP_DOTS.map(dot => (
            <circle
              key={`${dot.x}-${dot.y}`}
              cx={dot.x}
              cy={dot.y}
              r="1.25"
              fill="currentColor"
              opacity={dot.opacity}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
