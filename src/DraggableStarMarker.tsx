import React, { useEffect, useLayoutEffect } from 'react';
import L from 'leaflet';
import type { MapStyle, StarData } from './types/app';
import { SmoothMarker, type SmoothLeafletMarker } from './SmoothMarker';

type MarkerWithDragTolerance = L.Marker & {
  dragging?: {
    _draggable?: L.Draggable & {
      options: { clickTolerance: number };
    };
  };
};

const STAR_TOUCH_TOLERANCE = 16;
const NATIVE_CLICK_SUPPRESSION_MS = 700;

function createStarIcon(tagNumber?: number, colorHex?: string, isAerial?: boolean, badgeColor = '#c3c3c3') {
  const color = colorHex || '#EDC727';
  const badgeBg = isAerial ? '#ffffff' : badgeColor;

  const badgeHtml = tagNumber ? `
    <div style="position:absolute; bottom:-2px; right:-2px; background:${badgeBg}; color:black; font-weight:700; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px; font-family:Afacad, sans-serif; z-index:9999; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
      ${tagNumber}
    </div>
  ` : '';

  const gradientId = `starGrad_${color.replace('#','')}`;

  return new L.DivIcon({
    className: 'app-star-div-icon',
    html: `
      <div class="app-star-marker" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.15)) drop-shadow(0px 2px 4px rgba(0,0,0,0.12)); position: relative;">
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
          <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="15%" stop-color="${color}" />
              <stop offset="100%" stop-color="#ffffff" />
            </linearGradient>
          </defs>
          <polygon
            class="app-star-outline"
            points="12 4 14.35 8.76 19.61 9.53 15.8 13.24 16.7 18.47 12 16 7.3 18.47 8.2 13.24 4.39 9.53 9.65 8.76"
            fill="${color}"
            stroke="${color}"
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
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });
}

export const DraggableStarMarker = React.memo(function DraggableStarMarker({
  star,
  isSelected,
  isTagging,
  mapStyle,
  badgeColor,
  onSelect,
  onDragStart,
  onMove,
  onReady,
}: {
  star: StarData;
  isSelected: boolean;
  isTagging: boolean;
  mapStyle: MapStyle;
  badgeColor: string;
  onSelect: (id: string, event: L.LeafletMouseEvent) => void;
  onDragStart: () => void;
  onMove: (id: string, lat: number, lng: number) => void;
  onReady: (id: string) => void;
}) {
  const [markerPosition, setMarkerPosition] = React.useState<[number, number]>([star.lat, star.lng]);
  const isDraggingRef = React.useRef(false);
  const markerRef = React.useRef<SmoothLeafletMarker | null>(null);
  const onSelectRef = React.useRef(onSelect);
  const ignoreNativeClickUntilRef = React.useRef(0);

  onSelectRef.current = onSelect;

  const icon = React.useMemo(
    () => createStarIcon(star.tagOrder, star.color, mapStyle === 'aerial', badgeColor),
    [badgeColor, mapStyle, star.color, star.tagOrder]
  );

  useEffect(() => {
    if (!isDraggingRef.current) setMarkerPosition([star.lat, star.lng]);
  }, [star.lat, star.lng]);

  useEffect(() => {
    const draggable = (markerRef.current as MarkerWithDragTolerance | null)?.dragging?._draggable;
    if (draggable) draggable.options.clickTolerance = STAR_TOUCH_TOLERANCE;
  }, [isTagging]);

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const element = marker?.getElement();
    if (!marker || !element) return;

    let activePointer: { id: number; startX: number; startY: number; moved: boolean } | null = null;

    const finishPointerCapture = (event: PointerEvent) => {
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;

      activePointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      element.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      const movement = Math.abs(event.clientX - activePointer.startX)
        + Math.abs(event.clientY - activePointer.startY);
      if (movement >= STAR_TOUCH_TOLERANCE) activePointer.moved = true;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!activePointer || activePointer.id !== event.pointerId) return;

      const shouldSelect = !activePointer.moved && !isDraggingRef.current;
      activePointer = null;
      finishPointerCapture(event);
      ignoreNativeClickUntilRef.current = performance.now() + NATIVE_CLICK_SUPPRESSION_MS;

      if (shouldSelect) {
        queueMicrotask(() => {
          onSelectRef.current(star.id, { originalEvent: event } as unknown as L.LeafletMouseEvent);
        });
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      activePointer = null;
      finishPointerCapture(event);
      ignoreNativeClickUntilRef.current = performance.now() + NATIVE_CLICK_SUPPRESSION_MS;
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [icon, star.id]);

  useLayoutEffect(() => {
    markerRef.current?.getElement()?.classList.toggle('is-selected', isSelected);
  }, [icon, isSelected]);

  useLayoutEffect(() => {
    if (markerRef.current?.getElement()) onReady(star.id);
  }, [icon, onReady, star.id]);

  const eventHandlers = React.useMemo(() => ({
    click: (event: L.LeafletMouseEvent) => {
      if (performance.now() < ignoreNativeClickUntilRef.current) return;
      onSelect(star.id, event);
    },
    dragstart: () => {
      onDragStart();
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
  }), [onDragStart, onMove, onSelect, star.id]);

  return (
    <SmoothMarker
      ref={markerRef}
      position={markerPosition}
      icon={icon}
      draggable={!isTagging}
      bubblingMouseEvents={false}
      eventHandlers={eventHandlers}
    />
  );
});
