import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { Eye, Palette, Edit2, Trash2, Copy, ExternalLink } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';

type StarData = {
  id: string;
  lat: number;
  lng: number;
  createdAt?: number;
  tagOrder?: number;
  color?: string;
};

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
const PI = Math.PI;

const isOutsideChina = (lat: number, lng: number) => (
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
);

const transformLat = (x: number, y: number) => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
};

const transformLng = (x: number, y: number) => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
};

const wgs84ToGcj02 = (lat: number, lng: number) => {
  if (isOutsideChina(lat, lng)) return { lat, lng };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
};

const gcj02ToBd09 = (lat: number, lng: number) => {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * PI * 3000.0 / 180.0);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * PI * 3000.0 / 180.0);
  return {
    lat: z * Math.sin(theta) + 0.006,
    lng: z * Math.cos(theta) + 0.0065,
  };
};

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
  const [isMapChoiceOpen, setIsMapChoiceOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimerRef = React.useRef<number | null>(null);
  
  useEffect(() => {
    if (selectedStarId) {
      setActiveTab(null); // Reset when a new star is selected
      setShowCustomPicker(false);
      setIsMapChoiceOpen(false);
      setCopyStatus('');
      setOffset({ x: 0, y: 0 });
    }
  }, [selectedStarId]);

  useEffect(() => {
    if (activeTab !== 'color') {
      setShowCustomPicker(false);
    }
    if (activeTab !== 'eye') {
      setIsMapChoiceOpen(false);
      setCopyStatus('');
    }
  }, [activeTab]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedStarId) return;
    const star = stars.find(s => s.id === selectedStarId);
    if (!star) return;

    const updatePos = () => {
      const pt = map.latLngToLayerPoint([star.lat, star.lng]);
      setPos({ x: pt.x, y: pt.y });
    };

    updatePos();
    map.on('zoom', updatePos);
    map.on('viewreset', updatePos);
    return () => {
      map.off('zoom', updatePos);
      map.off('viewreset', updatePos);
    };
  }, [map, selectedStarId, stars]);

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
  const star = stars.find(s => s.id === selectedStarId);
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
      copyTimerRef.current = window.setTimeout(() => setCopyStatus(''), 1400);
    } catch(e) {
    }
  };

  const gcjCoords = wgs84ToGcj02(star.lat, star.lng);
  const bdCoords = gcj02ToBd09(gcjCoords.lat, gcjCoords.lng);
  const mapTitle = encodeURIComponent(copy.mapLocationTitle);
  const mapOptions = [
    {
      key: 'apple',
      label: copy.appleMaps,
      url: `https://maps.apple.com/?ll=${star.lat.toFixed(6)},${star.lng.toFixed(6)}&q=${mapTitle}`,
    },
    {
      key: 'amap',
      label: copy.amapMaps,
      url: `https://uri.amap.com/marker?position=${gcjCoords.lng.toFixed(6)},${gcjCoords.lat.toFixed(6)}&name=${mapTitle}&src=MyLifeMemory&coordinate=gaode&callnative=1`,
    },
    {
      key: 'baidu',
      label: copy.baiduMaps,
      url: `https://api.map.baidu.com/marker?location=${bdCoords.lat.toFixed(6)},${bdCoords.lng.toFixed(6)}&title=${mapTitle}&content=${mapTitle}&output=html&src=MyLifeMemory`,
    },
    {
      key: 'google',
      label: copy.googleMaps,
      url: `https://www.google.com/maps/search/?api=1&query=${star.lat.toFixed(6)},${star.lng.toFixed(6)}`,
    },
  ];

  const openMapUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setIsMapChoiceOpen(false);
  };

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
          <Eye size={18} strokeWidth={2.5} />
        </button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setActiveTab(activeTab === 'color' ? null : 'color')} className={`p-1 px-[8px] rounded-full transition-colors ${activeTab === 'color' ? 'bg-[var(--app-card)] text-black' : 'text-black/70 hover:text-black'}`} aria-label={copy.chooseColor}>
          <Palette size={18} strokeWidth={2.5} />
        </button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onEditNote(star.id)} className={`p-1 px-[8px] rounded-full transition-colors text-black/70 hover:text-black`} aria-label={copy.editNote}>
          <Edit2 size={18} strokeWidth={2.5} />
        </button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDeleteStar(star.id)} className={`p-1 px-[8px] rounded-full transition-colors text-black/70 hover:text-black`} aria-label={copy.deleteStar}>
          <Trash2 size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Detail Pill */}
      {activeTab === 'eye' && (
        <div className="flex flex-col items-center gap-1.5">
          <div className="bg-[var(--app-active-surface)] rounded-[16px] px-3 py-1.5 flex items-center gap-2 shadow-lg border border-[var(--app-card)]">
            <span className="font-sans font-medium text-[13px] text-black/90 whitespace-nowrap">{coordsText}</span>
            <div className="w-[1px] h-3 bg-gray-300"></div>
            <button onClick={copyCoords} className="text-black hover:text-gray-500 transition-colors" aria-label={copy.copyCoordinates}>
              <Copy size={14} strokeWidth={2} />
            </button>
            {copyStatus && (
              <span className="rounded-full bg-[var(--app-card)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-black/70">
                {copyStatus}
              </span>
            )}
            <button
              onClick={() => setIsMapChoiceOpen(open => !open)}
              className={`text-black transition-colors hover:text-gray-500 ${isMapChoiceOpen ? 'text-black' : ''}`}
              aria-label={copy.openInMaps}
            >
              <ExternalLink size={14} strokeWidth={2} />
            </button>
          </div>
          {isMapChoiceOpen && (
            <div
              className="grid grid-cols-2 gap-1.5 rounded-[14px] border border-[var(--app-card)] bg-[var(--app-active-surface)] p-1.5 shadow-lg"
              aria-label={copy.chooseMap}
            >
              {mapOptions.map(option => (
                <button
                  key={option.key}
                  onClick={() => openMapUrl(option.url)}
                  className="h-8 rounded-[10px] bg-[var(--app-card)] px-3 text-[12px] font-medium text-black transition-colors hover:brightness-95"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
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
            <div className="bg-[var(--app-dark)] w-[124px] box-border rounded-[16px] p-2.5 shadow-xl flex flex-col gap-2 picker-popup absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
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
