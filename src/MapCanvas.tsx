import { MapContainer, Marker, TileLayer } from 'react-leaflet';
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
import type { MapStyle, StarData, TrackData } from './types/app';

type MapTileConfig = Record<MapStyle, { url: string; attribution: string }>;

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
  return (
    <div className={`absolute inset-0 z-0 bg-[#e5e5e5] ${mapStyle === 'dark' ? 'theme-dark' : ''} ${mapStyle === 'light' ? 'theme-light' : ''}`}>
      <MapContainer
        center={position}
        zoom={16}
        scrollWheelZoom={true}
        className="w-full h-full absolute inset-0 z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution={mapTiles[mapStyle].attribution}
          url={mapTiles[mapStyle].url}
        />
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
    </div>
  );
}
