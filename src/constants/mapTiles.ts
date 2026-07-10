import type { MapStyle } from '../types/app';

export type MapTileDefinition = {
  url: string;
  attribution: string;
  maxNativeZoom?: number;
  maxZoom?: number;
};

export type MapTileConfig = Record<MapStyle, MapTileDefinition>;

const OSM_ATTRIBUTION_LINK = (
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
);

const EOX_ATTRIBUTION_LINK = (
  '<a href="https://maps.eox.at/" target="_blank" rel="noopener noreferrer">EOX</a>'
);

const EOX_TERRAIN_ATTRIBUTION = (
  `Data &copy; ${OSM_ATTRIBUTION_LINK} and others, Rendering &copy; ${EOX_ATTRIBUTION_LINK}`
);

const EOX_CLOUDLESS_ATTRIBUTION = (
  `Sentinel-2 cloudless 2025 &copy; ${EOX_ATTRIBUTION_LINK}, contains modified Copernicus Sentinel data 2025`
);

export const MAP_TILES: MapTileConfig = {
  light: {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: EOX_TERRAIN_ATTRIBUTION,
    maxZoom: 19,
  },
  dark: {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: EOX_TERRAIN_ATTRIBUTION,
    maxZoom: 19,
  },
  aerial: {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: EOX_CLOUDLESS_ATTRIBUTION,
    maxNativeZoom: 14,
    maxZoom: 19,
  },
};
