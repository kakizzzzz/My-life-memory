import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { Eye, Palette, Trash2, Clock, Route } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import type { TrackData } from './types/app';

const DEFAULT_COLORS = [
  '#D2936D', '#B6A5B9', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#CBE0E8', '#80AACD', '#D3CCE3', '#F0EBE1', '#28292B'
];

const formatDistanceDisplay = (distanceKm = 0) => {
  const safeDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  if (safeDistanceKm < 1) return `${Math.round(safeDistanceKm * 1000)}m`;
  return `${safeDistanceKm.toFixed(1)}km`;
};

const TRACK_OVERLAY_COPY = {
  en: {
    showDetails: 'Show route details',
    chooseColor: 'Choose route color',
    deleteTrack: 'Delete route',
    customColor: 'Custom color',
  },
  zh: {
    showDetails: '查看路线详情',
    chooseColor: '选择路线颜色',
    deleteTrack: '删除路线',
    customColor: '自定义颜色',
  },
  ko: {
    showDetails: '경로 세부 정보 보기',
    chooseColor: '경로 색상 선택',
    deleteTrack: '경로 삭제',
    customColor: '사용자 지정 색상',
  },
};

export function TrackActionOverlay({ 
  selectedTrackId, 
  savedTracks, 
  onUpdateTrack, 
  onDeleteTrack,
  selectedLatLng,
  language = 'en'
}: { 
  selectedTrackId: string | null, 
  savedTracks: TrackData[],
  onUpdateTrack: (id: string, updates: Partial<TrackData>) => void,
  onDeleteTrack: (id: string) => void,
  selectedLatLng: [number, number] | null,
  language?: string
}) {
  const map = useMap();
  const copy = TRACK_OVERLAY_COPY[language as keyof typeof TRACK_OVERLAY_COPY] || TRACK_OVERLAY_COPY.en;
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  const [activeTab, setActiveTab] = useState<'eye'|'color'|'trash'|null>(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  
  useEffect(() => {
    if (selectedTrackId) {
      setActiveTab(null); // Reset when a new track is selected
      setShowCustomPicker(false);
      setOffset({ x: 0, y: 0 });
    }
  }, [selectedTrackId]);

  useEffect(() => {
    if (activeTab !== 'color') {
      setShowCustomPicker(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!selectedTrackId) return;
    const track = savedTracks.find(s => s.id === selectedTrackId);
    if (!track || track.paths.length === 0 || track.paths[track.paths.length - 1].length === 0) return;

    const updatePos = () => {
      let targetPoint = selectedLatLng;
      if (!targetPoint) {
        const lastPath = track.paths[track.paths.length - 1];
        targetPoint = lastPath[Math.floor(lastPath.length / 2)]; 
      }
      const pt = map.latLngToLayerPoint(targetPoint as L.LatLngTuple);
      setPos({ x: pt.x, y: pt.y });
    };

    updatePos();
    map.on('zoom', updatePos);
    map.on('viewreset', updatePos);
    return () => {
      map.off('zoom', updatePos);
      map.off('viewreset', updatePos);
    };
  }, [map, selectedTrackId, savedTracks, selectedLatLng]);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  }, [selectedTrackId, activeTab, showCustomPicker]);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = React.useRef(false);
  const dragStart = React.useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (!selectedTrackId) return null;
  const track = savedTracks.find(s => s.id === selectedTrackId);
  if (!track) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return createPortal(
    <div 
      ref={containerRef} 
      style={{ position: 'absolute', top: pos.y + 12, left: pos.x, transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'auto' }}
    >
      {/* Main Actions Pill */}
      <div 
        className="bg-[var(--app-icon)] rounded-full p-1 flex items-center shadow-lg gap-1 cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setActiveTab(activeTab === 'eye' ? null : 'eye')} className={`p-1 px-[8px] rounded-full transition-colors ${activeTab === 'eye' ? 'bg-[var(--app-card)] text-black' : 'text-black/70 hover:text-black'}`} aria-label={copy.showDetails}>
          <Eye size={18} strokeWidth={2.2} />
        </button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setActiveTab(activeTab === 'color' ? null : 'color')} className={`p-1 px-[8px] rounded-full transition-colors ${activeTab === 'color' ? 'bg-[var(--app-card)] text-black' : 'text-black/70 hover:text-black'}`} aria-label={copy.chooseColor}>
          <Palette size={18} strokeWidth={2.2} />
        </button>
        <button 
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDeleteTrack(track.id)} 
          className="p-1 px-[8px] rounded-full text-black/70 hover:text-black transition-colors"
          aria-label={copy.deleteTrack}
        >
          <Trash2 size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* Popups specific to active tab */}
      {activeTab === 'eye' && (
        <div className="bg-[var(--app-active-surface)] rounded-[16px] px-3 py-1.5 flex items-center gap-2 shadow-lg border border-[var(--app-card)]">
           <div className="font-sans font-medium text-[13px] text-black/90 whitespace-nowrap">{formatDistanceDisplay(track.distance)}</div>
           <div className="w-[1px] h-3 bg-gray-300"></div>
           <div className="font-sans font-medium text-[13px] text-black/90 whitespace-nowrap">{formatTime(track.time || 0)}</div>
        </div>
      )}

      {activeTab === 'color' && (
        <div className="flex flex-col items-center relative">
          <div className="bg-[var(--app-dark)] w-[124px] rounded-[20px] p-2.5 shadow-lg relative box-border">
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => onUpdateTrack(track.id, { color: c })}
                  className="w-[20px] h-[20px] rounded-full"
                  style={{ 
                    backgroundColor: c,
                    boxShadow: track.color === c ? '0 0 0 1.5px white' : 'none'
                  }}
                />
              ))}
              {/* Custom Color Picker Button */}
              <button 
                onClick={() => setShowCustomPicker(!showCustomPicker)}
                className={`w-[20px] h-[20px] rounded-[6px] relative overflow-hidden`} 
                style={{ boxShadow: showCustomPicker || (!DEFAULT_COLORS.includes(track.color || '') && track.color) ? '0 0 0 1.5px white' : 'none' }}
                aria-label={copy.customColor}
              >
                <div className="w-full h-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] absolute inset-0 pointer-events-none" />
              </button>
            </div>
          </div>
          
          {showCustomPicker && (
            <div className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 animate-in fade-in zoom-in-95 origin-top">
               <HexColorPicker color={track.color || '#EDC727'} onChange={(c) => onUpdateTrack(track.id, { color: c })} />
               <div className="flex items-center w-full">
                  <span className="text-white/70 font-mono text-[13px] leading-none pt-[1px] mr-1">#</span>
                  <HexColorInput 
                    color={track.color || '#EDC727'} 
                    onChange={(c) => onUpdateTrack(track.id, { color: c })}
                    className="flex-1 min-w-0 h-[22px] bg-white/10 border border-white/20 text-white rounded-[6px] px-1.5 text-[12px] font-mono uppercase focus:outline-none focus:border-white/50"
                  />
               </div>
            </div>
          )}
        </div>
      )}
    </div>,
    map.getPanes().popupPane
  );
}
