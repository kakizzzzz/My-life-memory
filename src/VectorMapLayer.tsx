import React from 'react';
import L, { type Layer, type Map as LeafletMap } from 'leaflet';
import { useMap } from 'react-leaflet';

type MaplibreMap = {
  setStyle: (style: string) => void;
};

type MaplibreLeafletLayer = Layer & {
  getMaplibreMap: () => MaplibreMap;
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

export function VectorMapLayer({ styleUrl }: { styleUrl: string }) {
  const map = useMap();
  const layerRef = React.useRef<MaplibreLeafletLayer | null>(null);
  const styleUrlRef = React.useRef(styleUrl);

  React.useEffect(() => {
    styleUrlRef.current = styleUrl;
    layerRef.current?.getMaplibreMap().setStyle(styleUrl);
  }, [styleUrl]);

  React.useEffect(() => {
    let cancelled = false;

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
    };

    void mountLayer().catch(error => {
      console.error('Could not load vector map:', error);
    });

    return () => {
      cancelled = true;
      removeLayer(map, layerRef.current);
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
