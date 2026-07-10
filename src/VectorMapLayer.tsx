import React from 'react';
import L, { type Layer, type Map as LeafletMap } from 'leaflet';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMap } from 'react-leaflet';

type MaplibreLeafletLayer = Layer & {
  getMaplibreMap: () => MapLibreMap;
};

type MaplibreLeafletNamespace = typeof L & {
  maplibreGL?: (options: {
    style: string;
    attributionControl: boolean;
    className: string;
  }) => MaplibreLeafletLayer;
};

const removeLayer = (map: LeafletMap, layer: MaplibreLeafletLayer | null) => {
  if (layer && map.hasLayer(layer)) map.removeLayer(layer);
};

const BUILDING_FILL_LAYER_ID = 'mlm-satellite-building-fill';
const BUILDING_LINE_LAYER_ID = 'mlm-satellite-building-line';
const OSM_VECTOR_SOURCE_ID = 'versatiles-shortbread';

const addSatelliteBuildingLayers = (map: MapLibreMap) => {
  if (!map.getSource(OSM_VECTOR_SOURCE_ID) || map.getLayer(BUILDING_FILL_LAYER_ID)) return;

  const firstLabelLayerId = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
  map.addLayer({
    id: BUILDING_FILL_LAYER_ID,
    type: 'fill',
    source: OSM_VECTOR_SOURCE_ID,
    'source-layer': 'buildings',
    minzoom: 14,
    paint: {
      'fill-color': '#d9d6cf',
      'fill-opacity': 0.1,
    },
  }, firstLabelLayerId);
  map.addLayer({
    id: BUILDING_LINE_LAYER_ID,
    type: 'line',
    source: OSM_VECTOR_SOURCE_ID,
    'source-layer': 'buildings',
    minzoom: 14,
    paint: {
      'line-color': 'rgba(255, 255, 255, 0.46)',
      'line-width': 0.65,
      'line-opacity': 0.72,
    },
  }, firstLabelLayerId);
};

export function VectorMapLayer({
  styleUrl,
  showBuildingOutlines = false,
}: {
  styleUrl: string;
  showBuildingOutlines?: boolean;
}) {
  const map = useMap();
  const layerRef = React.useRef<MaplibreLeafletLayer | null>(null);
  const styleUrlRef = React.useRef(styleUrl);
  const showBuildingOutlinesRef = React.useRef(showBuildingOutlines);

  React.useEffect(() => {
    styleUrlRef.current = styleUrl;
    showBuildingOutlinesRef.current = showBuildingOutlines;
    layerRef.current?.getMaplibreMap().setStyle(styleUrl);
  }, [showBuildingOutlines, styleUrl]);

  React.useEffect(() => {
    let cancelled = false;
    let maplibreMap: MapLibreMap | null = null;
    const handleStyleLoad = () => {
      if (showBuildingOutlinesRef.current && maplibreMap) {
        addSatelliteBuildingLayers(maplibreMap);
      }
    };

    const mountLayer = async () => {
      await import('@maplibre/maplibre-gl-leaflet');
      if (cancelled) return;

      const createLayer = (L as MaplibreLeafletNamespace).maplibreGL;
      if (!createLayer) throw new Error('MapLibre Leaflet layer failed to load.');

      const layer = createLayer({
        style: styleUrlRef.current,
        attributionControl: false,
        className: 'app-vector-map',
      });
      layerRef.current = layer;
      layer.addTo(map);
      maplibreMap = layer.getMaplibreMap();
      maplibreMap.on('style.load', handleStyleLoad);
      if (maplibreMap.isStyleLoaded()) handleStyleLoad();
    };

    void mountLayer().catch(error => {
      console.error('Could not load vector map:', error);
    });

    return () => {
      cancelled = true;
      maplibreMap?.off('style.load', handleStyleLoad);
      removeLayer(map, layerRef.current);
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
