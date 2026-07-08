import { Fragment } from 'react';
import { CircleMarker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { DraggableStarMarker } from './DraggableStarMarker';
import { getVisibleRouteDots } from './lib/trackUtils';
import type { MapStyle, StarData, TrackData } from './types/app';

export type TagPolyline = {
  groupId: number;
  color: string;
  positions: [number, number][];
};

type MapDataLayersProps = {
  tagPolylines: TagPolyline[];
  isTracking: boolean;
  trackPaths: [number, number][][];
  savedTracks: TrackData[];
  showRouteDetailDots: boolean;
  stars: StarData[];
  selectedStarId: string | null;
  mapStyle: MapStyle;
  badgeColor: string;
  onSelectTrack: (trackId: string, latLng: [number, number] | null) => void;
  onSelectStar: (id: string, event: L.LeafletMouseEvent) => void;
  onMoveStar: (id: string, lat: number, lng: number) => void;
};

export function MapDataLayers({
  tagPolylines,
  isTracking,
  trackPaths,
  savedTracks,
  showRouteDetailDots,
  stars,
  selectedStarId,
  mapStyle,
  badgeColor,
  onSelectTrack,
  onSelectStar,
  onMoveStar,
}: MapDataLayersProps) {
  return (
    <>
      {tagPolylines.map((line) => line.positions.length > 1 && (
        <Polyline
          key={`tagline-${line.groupId}`}
          positions={line.positions}
          pathOptions={{ color: line.color, dashArray: '1, 10', weight: 2.5, lineCap: 'round', lineJoin: 'round' }}
        />
      ))}

      {isTracking && trackPaths.map((path, idx) => {
        if (path.length < 2) return null;
        const dots = getVisibleRouteDots(path, showRouteDetailDots);
        return (
          <Fragment key={`track-group-${idx}`}>
            <Polyline
              positions={path}
              pathOptions={{ color: '#EDC727', weight: 2.5, lineCap: 'round', lineJoin: 'round' }}
            />
            {dots.map((dot, dIdx) => (
              <CircleMarker
                key={`track-dot-${idx}-${dIdx}`}
                center={dot}
                radius={4}
                pathOptions={{ color: 'transparent', fillColor: '#EDC727', fillOpacity: 1, weight: 0 }}
                interactive={false}
              />
            ))}
          </Fragment>
        );
      })}

      {savedTracks.map(track =>
        track.paths.map((path, idx) => {
          if (path.length < 2) return null;
          const dots = getVisibleRouteDots(path, showRouteDetailDots);
          return (
            <Fragment key={`saved-track-group-${track.id}-${idx}`}>
              <Polyline
                positions={path}
                pathOptions={{ color: 'transparent', weight: 25 }}
                eventHandlers={{
                  click: (event) => {
                    L.DomEvent.stopPropagation(event as any);
                    const latLng = (event as any).latlng;
                    onSelectTrack(track.id, latLng ? [latLng.lat, latLng.lng] : null);
                  }
                }}
              />
              <Polyline
                positions={path}
                pathOptions={{ color: track.color || '#EDC727', weight: 2.5, lineCap: 'round', lineJoin: 'round' }}
                eventHandlers={{
                  click: (event) => {
                    L.DomEvent.stopPropagation(event as any);
                    const latLng = (event as any).latlng;
                    onSelectTrack(track.id, latLng ? [latLng.lat, latLng.lng] : null);
                  }
                }}
              />
              {dots.map((dot, dIdx) => (
                <CircleMarker
                  key={`saved-track-dot-${track.id}-${idx}-${dIdx}`}
                  center={dot}
                  radius={4}
                  pathOptions={{ color: 'transparent', fillColor: track.color || '#EDC727', fillOpacity: 1, weight: 0 }}
                  eventHandlers={{
                    click: (event) => {
                      L.DomEvent.stopPropagation(event as any);
                      onSelectTrack(track.id, dot);
                    }
                  }}
                />
              ))}
            </Fragment>
          );
        })
      )}

      {stars.map(star => (
        <Fragment key={star.id}>
          <DraggableStarMarker
            star={star}
            isSelected={selectedStarId === star.id}
            mapStyle={mapStyle}
            badgeColor={badgeColor}
            onSelect={onSelectStar}
            onMove={onMoveStar}
          />
        </Fragment>
      ))}
    </>
  );
}
