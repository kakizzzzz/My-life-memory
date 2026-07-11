import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { Eye, Palette, Edit2, Trash2, Copy, ExternalLink } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import type { StarData } from './types/app';

const writeClipboardText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

const DEFAULT_COLORS = [
  '#D2936D', '#B6A5B9', '#EDC727', '#88AA9A', '#C4D4C5', '#D0D5C1',
  '#CBE0E8', '#80AACD', '#D3CCE3', '#F0EBE1', '#28292B'
];

type MapProvider = 'apple' | 'amap' | 'baidu' | 'google';
type CoordinatePair = { lat: number; lng: number };

const isInsideMainlandChina = ({ lat, lng }: CoordinatePair) => (
  lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271
);

const transformChinaLat = (x: number, y: number) => {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  result += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return result;
};

const transformChinaLng = (x: number, y: number) => {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  result += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return result;
};

const wgs84ToGcj02 = (point: CoordinatePair): CoordinatePair => {
  if (!isInsideMainlandChina(point)) return point;

  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const dLat = transformChinaLat(point.lng - 105, point.lat - 35);
  const dLng = transformChinaLng(point.lng - 105, point.lat - 35);
  const radLat = point.lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = point.lat + (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  const mgLng = point.lng + (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: mgLat, lng: mgLng };
};

const gcj02ToBd09 = (point: CoordinatePair): CoordinatePair => {
  const x = point.lng;
  const y = point.lat;
  const z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return {
    lat: z * Math.sin(theta) + 0.006,
    lng: z * Math.cos(theta) + 0.0065,
  };
};

const formatCoordinate = (value: number) => value.toFixed(6);

const STAR_OVERLAY_COPY = {
  en: {
    showDetails: 'Show location details',
    chooseColor: 'Choose marker color',
    editNote: 'Edit note',
    deleteStar: 'Delete marker',
    copyCoordinates: 'Copy coordinates',
    copied: 'Copied',
    openInMaps: 'Open in maps',
    chooseMap: 'Choose map',
    appleMaps: 'Apple',
    amapMaps: 'Amap',
    baiduMaps: 'Baidu',
    googleMaps: 'Google',
    mapLocationTitle: 'Map location',
    customColor: 'Custom color',
  },
  zh: {
    showDetails: '查看位置详情',
    chooseColor: '选择标记颜色',
    editNote: '编辑笔记',
    deleteStar: '删除标记',
    copyCoordinates: '复制坐标',
    copied: '已复制',
    openInMaps: '用地图打开',
    chooseMap: '选择地图',
    appleMaps: '苹果',
    amapMaps: '高德',
    baiduMaps: '百度',
    googleMaps: '谷歌',
    mapLocationTitle: '地图位置',
    customColor: '自定义颜色',
  },
  ko: {
    showDetails: '위치 세부 정보 보기',
    chooseColor: '마커 색상 선택',
    editNote: '노트 편집',
    deleteStar: '마커 삭제',
    copyCoordinates: '좌표 복사',
    copied: '복사됨',
    openInMaps: '지도에서 열기',
    chooseMap: '지도 선택',
    appleMaps: 'Apple',
    amapMaps: 'Amap',
    baiduMaps: 'Baidu',
    googleMaps: 'Google',
    mapLocationTitle: '지도 위치',
    customColor: '사용자 지정 색상',
  },
};

export function StarActionOverlay({ 
  selectedStarId, 
  stars, 
  onUpdateStar, 
  onDeleteStar,
  onEditNote,
  language = 'en'
}: { 
  selectedStarId: string | null, 
  stars: StarData[],
  onUpdateStar: (id: string, updates: Partial<StarData>) => void,
  onDeleteStar: (id: string) => void,
  onEditNote: (starId: string) => void,
  language?: string
}) {
  const map = useMap();
  const copy = STAR_OVERLAY_COPY[language as keyof typeof STAR_OVERLAY_COPY] || STAR_OVERLAY_COPY.en;
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  const [activeTab, setActiveTab] = useState<'eye'|'color'|'edit'|'trash'|null>(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [isMapChooserOpen, setIsMapChooserOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimerRef = React.useRef<number | null>(null);
  const selectedStar = selectedStarId ? stars.find(star => star.id === selectedStarId) : undefined;
  const selectedStarLat = selectedStar?.lat;
  const selectedStarLng = selectedStar?.lng;
  
  useEffect(() => {
    if (selectedStarId) {
      setActiveTab(null); // Reset when a new star is selected
      setShowCustomPicker(false);
      setIsMapChooserOpen(false);
      setCopyStatus('');
      setOffset({ x: 0, y: 0 });
    }
  }, [selectedStarId]);

  useEffect(() => {
    if (activeTab !== 'color') {
      setShowCustomPicker(false);
    }
    if (activeTab !== 'eye') {
      setCopyStatus('');
      setIsMapChooserOpen(false);
    }
  }, [activeTab]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedStarId || selectedStarLat === undefined || selectedStarLng === undefined) return;

    const updatePos = () => {
      const pt = map.latLngToLayerPoint([selectedStarLat, selectedStarLng]);
      setPos({ x: pt.x, y: pt.y });
    };

    updatePos();
    map.on('zoom', updatePos);
    map.on('viewreset', updatePos);
    return () => {
      map.off('zoom', updatePos);
      map.off('viewreset', updatePos);
    };
  }, [map, selectedStarId, selectedStarLat, selectedStarLng]);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  }, [selectedStarId, activeTab, showCustomPicker]);

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

  if (!selectedStarId) return null;
  const star = selectedStar;
  if (!star) return null;

  const latText = `${Math.abs(star.lat).toFixed(4)}° ${star.lat >= 0 ? 'N' : 'S'}`;
  const lngText = `${Math.abs(star.lng).toFixed(4)}° ${star.lng >= 0 ? 'E' : 'W'}`;
  const coordsText = `(${latText}, ${lngText})`;

  const copyCoords = async () => {
    try {
      await writeClipboardText(`${star.lat}, ${star.lng}`);
      setCopyStatus(copy.copied);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopyStatus(''), 500);
    } catch(e) {
    }
  };

  const openWithFallback = (primaryUrl: string, fallbackUrl?: string) => {
    if (!fallbackUrl) {
      window.location.href = primaryUrl;
      return;
    }

    const startedAt = Date.now();
    window.location.href = primaryUrl;
    window.setTimeout(() => {
      if (!document.hidden && Date.now() - startedAt < 1800) {
        window.location.href = fallbackUrl;
      }
    }, 900);
  };

  const openMapProvider = (provider: MapProvider) => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    setCopyStatus('');
    setIsMapChooserOpen(false);

    const wgs84 = { lat: star.lat, lng: star.lng };
    const gcj02 = wgs84ToGcj02(wgs84);
    const bd09 = gcj02ToBd09(gcj02);
    const mapTitle = encodeURIComponent(copy.mapLocationTitle);
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const appName = encodeURIComponent('My life memory');

    if (provider === 'apple') {
      const applePoint = isInsideMainlandChina(wgs84) ? gcj02 : wgs84;
      const lat = formatCoordinate(applePoint.lat);
      const lng = formatCoordinate(applePoint.lng);
      const webUrl = `https://maps.apple.com/?ll=${lat},${lng}&q=${mapTitle}`;
      if (isIOS) {
        openWithFallback(`maps://?ll=${lat},${lng}&q=${mapTitle}`, webUrl);
      } else {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (provider === 'amap') {
      const lat = formatCoordinate(gcj02.lat);
      const lng = formatCoordinate(gcj02.lng);
      const fallbackUrl = `https://uri.amap.com/marker?position=${lng},${lat}&name=${mapTitle}&src=${appName}&coordinate=gaode`;
      if (isIOS) {
        openWithFallback(`iosamap://viewMap?sourceApplication=${appName}&poiname=${mapTitle}&lat=${lat}&lon=${lng}&dev=0`, fallbackUrl);
      } else if (isAndroid) {
        openWithFallback(`androidamap://viewMap?sourceApplication=${appName}&poiname=${mapTitle}&lat=${lat}&lon=${lng}&dev=0`, fallbackUrl);
      } else {
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (provider === 'baidu') {
      const lat = formatCoordinate(bd09.lat);
      const lng = formatCoordinate(bd09.lng);
      const fallbackUrl = `https://api.map.baidu.com/marker?location=${lat},${lng}&title=${mapTitle}&content=${mapTitle}&coord_type=bd09ll&output=html&src=${appName}`;
      openWithFallback(`baidumap://map/marker?location=${lat},${lng}&title=${mapTitle}&content=${mapTitle}&coord_type=bd09ll&src=${appName}`, fallbackUrl);
      return;
    }

    const lat = formatCoordinate(wgs84.lat);
    const lng = formatCoordinate(wgs84.lng);
    const googleUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    if (isIOS) {
      openWithFallback(`comgooglemaps://?q=${lat},${lng}`, googleUrl);
      return;
    }
    if (isAndroid) {
      openWithFallback(`geo:${lat},${lng}?q=${lat},${lng}(${mapTitle})`, googleUrl);
      return;
    }
    window.open(googleUrl, '_blank', 'noopener,noreferrer');
  };

  const mapProviders: { id: MapProvider; label: string }[] = [
    { id: 'apple', label: copy.appleMaps },
    { id: 'amap', label: copy.amapMaps },
    { id: 'baidu', label: copy.baiduMaps },
    { id: 'google', label: copy.googleMaps },
  ];

  return createPortal(
    <div 
      ref={containerRef} 
      style={{ position: 'absolute', top: pos.y + 36, left: pos.x, transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'auto' }}
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
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onEditNote(star.id)} className={`p-1 px-[8px] rounded-full transition-colors text-black/70 hover:text-black`} aria-label={copy.editNote}>
          <Edit2 size={18} strokeWidth={2.2} />
        </button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDeleteStar(star.id)} className={`p-1 px-[8px] rounded-full transition-colors text-black/70 hover:text-black`} aria-label={copy.deleteStar}>
          <Trash2 size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* Detail Pill */}
      {activeTab === 'eye' && (
        <div className="bg-[var(--app-active-surface)] rounded-[16px] px-3 py-1.5 flex items-center gap-2 shadow-lg border border-[var(--app-card)]">
          <span className="font-sans font-medium text-[13px] text-black/90 whitespace-nowrap">{coordsText}</span>
          <div className="w-[1px] h-3 bg-gray-300"></div>
          <button onClick={copyCoords} className="text-black hover:text-gray-500 transition-colors" aria-label={copy.copyCoordinates}>
            <Copy size={14} strokeWidth={2.2} />
          </button>
          <button
            onClick={() => setIsMapChooserOpen(open => !open)}
            className="text-black transition-colors hover:text-gray-500"
            aria-label={copy.openInMaps}
          >
            <ExternalLink size={14} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {activeTab === 'eye' && isMapChooserOpen && (
        <div className="grid grid-cols-2 gap-1.5 rounded-[16px] border border-[var(--app-card)] bg-[var(--app-active-surface)] p-1.5 shadow-lg">
          {mapProviders.map(provider => (
            <button
              key={provider.id}
              onClick={() => openMapProvider(provider.id)}
              className="min-w-[58px] rounded-full bg-[var(--app-card)] px-3 py-1.5 text-[12px] font-medium leading-none text-black transition-transform active:scale-95"
            >
              {provider.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'eye' && copyStatus && (
        <div className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-[30] -translate-x-1/2 rounded-full border border-[var(--app-card)] bg-[var(--app-active-surface)] px-3 py-1 text-[12px] font-medium leading-none text-black/80 shadow-lg">
          {copyStatus}
        </div>
      )}

      {activeTab === 'color' && (
        <div className="flex flex-col items-center relative">
          <div className="bg-[var(--app-dark)] w-[124px] rounded-[20px] p-2.5 shadow-lg relative box-border">
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => onUpdateStar(star.id, { color: c })}
                  className="w-[20px] h-[20px] rounded-full"
                  style={{ 
                    backgroundColor: c,
                    boxShadow: star.color === c ? '0 0 0 1.5px white' : 'none'
                  }}
                />
              ))}
              {/* Custom Color Picker Button */}
              <button 
                onClick={() => setShowCustomPicker(!showCustomPicker)}
                className={`w-[20px] h-[20px] rounded-[6px] relative overflow-hidden`} 
                style={{ boxShadow: showCustomPicker || (!DEFAULT_COLORS.includes(star.color || '') && star.color) ? '0 0 0 1.5px white' : 'none' }}
                aria-label={copy.customColor}
              >
                <div className="w-full h-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] absolute inset-0 pointer-events-none" />
              </button>
            </div>
          </div>
          
          {showCustomPicker && (
            <div
              className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onPointerCancel={(event) => event.stopPropagation()}
            >
               <HexColorPicker color={star.color || '#EDC727'} onChange={(c) => onUpdateStar(star.id, { color: c })} />
               <div className="flex items-center w-full">
                  <span className="text-white/70 font-mono text-[13px] leading-none pt-[1px] mr-1">#</span>
                  <HexColorInput 
                    color={star.color || '#EDC727'} 
                    onChange={(c) => onUpdateStar(star.id, { color: c })}
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
