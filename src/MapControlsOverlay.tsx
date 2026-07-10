import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronRight, MapPin, Menu, Minus, Pause, Play, Plus, Route, Save, Search, Star, Tag, X } from 'lucide-react';
import { MapStyleThumbnail } from './MapStyleThumbnail';
import { PhotoGpsStarIcon } from './PhotoGpsStarIcon';
import { HOME_COPY } from './copy/homeCopy';
import type { MapStyle, TagMode } from './types/app';

type MapControlsCopy = typeof HOME_COPY.en;

type DistanceDisplay = {
  value: string;
  unit: string;
};

type MapControlsOverlayProps = {
  homeCopy: MapControlsCopy;
  btnClass: string;
  starPlacementButtonClass: string;
  mapStyle: MapStyle;
  isMenuOpen: boolean;
  isMapStyleMenuOpen: boolean;
  tagMenuOpen: boolean;
  tagMode: TagMode;
  isReadingPhotoLocation: boolean;
  iconStrokeWidth: number;
  mapToolIconStroke: number;
  onToggleMenu: () => void;
  onOpenMapStyleMenu: () => void;
  onSelectMapStyle: (style: MapStyle) => void;
  onLocateMe: () => void;
  onToggleTagMenu: () => void;
  onSetTagMode: (mode: TagMode) => void;
  onStartRoute: () => void;
  onStarPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onStarPointerMove: React.PointerEventHandler<HTMLButtonElement>;
  onStarPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onStarPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  onStarKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
  onPhotoGpsClick: () => void;
};

type PhotoLocationToastProps = {
  status: string;
};

type MapSearchButtonProps = {
  btnClass: string;
  searchLabel: string;
  iconStrokeWidth: number;
  onClick: () => void;
};

type TrackingControlsOverlayProps = {
  btnClass: string;
  isPaused: boolean;
  trackTime: number;
  activeTrackDistanceDisplay: DistanceDisplay;
  gpsStatusText?: string;
  iconStrokeWidth: number;
  onTogglePause: () => void;
  onCancel: () => void;
  onSave: () => void;
  formatTime: (seconds: number) => string;
};

const MAP_STYLE_OPTIONS: { style: MapStyle; getLabel: (copy: MapControlsCopy) => string }[] = [
  { style: 'aerial', getLabel: copy => copy.aerialMapAlt },
  { style: 'dark', getLabel: copy => copy.darkMapAlt },
  { style: 'light', getLabel: copy => copy.lightMapAlt },
];

export function PhotoLocationToast({ status }: PhotoLocationToastProps) {
  if (!status) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.12 }}
        className="app-feedback-toast pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+5rem)] z-[2500] max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full px-4 py-2 text-center text-[13px] font-medium"
      >
        {status}
      </motion.div>
    </AnimatePresence>
  );
}

