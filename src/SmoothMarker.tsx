import type { ReactNode } from 'react';
import {
  createElementObject,
  createLayerComponent,
  extendContext,
  type EventedProps,
} from '@react-leaflet/core';
import L, { type LatLngExpression, type MarkerOptions } from 'leaflet';

export interface SmoothMarkerProps extends MarkerOptions, EventedProps {
  children?: ReactNode;
  position: LatLngExpression;
}

type SmoothMapInternals = L.Map & {
  _getMapPanePos: () => L.Point;
  _lastCenter?: L.LatLng;
};

type SmoothMarkerInternals = L.Marker & {
  _icon?: HTMLElement;
  _latlng: L.LatLng;
  _map?: SmoothMapInternals;
  _setPos: (position: L.Point) => void;
};

export const latLngToContinuousLayerPoint = (
  map: L.Map,
  latlng: LatLngExpression,
  zoom = map.getZoom(),
  center?: L.LatLng,
) => {
  const smoothMap = map as SmoothMapInternals;
  const preciseCenter = center ?? smoothMap._lastCenter ?? map.getCenter();
  return map.project(L.latLng(latlng), zoom)
    .subtract(map.project(preciseCenter, zoom))
    .add(map.getSize().divideBy(2))
    .subtract(smoothMap._getMapPanePos());
};

export class SmoothLeafletMarker extends L.Marker {
  update() {
    const marker = this as unknown as SmoothMarkerInternals;
    if (marker._icon && marker._map) {
      marker._setPos(latLngToContinuousLayerPoint(marker._map, marker._latlng));
    }
    return this;
  }

  _animateZoom(event: { center: L.LatLng; zoom: number }) {
    const marker = this as unknown as SmoothMarkerInternals;
    if (marker._map) {
      marker._setPos(latLngToContinuousLayerPoint(marker._map, marker._latlng, event.zoom, event.center));
    }
  }
}

export const SmoothMarker = createLayerComponent<SmoothLeafletMarker, SmoothMarkerProps>(
  function createSmoothMarker({ position, ...options }, context) {
    const marker = new SmoothLeafletMarker(position, options);
    return createElementObject(marker, extendContext(context, { overlayContainer: marker }));
  },
  function updateSmoothMarker(marker, props, previousProps) {
    if (props.position !== previousProps.position) marker.setLatLng(props.position);
    if (props.icon != null && props.icon !== previousProps.icon) marker.setIcon(props.icon);
    if (props.zIndexOffset != null && props.zIndexOffset !== previousProps.zIndexOffset) {
      marker.setZIndexOffset(props.zIndexOffset);
    }
    if (props.opacity != null && props.opacity !== previousProps.opacity) marker.setOpacity(props.opacity);
    if (marker.dragging != null && props.draggable !== previousProps.draggable) {
      if (props.draggable) marker.dragging.enable();
      else marker.dragging.disable();
    }
  },
);
