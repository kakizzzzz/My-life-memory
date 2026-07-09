import L from 'leaflet';

export function createLocationIcon(mapStyle: string, iconColor = '#c3c3c3', heading = 0) {
  const isAerial = mapStyle === 'aerial';
  const color = isAerial ? '#ffffff' : iconColor;
  const coneRotation = Number.isFinite(heading) ? heading + 90 : 90;

  return new L.DivIcon({
    className: 'app-location-div-icon',
    html: `
      <div class="app-location-marker" style="position: relative; width: 80px; height: 80px; pointer-events: none;">
          <svg width="80" height="80" viewBox="0 0 80 80" style="position: absolute; left: 0; top: 0; z-index: 1; transform: rotate(${coneRotation}deg); transform-origin: 40px 40px; transition: transform 160ms linear;">
              <defs>
                  <linearGradient id="coneGrad" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="8" y2="40">
                      <stop offset="0%" stop-color="${color}" stop-opacity="0.85" />
                      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
                  </linearGradient>
              </defs>
              <path d="M 8 27 L 40 40 L 8 53 Z" fill="url(#coneGrad)" />
          </svg>
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: black; border: 5px solid ${color}; border-radius: 50%; z-index: 2; box-sizing: content-box; box-shadow: 0 2px 6px rgba(0,0,0,0.3); pointer-events: none;"></div>
      </div>
    `,
    iconSize: [80, 80],
    iconAnchor: [40, 40],
  });
}
