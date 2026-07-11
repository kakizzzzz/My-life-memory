import React from 'react';
import L, { type Map as LeafletMap, type LeafletMouseEvent } from 'leaflet';
import { createClientId } from '../lib/generalUtils';
import { scheduleImageDeletion, type StoredImageMetadata } from '../lib/mediaStorage';
import { getStoredImagesFromNote, uniqueStoredImages } from '../lib/noteHtmlUtils';
import type { StarData, TagMode } from '../types/app';

type ActiveTag = { order: number; groupId: number } | null;

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
  const starPlacementDragRef = React.useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);

  const onMapClick = React.useCallback(() => {
    setSelectedStarId(null);
    setActiveTag(null);
    setSelectedTrackId(null);
    setSelectedTrackLatLng(null);
  }, [setActiveTag, setSelectedStarId, setSelectedTrackId, setSelectedTrackLatLng]);

  const handleLocateMe = React.useCallback(() => {
    setFlyTarget([userLocation[0], userLocation[1]]);
  }, [setFlyTarget, userLocation]);

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
    addStarAtLatLng(userLocation[0], userLocation[1]);
  }, [addStarAtLatLng, userLocation]);

  const placeStarAtClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const map = mapInstanceRef.current;
    if (!map) {
      addStarAtUserLocation();
      return;
    }

    const rect = map.getContainer().getBoundingClientRect();
    const isInsideMap =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (!isInsideMap) return;

    const latlng = map.containerPointToLatLng(L.point(clientX - rect.left, clientY - rect.top));
    addStarAtLatLng(latlng.lat, latlng.lng);
  }, [addStarAtLatLng, addStarAtUserLocation]);

  const handleStarPlacementPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    starPlacementDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  }, []);

  const handleStarPlacementPointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance > 6) {
      dragState.dragging = true;
      setStarDragPreview({ x: event.clientX, y: event.clientY });
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
      placeStarAtClientPoint(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    } else {
      addStarAtUserLocation();
    }

    starPlacementDragRef.current = null;
    setStarDragPreview(null);
  }, [addStarAtUserLocation, placeStarAtClientPoint]);

  const cancelStarPlacementPointer = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (dragState?.pointerId === event.pointerId) {
      starPlacementDragRef.current = null;
      setStarDragPreview(null);
    }
  }, []);

  const handleMapDrop = React.useCallback((event: DragEvent, map: LeafletMap) => {
    const type = event.dataTransfer?.getData('text/plain');
    if (type === 'star') {
      const latlng = map.mouseEventToLatLng(event as unknown as MouseEvent);
      addStarAtLatLng(latlng.lat, latlng.lng);
    }
  }, [addStarAtLatLng]);

  const onStarClick = React.useCallback((id: string, _event: LeafletMouseEvent) => {
    const clickedStar = stars.find(star => star.id === id);
    if (clickedStar) {
      setFlyTarget([clickedStar.lat, clickedStar.lng]);
    }

    if (tagMode === 'add') {
      setStars(prev => {
        const star = prev.find(item => item.id === id);
        if (star?.tagOrder) return prev;
        const groupStars = prev.filter(item => item.tagGroupId === currentTagGroupId);
        const maxTag = groupStars.reduce((max, item) => Math.max(max, item.tagOrder || 0), 0);
        return prev.map(item => item.id === id ? { ...item, tagOrder: maxTag + 1, tagGroupId: currentTagGroupId } : item);
      });
      setSelectedStarId(id);
    } else if (tagMode === 'remove') {
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
    } else if (clickedStar) {
      setSelectedStarId(id);
      if (clickedStar.tagOrder && clickedStar.tagGroupId !== undefined) {
        setActiveTag({ order: clickedStar.tagOrder, groupId: clickedStar.tagGroupId });
      } else {
        setActiveTag(null);
      }
    }
  }, [currentTagGroupId, setActiveTag, setFlyTarget, setSelectedStarId, setStars, stars, tagMode]);

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
    if (tagMenuOpen) {
      setTagMenuOpen(false);
      setTagMode('none');
    } else {
      setTagMenuOpen(true);
      setTagMode('add');
      setCurrentTagGroupId(Date.now());
    }
  }, [setCurrentTagGroupId, setTagMenuOpen, setTagMode, tagMenuOpen]);

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
    onMapClick,
    handleLocateMe,
    handleMapReady,
    addStarAtLatLng,
    addStarAtUserLocation,
    handleStarPlacementPointerDown,
    handleStarPlacementPointerMove,
    finishStarPlacementPointer,
    cancelStarPlacementPointer,
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
