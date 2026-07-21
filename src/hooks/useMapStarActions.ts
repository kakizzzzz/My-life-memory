import React from 'react';
import L, { type Map as LeafletMap, type LeafletMouseEvent } from 'leaflet';
import { createClientId } from '../lib/generalUtils';
import { scheduleImageDeletion, type StoredImageMetadata } from '../lib/mediaStorage';
import { getStoredImagesFromNote, uniqueStoredImages } from '../lib/noteHtmlUtils';
import { cancelFluidMapFlight, getStandardStarFlightOptions, startFluidMapFlight } from '../mapMotion';
import type { StarData, TagMode } from '../types/app';

type ActiveTag = { order: number; groupId: number } | null;

type StarPlacementDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  dragging: boolean;
};

const deleteStoredImages = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void scheduleImageDeletion(metadata);
  });
};

export const useMapStarActions = ({
  userLocation,
  stars,
  setStars,
  selectedStarId,
  setSelectedStarId,
  setSelectedTrackId,
  setSelectedTrackLatLng,
  setFlyTarget,
  tagMode,
  setTagMode,
  tagMenuOpen,
  setTagMenuOpen,
  activeTag,
  setActiveTag,
  currentTagGroupId,
  setCurrentTagGroupId,
  setMapZoom,
}: {
  userLocation: [number, number];
  stars: StarData[];
  setStars: React.Dispatch<React.SetStateAction<StarData[]>>;
  selectedStarId: string | null;
  setSelectedStarId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTrackLatLng: React.Dispatch<React.SetStateAction<[number, number] | null>>;
  setFlyTarget: React.Dispatch<React.SetStateAction<[number, number] | null>>;
  tagMode: TagMode;
  setTagMode: React.Dispatch<React.SetStateAction<TagMode>>;
  tagMenuOpen: boolean;
  setTagMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeTag: ActiveTag;
  setActiveTag: React.Dispatch<React.SetStateAction<ActiveTag>>;
  currentTagGroupId: number;
  setCurrentTagGroupId: React.Dispatch<React.SetStateAction<number>>;
  setMapZoom: React.Dispatch<React.SetStateAction<number>>;
}) => {
  const [starDragPreview, setStarDragPreview] = React.useState<{ x: number; y: number } | null>(null);
  const mapInstanceRef = React.useRef<LeafletMap | null>(null);
  const starPlacementDragRef = React.useRef<StarPlacementDragState | null>(null);
  const pendingPlacementStarIdRef = React.useRef<string | null>(null);
  const previewCleanupFrameRef = React.useRef<number | null>(null);
  const previewCleanupFallbackRef = React.useRef<number | null>(null);
  const starsRef = React.useRef(stars);
  const selectedStarIdRef = React.useRef(selectedStarId);
  const tagModeRef = React.useRef(tagMode);
  const currentTagGroupIdRef = React.useRef(currentTagGroupId);

  starsRef.current = stars;
  selectedStarIdRef.current = selectedStarId;
  tagModeRef.current = tagMode;
  currentTagGroupIdRef.current = currentTagGroupId;

  const cancelMapFlight = React.useCallback(() => {
    const map = mapInstanceRef.current;
    if (map) cancelFluidMapFlight(map);
  }, []);

  const onMapClick = React.useCallback(() => {
    cancelMapFlight();
    setFlyTarget(null);
    setSelectedStarId(null);
    setActiveTag(null);
    setSelectedTrackId(null);
    setSelectedTrackLatLng(null);
  }, [cancelMapFlight, setActiveTag, setFlyTarget, setSelectedStarId, setSelectedTrackId, setSelectedTrackLatLng]);

  const handleMapReady = React.useCallback((map: LeafletMap | null) => {
    mapInstanceRef.current = map;
    if (map) setMapZoom(map.getZoom());
  }, [setMapZoom]);

  const addStarAtLatLng = React.useCallback((lat: number, lng: number, starData: Partial<StarData> = {}) => {
    const id = starData.id || createClientId();
    const createdAt = starData.createdAt || Date.now();
    setStars(prev => [...prev, { ...starData, id, lat, lng, createdAt }]);
    return id;
  }, [setStars]);

  const addStarAtUserLocation = React.useCallback(() => {
    return addStarAtLatLng(userLocation[0], userLocation[1]);
  }, [addStarAtLatLng, userLocation]);

  const placeStarAtClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const map = mapInstanceRef.current;
    if (!map) {
      return addStarAtUserLocation();
    }

    const rect = map.getContainer().getBoundingClientRect();
    const isInsideMap =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (!isInsideMap) return null;

    const latlng = map.containerPointToLatLng(L.point(clientX - rect.left, clientY - rect.top));
    return addStarAtLatLng(latlng.lat, latlng.lng);
  }, [addStarAtLatLng, addStarAtUserLocation]);

  const cancelPreviewCleanup = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (previewCleanupFrameRef.current !== null) {
      window.cancelAnimationFrame(previewCleanupFrameRef.current);
      previewCleanupFrameRef.current = null;
    }
    if (previewCleanupFallbackRef.current !== null) {
      window.clearTimeout(previewCleanupFallbackRef.current);
      previewCleanupFallbackRef.current = null;
    }
  }, []);

  const clearPlacementPreview = React.useCallback((starId?: string) => {
    if (starId && pendingPlacementStarIdRef.current !== starId) return;
    cancelPreviewCleanup();
    pendingPlacementStarIdRef.current = null;
    setStarDragPreview(null);
  }, [cancelPreviewCleanup]);

  React.useEffect(() => () => cancelPreviewCleanup(), [cancelPreviewCleanup]);

  const handleStarPlacementPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cancelPreviewCleanup();
    pendingPlacementStarIdRef.current = null;
    setStarDragPreview(null);
    const rect = event.currentTarget.getBoundingClientRect();
    starPlacementDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - (rect.left + rect.width / 2),
      grabOffsetY: event.clientY - (rect.top + rect.height / 2),
      dragging: false,
    };
  }, [cancelPreviewCleanup]);

  const handleStarPlacementPointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance > 6) {
      dragState.dragging = true;
      setStarDragPreview({
        x: event.clientX - dragState.grabOffsetX,
        y: event.clientY - dragState.grabOffsetY,
      });
      event.preventDefault();
    }
  }, []);

  const finishStarPlacementPointer = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }

    if (dragState.dragging) {
      const previewX = event.clientX - dragState.grabOffsetX;
      const previewY = event.clientY - dragState.grabOffsetY;
      setStarDragPreview({ x: previewX, y: previewY });
      const placedStarId = placeStarAtClientPoint(previewX, previewY);
      if (placedStarId) {
        pendingPlacementStarIdRef.current = placedStarId;
        if (typeof window !== 'undefined') {
          previewCleanupFallbackRef.current = window.setTimeout(() => {
            clearPlacementPreview(placedStarId);
          }, 600);
        }
      } else {
        clearPlacementPreview();
      }
      event.preventDefault();
      event.stopPropagation();
    } else {
      addStarAtUserLocation();
      clearPlacementPreview();
    }

    starPlacementDragRef.current = null;
  }, [addStarAtUserLocation, clearPlacementPreview, placeStarAtClientPoint]);

  const cancelStarPlacementPointer = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (dragState?.pointerId === event.pointerId) {
      starPlacementDragRef.current = null;
      clearPlacementPreview();
    }
  }, [clearPlacementPreview]);

  const onStarMarkerReady = React.useCallback((starId: string) => {
    if (pendingPlacementStarIdRef.current !== starId) return;
    if (typeof window === 'undefined') {
      clearPlacementPreview(starId);
      return;
    }

    if (previewCleanupFallbackRef.current !== null) {
      window.clearTimeout(previewCleanupFallbackRef.current);
      previewCleanupFallbackRef.current = null;
    }
    previewCleanupFrameRef.current = window.requestAnimationFrame(() => {
      previewCleanupFrameRef.current = window.requestAnimationFrame(() => {
        clearPlacementPreview(starId);
      });
    });
  }, [clearPlacementPreview]);

  const handleMapDrop = React.useCallback((event: DragEvent, map: LeafletMap) => {
    const type = event.dataTransfer?.getData('text/plain');
    if (type === 'star') {
      const latlng = map.mouseEventToLatLng(event as unknown as MouseEvent);
      addStarAtLatLng(latlng.lat, latlng.lng);
    }
  }, [addStarAtLatLng]);

  const flyMapTowardStar = React.useCallback((id: string) => {
    const map = mapInstanceRef.current;
    const star = starsRef.current.find(item => item.id === id);
    if (!map || !star) return;

    const size = map.getSize();
    const viewportCenter = L.point(size.x / 2, size.y / 2);
    const starPoint = map.latLngToContainerPoint([star.lat, star.lng]);
    const delta = starPoint.subtract(viewportCenter);
    const distance = Math.hypot(delta.x, delta.y);
    if (distance < 18) return;

    const target: [number, number] = [star.lat, star.lng];
    startFluidMapFlight(map, target, getStandardStarFlightOptions(map, target));
  }, []);

  const onStarClick = React.useCallback((id: string, event: LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(event.originalEvent);

    const currentTagMode = tagModeRef.current;
    if (currentTagMode === 'add') {
      const groupId = currentTagGroupIdRef.current;
      if (!starsRef.current.find(item => item.id === id)?.tagOrder) {
        flyMapTowardStar(id);
      }
      setStars(prev => {
        const star = prev.find(item => item.id === id);
        if (star?.tagOrder) return prev;
        const groupStars = prev.filter(item => item.tagGroupId === groupId);
        const maxTag = groupStars.reduce((max, item) => Math.max(max, item.tagOrder || 0), 0);
        return prev.map(item => item.id === id ? { ...item, tagOrder: maxTag + 1, tagGroupId: groupId } : item);
      });
      return;
    }

    if (currentTagMode === 'remove') {
      if (starsRef.current.find(item => item.id === id)?.tagOrder) {
        flyMapTowardStar(id);
      }
      setStars(prev => {
        const star = prev.find(item => item.id === id);
        if (!star?.tagOrder) return prev;
        const removedTag = star.tagOrder;
        const groupId = star.tagGroupId;
        return prev.map(item => {
          if (item.id === id) return { ...item, tagOrder: undefined, tagGroupId: undefined };
          if (item.tagGroupId === groupId && item.tagOrder && item.tagOrder > removedTag) return { ...item, tagOrder: item.tagOrder - 1 };
          return item;
        });
      });
      return;
    }

    const clickedStar = starsRef.current.find(star => star.id === id);
    if (!clickedStar) return;

    if (selectedStarIdRef.current === id) {
      cancelMapFlight();
      setFlyTarget(null);
      setSelectedStarId(null);
      setActiveTag(null);
      return;
    }

    setSelectedStarId(id);
    if (clickedStar.tagOrder && clickedStar.tagGroupId !== undefined) {
      setActiveTag({ order: clickedStar.tagOrder, groupId: clickedStar.tagGroupId });
    } else {
      setActiveTag(null);
    }

    setFlyTarget([clickedStar.lat, clickedStar.lng]);
  }, [cancelMapFlight, flyMapTowardStar, setActiveTag, setFlyTarget, setSelectedStarId, setStars]);

  const onUpdateStar = React.useCallback((id: string, updates: Partial<StarData>) => {
    setStars(prev => prev.map(star => star.id === id ? { ...star, ...updates } : star));
  }, [setStars]);

  const onMoveStar = React.useCallback((id: string, lat: number, lng: number) => {
    setStars(prev => prev.map(star => star.id === id ? { ...star, lat, lng } : star));
  }, [setStars]);

  const onDeleteStar = React.useCallback((id: string) => {
    const deletedStar = stars.find(star => star.id === id);
    if (deletedStar) {
      deleteStoredImages((deletedStar.notes || []).flatMap(note => getStoredImagesFromNote(note)));
    }

    setStars(prev => {
      const star = prev.find(item => item.id === id);
      if (star && star.tagOrder) {
        const groupId = star.tagGroupId;
        return prev.filter(item => item.id !== id).map(item => {
          if (item.tagGroupId === groupId && item.tagOrder && item.tagOrder > star.tagOrder!) return { ...item, tagOrder: item.tagOrder - 1 };
          return item;
        });
      }
      return prev.filter(item => item.id !== id);
    });
    if (selectedStarId === id) setSelectedStarId(null);
  }, [selectedStarId, setSelectedStarId, setStars, stars]);

  const toggleTagMenu = React.useCallback(() => {
    cancelMapFlight();
    if (tagMenuOpen) {
      setTagMenuOpen(false);
      setTagMode('none');
    } else {
      setFlyTarget(null);
      setSelectedStarId(null);
      setActiveTag(null);
      setTagMenuOpen(true);
      setTagMode('add');
      setCurrentTagGroupId(Date.now());
    }
  }, [cancelMapFlight, setActiveTag, setCurrentTagGroupId, setFlyTarget, setSelectedStarId, setTagMenuOpen, setTagMode, tagMenuOpen]);

  const handlePrevTag = React.useCallback(() => {
    if (!activeTag) return;
    const groupStars = stars.filter(star => star.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, star) => Math.max(max, star.tagOrder || 0), 0);
    const nextOrder = activeTag.order > 1 ? activeTag.order - 1 : maxTag;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const star = groupStars.find(item => item.tagOrder === nextOrder);
    if (star) {
      setFlyTarget([star.lat, star.lng]);
      setSelectedStarId(star.id);
    }
  }, [activeTag, setActiveTag, setFlyTarget, setSelectedStarId, stars]);

  const handleNextTag = React.useCallback(() => {
    if (!activeTag) return;
    const groupStars = stars.filter(star => star.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, star) => Math.max(max, star.tagOrder || 0), 0);
    const nextOrder = activeTag.order < maxTag ? activeTag.order + 1 : 1;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const star = groupStars.find(item => item.tagOrder === nextOrder);
    if (star) {
      setFlyTarget([star.lat, star.lng]);
      setSelectedStarId(star.id);
    }
  }, [activeTag, setActiveTag, setFlyTarget, setSelectedStarId, stars]);

  return {
    starDragPreview,
    cancelMapFlight,
    onMapClick,
    handleMapReady,
    addStarAtLatLng,
    addStarAtUserLocation,
    handleStarPlacementPointerDown,
    handleStarPlacementPointerMove,
    finishStarPlacementPointer,
    cancelStarPlacementPointer,
    onStarMarkerReady,
    handleMapDrop,
    onStarClick,
    onUpdateStar,
    onMoveStar,
    onDeleteStar,
    toggleTagMenu,
    handlePrevTag,
    handleNextTag,
  };
};