export function MapControlsOverlay({
  homeCopy,
  btnClass,
  starPlacementButtonClass,
  mapStyle,
  isMenuOpen,
  isMapStyleMenuOpen,
  tagMenuOpen,
  tagMode,
  isReadingPhotoLocation,
  iconStrokeWidth,
  mapToolIconStroke,
  onToggleMenu,
  onOpenMapStyleMenu,
  onSelectMapStyle,
  onLocateMe,
  onToggleTagMenu,
  onSetTagMode,
  onStartRoute,
  onStarPointerDown,
  onStarPointerMove,
  onStarPointerUp,
  onStarPointerCancel,
  onStarKeyDown,
  onPhotoGpsClick,
}: MapControlsOverlayProps) {
  return (
    <div className="absolute top-[var(--app-chrome-top)] right-4 z-[1000] flex flex-col items-end gap-3">
      <button
        onClick={onToggleMenu}
        className={btnClass}
      >
        {isMenuOpen ? <ChevronDown size={28} strokeWidth={mapToolIconStroke} /> : <Menu size={24} strokeWidth={mapToolIconStroke} />}
      </button>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.8, transition: { duration: 0.2 } }}
            className="flex flex-col items-end gap-3"
          >
            <div className="relative flex justify-end items-center h-[48px]">
              <AnimatePresence mode="wait">
                {isMapStyleMenuOpen ? (
                  <motion.div
                    key="open"
                    initial={{ opacity: 0, scale: 0.8, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: 20 }}
                    transition={{ duration: 0.15 }}
                    className="h-[48px] bg-[var(--app-icon)] px-[4px] rounded-[24px] flex items-center gap-[4px] shadow-lg relative"
                  >
                    <div className="relative z-10 flex items-center gap-[4px]">
                      {MAP_STYLE_OPTIONS.map(option => (
                        <button
                          key={option.style}
                          onClick={() => onSelectMapStyle(option.style)}
                          className={`flex items-center justify-center rounded-full transition-all focus:outline-none ${mapStyle === option.style ? 'w-[40px] h-[40px] border-[3px] border-black scale-100' : 'w-[40px] h-[40px] hover:opacity-80 scale-[0.85]'}`}
                          aria-label={option.getLabel(homeCopy)}
                        >
                          <div className="w-full h-full rounded-full overflow-hidden relative">
                            <MapStyleThumbnail styleName={option.style} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.button
                    key="closed"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    onClick={onOpenMapStyleMenu}
                    className="w-[48px] h-[48px] rounded-full bg-[var(--app-icon)] p-[6px] shadow-sm hover:opacity-90 transition-opacity focus:outline-none block"
                    aria-label={homeCopy.currentMapStyleAlt}
                  >
                    <div className="w-full h-full rounded-full border-[3px] border-black overflow-hidden relative">
                      <MapStyleThumbnail styleName={mapStyle} />
                    </div>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <button className={btnClass} onClick={onLocateMe}>
              <MapPin size={24} strokeWidth={mapToolIconStroke} />
            </button>

            <div className="relative flex flex-col items-start h-[48px]">
              <AnimatePresence mode="popLayout">
                {tagMenuOpen ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: 20 }}
                    transition={{ duration: 0.15 }}
                    className="h-[48px] bg-[var(--app-icon)] px-[4px] rounded-[24px] flex items-center gap-[4px] shadow-md relative"
                  >
                    <button
                      className={`w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all ${tagMode === 'add' ? 'bg-[var(--app-dark)] text-white shadow-md' : 'text-black hover:bg-black/10'}`}
                      onClick={() => onSetTagMode('add')}
                    >
                      <Plus size={22} strokeWidth={iconStrokeWidth} />
                    </button>
                    <button
                      className={`w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all ${tagMode === 'remove' ? 'bg-[var(--app-dark)] text-white shadow-md' : 'text-black hover:bg-black/10'}`}
                      onClick={() => onSetTagMode('remove')}
                    >
                      <Minus size={22} strokeWidth={iconStrokeWidth} />
                    </button>
                    <button
                      className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-colors text-black hover:bg-black/10"
                      onClick={onToggleTagMenu}
                    >
                      <ChevronRight size={26} strokeWidth={iconStrokeWidth} />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="closed"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    className="w-[48px] h-[48px] rounded-full bg-[var(--app-icon)] shadow-sm hover:brightness-95 transition-all flex items-center justify-center text-black"
                    onClick={onToggleTagMenu}
                  >
                    <Tag size={22} strokeWidth={mapToolIconStroke} fill="none" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <button className={btnClass} onClick={onStartRoute}>
              <Route size={24} strokeWidth={mapToolIconStroke} />
            </button>

            <button
              className={starPlacementButtonClass}
              aria-label={homeCopy.addStar}
              onPointerDown={onStarPointerDown}
              onPointerMove={onStarPointerMove}
              onPointerUp={onStarPointerUp}
              onPointerCancel={onStarPointerCancel}
              onKeyDown={onStarKeyDown}
            >
              <Star size={24} strokeWidth={mapToolIconStroke} fill="none" />
            </button>

            <button
              type="button"
              className={`${btnClass} ${isReadingPhotoLocation ? 'opacity-60' : ''}`}
              onClick={onPhotoGpsClick}
              disabled={isReadingPhotoLocation}
              aria-label={homeCopy.uploadPhotoLocation}
              title={homeCopy.uploadPhotoLocation}
            >
              <PhotoGpsStarIcon size={24} strokeWidth={mapToolIconStroke} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TrackingControlsOverlay({
  btnClass,
  isPaused,
  trackTime,
  activeTrackDistanceDisplay,
  gpsStatusText,
  iconStrokeWidth,
  onTogglePause,
  onCancel,
  onSave,
  formatTime,
}: TrackingControlsOverlayProps) {
  const [isGpsToastVisible, setIsGpsToastVisible] = React.useState(false);
  const gpsToastTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (gpsToastTimerRef.current !== null) {
      window.clearTimeout(gpsToastTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (!gpsStatusText) {
      setIsGpsToastVisible(false);
      if (gpsToastTimerRef.current !== null) {
        window.clearTimeout(gpsToastTimerRef.current);
        gpsToastTimerRef.current = null;
      }
      return;
    }

    if (gpsToastTimerRef.current !== null) {
      window.clearTimeout(gpsToastTimerRef.current);
    }
    setIsGpsToastVisible(true);
    gpsToastTimerRef.current = window.setTimeout(() => {
      setIsGpsToastVisible(false);
      gpsToastTimerRef.current = null;
    }, 500);
  }, [gpsStatusText]);

  return (
    <>
      <div className="absolute top-[var(--app-chrome-top)] left-4 z-[1000] bg-[var(--app-active-surface)] rounded-[24px] shadow-md px-6 py-4 border border-[var(--app-card)] min-w-[160px]">
        <div className="absolute top-3 left-3 w-2 h-2 bg-black rounded-full"></div>
        <div className="absolute top-3 right-3 w-2 h-2 bg-black rounded-full"></div>
        <div className="absolute bottom-3 left-3 w-2 h-2 bg-black rounded-full"></div>
        <div className="absolute bottom-3 right-3 w-2 h-2 bg-black rounded-full"></div>

        <div className="w-full h-[3px] bg-gray-200 mt-2 mb-3 rounded-full"></div>
        <div className="text-[40px] leading-none font-bold text-black tracking-tight text-left">
          {activeTrackDistanceDisplay.value}<span className="text-[28px] font-bold ml-1.5">{activeTrackDistanceDisplay.unit}</span>
        </div>
        <div className="w-full h-[3px] bg-gray-200 my-3 rounded-full"></div>
        <div className="text-[24px] leading-none font-semibold text-black text-left mb-1">
          {formatTime(trackTime)}
        </div>
        <div className="w-full h-[3px] bg-gray-200 mt-3 mb-2 rounded-full"></div>
      </div>

      <AnimatePresence>
        {gpsStatusText && isGpsToastVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="app-feedback-toast pointer-events-none fixed left-1/2 bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] z-[2500] max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full px-4 py-2 text-center text-[13px] font-medium"
          >
            {gpsStatusText}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-[var(--app-chrome-top)] right-4 z-[1000]">
        <button
          className={btnClass}
          onClick={onTogglePause}
        >
          {isPaused ? <Play size={24} strokeWidth={iconStrokeWidth} /> : <Pause size={24} strokeWidth={iconStrokeWidth} />}
        </button>
      </div>

      <div className="absolute bottom-[var(--app-floating-bottom)] right-4 z-[1000] flex flex-col gap-3">
        <button
          className={btnClass}
          onClick={onCancel}
        >
          <X size={28} strokeWidth={iconStrokeWidth} />
        </button>
        <button
          className={btnClass}
          onClick={onSave}
        >
          <Save size={24} strokeWidth={iconStrokeWidth} />
        </button>
      </div>
    </>
  );
}

export function MapSearchButton({ btnClass, searchLabel, iconStrokeWidth, onClick }: MapSearchButtonProps) {
  return (
    <div className="absolute bottom-[var(--app-floating-bottom)] right-4 z-[1000]">
      <button
        className={btnClass}
        onClick={onClick}
        aria-label={searchLabel}
      >
        <Search size={24} strokeWidth={iconStrokeWidth} />
      </button>
    </div>
  );
}
