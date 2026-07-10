import type { MapStyle } from '../types/app';

type MapProvider = 'openfreemap' | 'versatiles';

type MapTileDefinitionBase = {
  provider: MapProvider;
  attribution: string;
};

export type MapTileDefinition = MapTileDefinitionBase & {
  kind: 'vector';
  styleUrl: string;
};

export type MapTileConfig = Record<MapStyle, MapTileDefinition>;

export const DEFAULT_MAP_STYLE: MapStyle = 'light';

const OSM_ATTRIBUTION_LINK = (
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
);

const OPENFREEMAP_ATTRIBUTION_LINK = (
  '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'
);

const OPENMAPTILES_ATTRIBUTION_LINK = (
  '<a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a>'
);

const OPENFREEMAP_ATTRIBUTION = (
  `${OPENFREEMAP_ATTRIBUTION_LINK} ${OPENMAPTILES_ATTRIBUTION_LINK} Data from ${OSM_ATTRIBUTION_LINK}`
);

const VERSATILES_ATTRIBUTION_LINK = (
  '<a href="https://versatiles.org/sources/" target="_blank" rel="noopener noreferrer">VersaTiles imagery sources</a>'
);

export const MAP_TILES: MapTileConfig = {
  light: {
    kind: 'vector',
    provider: 'openfreemap',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  dark: {
    kind: 'vector',
    provider: 'openfreemap',
    styleUrl: 'https://tiles.openfreemap.org/styles/fiord',
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  aerial: {
    kind: 'vector',
    provider: 'versatiles',
    styleUrl: 'https://tiles.versatiles.org/assets/styles/satellite/style.json',
    attribution: `${VERSATILES_ATTRIBUTION_LINK} ${OSM_ATTRIBUTION_LINK}`,
  },
};
