import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { StarData } from './types/app';
import { latLngToContinuousLayerPoint } from './SmoothMarker';
import { cancelFluidMapFlight, getStandardStarFlightOptions, startFluidMapFlight } from './mapMotion';

export function FlyToTarget({ target }: { target: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;
    startFluidMapFlight(map, target, getStandardStarFlightOptions(map, target));
  }, [target, map]);

  useEffect(() => () => cancelFluidMapFlight(map), [map]);

  return null;
}

export function MapViewportSync({ location, shouldFollow }: { location: [number, number]; shouldFollow: boolean }) {
  const map = useMap();
  const locationRef = React.useRef(location);
  const shouldFollowRef = React.useRef(shouldFollow);

  useEffect(() => {
    locationRef.current = location;
    shouldFollowRef.current = shouldFollow;
  }, [location, shouldFollow]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const recenterIfNeeded = () => {
      if (!shouldFollowRef.current) return;
      map.panTo(locationRef.current, { animate: false });
    };

    const syncMapSize = () => {
      const run = () => {
        map.invalidateSize({ pan: false, debounceMoveend: true });
        recenterIfNeeded();
      };

      frameIds.push(window.requestAnimationFrame(run));
    };

    const scheduleViewportSync = () => {
      syncMapSize();
      [120, 360, 900].forEach(delay => {
        timeoutIds.push(window.setTimeout(syncMapSize, delay));
      });
    };

    scheduleViewportSync();

    window.addEventListener('resize', scheduleViewportSync);
    window.addEventListener('orientationchange', scheduleViewportSync);
    window.addEventListener('pageshow', scheduleViewportSync);
    window.visualViewport?.addEventListener('resize', scheduleViewportSync);
    window.visualViewport?.addEventListener('scroll', scheduleViewportSync);

    return () => {
      frameIds.forEach(frameId => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId));
      window.removeEventListener('resize', scheduleViewportSync);
      window.removeEventListener('orientationchange', scheduleViewportSync);
      window.removeEventListener('pageshow', scheduleViewportSync);
      window.visualViewport?.removeEventListener('resize', scheduleViewportSync);
      window.visualViewport?.removeEventListener('scroll', scheduleViewportSync);
    };
  }, [map]);

  useEffect(() => {
    map.invalidateSize({ pan: false, debounceMoveend: true });
    if (shouldFollow) {
      map.panTo(location, { animate: true, duration: 0.35 });
    }
  }, [location, map, shouldFollow]);

  return null;
}

export function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const updateZoom = () => onZoomChange(map.getZoom());

    updateZoom();
    map.on('zoomend', updateZoom);
    return () => {
      map.off('zoomend', updateZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

export function StarNavigationOverlay({
  activeTag,
  stars,
  onPrev,
  onNext,
}: {
  activeTag: { order: number, groupId: number } | null;
  stars: StarData[];
  onPrev: () => void;
  onNext: () => void;
}) {
  const map = useMap();
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  }, [activeTag]);

  React.useLayoutEffect(() => {
    if (!activeTag) return;
    const star = stars.find(s => s.tagOrder === activeTag.order && s.tagGroupId === activeTag.groupId);
    if (!star) return;

    const updatePos = () => {
      const pt = latLngToContinuousLayerPoint(map, [star.lat, star.lng]);
      if (containerRef.current) {
        containerRef.current.style.transform = `translate3d(${pt.x}px, ${pt.y - 45}px, 0) translate(-50%, -50%)`;
      }
    };

    updatePos();
    map.on('zoom', updatePos);
    map.on('viewreset', updatePos);
    return () => {
      map.off('zoom', updatePos);
      map.off('viewreset', updatePos);
    };
  }, [map, activeTag, stars]);

  if (!activeTag || !stars.find(s => s.tagOrder === activeTag.order && s.tagGroupId === activeTag.groupId)) return null;

  return createPortal(
    <div className="star-navigation-overlay" ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, transform: 'translate3d(-100px, -100px, 0)', willChange: 'transform', zIndex: 1000, display: 'flex', gap: '8px', pointerEvents: 'auto' }}>
      <button
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        className="w-10 h-10 rounded-full bg-[var(--app-active-surface)] border-2 border-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 shadow-md transition-transform active:scale-95"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="11 17 6 12 11 7"></polyline>
          <polyline points="18 17 13 12 18 7"></polyline>
        </svg>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        className="w-10 h-10 rounded-full bg-[var(--app-active-surface)] border-2 border-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 shadow-md transition-transform active:scale-95"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="13 17 18 12 13 7"></polyline>
          <polyline points="6 17 11 12 6 7"></polyline>
        </svg>
      </button>
    </div>,
    map.getPanes().popupPane
  );
}

export function MapEventHandlers({
  onDrop,
  onMapClick,
  onMapReady,
}: {
  onDrop: (e: DragEvent, map: L.Map) => void;
  onMapClick: () => void;
  onMapReady: (map: L.Map | null) => void;
}) {
  const map = useMap();

  const clickRef = React.useRef(onMapClick);
  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onMapReady(map);
    return () => onMapReady(null);
  }, [map, onMapReady]);

  useEffect(() => {
    const container = map.getContainer();
    const interactiveSelector = 'button, [role="button"], .app-star-div-icon, .star-action-overlay, .leaflet-control';

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault(); // allow drop
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      onDrop(e, map);
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);

    const handleBackgroundPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(interactiveSelector)) return;
      clickRef.current?.();
    };
    container.addEventListener('pointerdown', handleBackgroundPointerDown, true);

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      container.removeEventListener('pointerdown', handleBackgroundPointerDown, true);
    };
  }, [map, onDrop]);
  return null;
}
