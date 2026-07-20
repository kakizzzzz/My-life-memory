import React, { useEffect } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import type { MapStyle, StarData } from './types/app';

type MarkerWithDragTolerance = L.Marker & {
  dragging?: {
    _draggable?: L.Draggable & {
      options: { clickTolerance: number };
    };
  };
};

function createStarIcon(tagNumber?: number, isSelected?: boolean, colorHex?: string, isAerial?: boolean, badgeColor = '#c3c3c3') {
  const color = colorHex || '#EDC727';
  const badgeBg = isAerial ? '#ffffff' : badgeColor;

  const badgeHtml = tagNumber ? `
    <div style="position:absolute; bottom:-2px; right:-2px; background:${badgeBg}; color:black; font-weight:700; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px; font-family:Afacad, sans-serif; z-index:9999; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
      ${tagNumber}
    </div>
  ` : '';

  const strokeColor = isSelected ? '#000000' : color;
  const gradientId = `starGrad_${color.replace('#','')}${isSelected ? 'Selected' : ''}`;

  return new L.DivIcon({
    className: 'app-star-div-icon',
    html: `
      <div class="app-star-marker" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.15)) drop-shadow(0px 2px 4px rgba(0,0,0,0.12)); position: relative;">
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="overflow: visible; ${isSelected ? 'z-index: 10;' : ''}">
          <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="15%" stop-color="${color}" />
              <stop offset="100%" stop-color="#ffffff" />
            </linearGradient>
          </defs>
          <polygon
            points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76"
            fill="${strokeColor}"
            stroke="${strokeColor}"
            stroke-width="5.5"
            stroke-linejoin="round"
          />
          <polygon
            points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76"
            fill="url(#${gradientId})"
            stroke="url(#${gradientId})"
            stroke-width="4.5"
            stroke-linejoin="round"
          />
        </svg>
        ${badgeHtml}
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

export function DraggableStarMarker({
  star,
  isSelected,
  mapStyle,
  badgeColor,
  onSelect,
  onMove,
}: {
  star: StarData;
  isSelected: boolean;
  mapStyle: MapStyle;
  badgeColor: string;
  onSelect: (id: string, event: L.LeafletMouseEvent) => void;
  onMove: (id: string, lat: number, lng: number) => void;
}) {
  const [markerPosition, setMarkerPosition] = React.useState<[number, number]>([star.lat, star.lng]);
  const isDraggingRef = React.useRef(false);
  const markerRef = React.useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!isDraggingRef.current) setMarkerPosition([star.lat, star.lng]);
  }, [star.lat, star.lng]);

  useEffect(() => {
    const draggable = (markerRef.current as MarkerWithDragTolerance | null)?.dragging?._draggable;
    if (draggable) draggable.options.clickTolerance = 10;
  }, []);

  const icon = React.useMemo(
    () => createStarIcon(star.tagOrder, isSelected, star.color, mapStyle === 'aerial', badgeColor),
    [badgeColor, isSelected, mapStyle, star.color, star.tagOrder]
  );

  const eventHandlers = React.useMemo(() => ({
    click: (event: L.LeafletMouseEvent) => {
      onSelect(star.id, event);
    },
    dragstart: () => {
      isDraggingRef.current = true;
    },
    drag: (event: L.LeafletEvent) => {
      const marker = event.target as L.Marker;
      const position = marker.getLatLng();
      setMarkerPosition([position.lat, position.lng]);
    },
    dragend: (event: L.LeafletEvent) => {
      const marker = event.target as L.Marker;
      const position = marker.getLatLng();
      setMarkerPosition([position.lat, position.lng]);
      isDraggingRef.current = false;
      onMove(star.id, position.lat, position.lng);
    },
  }), [onMove, onSelect, star.id]);

  return (
    <Marker
      ref={markerRef}
      position={markerPosition}
      icon={icon}
      draggable
      bubblingMouseEvents={false}
      eventHandlers={eventHandlers}
    />
  );
}
