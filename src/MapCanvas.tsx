import { MapContainer, Marker } from 'react-leaflet';
import type { DivIcon, Icon, LeafletMouseEvent, Map as LeafletMap } from 'leaflet';
import { StarActionOverlay } from './StarActionOverlay';
import { TrackActionOverlay } from './TrackActionOverlay';
import {
  FlyToTarget,
  MapEventHandlers,
  MapViewportSync,
  MapZoomTracker,
  StarNavigationOverlay,
} from './MapRuntimeComponents';
import { MapDataLayers, type TagPolyline } from './MapDataLayers';
import { VectorMapLayer } from './VectorMapLayer';
import type { MapTileConfig } from './constants/mapTiles';
import type { MapStyle, StarData, TrackData } from './types/app';

type MapCanvasProps = {
  mapStyle: MapStyle;
  mapTiles: MapTileConfig;
  position: [number, number];
  userLocation: [number, number];
  locationIcon: Icon | DivIcon;
  flyTarget: [number, number] | null;
  activeTag: { order: number; groupId: number } | null;
  stars: StarData[];
  selectedStarId: string | null;
  savedTracks: TrackData[];
  selectedTrackId: string | null;
  selectedTrackLatLng: [number, number] | null;
  language: string;
  tagPolylines: TagPolyline[];
  isTracking: boolean;
  trackPaths: [number, number][][];
  showRouteDetailDots: boolean;
  badgeColor: string;
  onZoomChange: (zoom: number) => void;
  onMapDrop: (event: DragEvent, map: LeafletMap) => void;
  onMapClick: () => void;
  onMapReady: (map: LeafletMap | null) => void;
  onPrevTag: () => void;
  onNextTag: () => void;
  onUpdateStar: (id: string, updates: Partial<StarData>) => void;
  onDeleteStar: (id: string) => void;
  onEditStarNote: (starId: string) => void;
  onUpdateTrack: (id: string, updates: Partial<TrackData>) => void;
  onDeleteTrack: (id: string) => void;
  onSelectTrack: (trackId: string, latLng: [number, number] | null) => void;
  onSelectStar: (id: string, event: LeafletMouseEvent) => void;
  onMoveStar: (id: string, lat: number, lng: number) => void;
};

export function MapCanvas({
  mapStyle,
  mapTiles,
  position,
  userLocation,
  locationIcon,
  flyTarget,
  activeTag,
  stars,
  selectedStarId,
  savedTracks,
  selectedTrackId,
  selectedTrackLatLng,
  language,
  tagPolylines,
  isTracking,
  trackPaths,
  showRouteDetailDots,
  badgeColor,
  onZoomChange,
  onMapDrop,
  onMapClick,
  onMapReady,
  onPrevTag,
  onNextTag,
  onUpdateStar,
  onDeleteStar,
  onEditStarNote,
  onUpdateTrack,
  onDeleteTrack,
  onSelectTrack,
  onSelectStar,
  onMoveStar,
}: MapCanvasProps) {
  const tileConfig = mapTiles[mapStyle];

  return (
    <div className={`absolute inset-0 z-0 bg-[#e5e5e5] ${mapStyle === 'dark' ? 'theme-dark' : ''} ${mapStyle === 'light' ? 'theme-light' : ''}`}>
      <MapContainer
        center={position}
        zoom={16}
        scrollWheelZoom={true}
        className="w-full h-full absolute inset-0 z-0"
        zoomControl={false}
        attributionControl={false}
      >
        <VectorMapLayer styleUrl={tileConfig.styleUrl} />
        <Marker
          position={userLocation}
          icon={locationIcon}
          draggable={false}
          keyboard={false}
          interactive={false}
        />
        <FlyToTarget target={flyTarget} />
        <MapViewportSync location={userLocation} shouldFollow={false} />
        <MapZoomTracker onZoomChange={onZoomChange} />

        <MapEventHandlers onDrop={onMapDrop} onMapClick={onMapClick} onMapReady={onMapReady} />

        <StarNavigationOverlay activeTag={activeTag} stars={stars} onPrev={onPrevTag} onNext={onNextTag} />
        <StarActionOverlay
          selectedStarId={selectedStarId}
          stars={stars}
          onUpdateStar={onUpdateStar}
          onDeleteStar={onDeleteStar}
          onEditNote={onEditStarNote}
          language={language}
        />
        <TrackActionOverlay
          selectedTrackId={selectedTrackId}
          savedTracks={savedTracks}
          onUpdateTrack={onUpdateTrack}
          onDeleteTrack={onDeleteTrack}
          selectedLatLng={selectedTrackLatLng}
          language={language}
        />
        <MapDataLayers
          tagPolylines={tagPolylines}
          isTracking={isTracking}
          trackPaths={trackPaths}
          savedTracks={savedTracks}
          showRouteDetailDots={showRouteDetailDots}
          stars={stars}
          selectedStarId={selectedStarId}
          mapStyle={mapStyle}
          badgeColor={badgeColor}
          onSelectTrack={onSelectTrack}
          onSelectStar={onSelectStar}
          onMoveStar={onMoveStar}
        />
      </MapContainer>

      <div
        className="map-attribution pointer-events-auto absolute bottom-0 right-0 z-[850]"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          color: 'rgba(75, 85, 99, 0.58)',
          fontSize: '8px',
          lineHeight: 1.1,
          opacity: 0.26,
          padding: '0 3px',
          transform: 'scale(0.86)',
          transformOrigin: 'bottom right',
        }}
        aria-label="Map attribution and licence information"
        dangerouslySetInnerHTML={{ __html: tileConfig.attribution }}
      />
    </div>
  );
}
