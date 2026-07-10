import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_TILES } from '../src/constants/mapTiles';

test('built-in map providers use the openly permitted EOX service', () => {
  for (const tile of Object.values(MAP_TILES)) {
    assert.match(tile.url, /^https:\/\/tiles\.maps\.eox\.at\//);
    assert.doesNotMatch(tile.url, /cartocdn|arcgisonline|google/i);
    assert.match(tile.attribution, /https:\/\//);
    assert.match(tile.attribution, /target="_blank"/);
    assert.match(tile.attribution, /rel="noopener noreferrer"/);
    assert.match(tile.attribution, /EOX/);
  }
});

test('OpenStreetMap-derived styles link to ODbL and source information', () => {
  for (const style of ['light', 'dark'] as const) {
    assert.match(MAP_TILES[style].attribution, /openstreetmap\.org\/copyright/);
    assert.match(MAP_TILES[style].attribution, /OpenStreetMap contributors/);
  }
});

test('aerial attribution identifies EOX and Copernicus Sentinel data', () => {
  assert.match(MAP_TILES.aerial.attribution, /Sentinel-2 cloudless 2025/);
  assert.match(MAP_TILES.aerial.attribution, /Copernicus Sentinel data 2025/);
  assert.equal(MAP_TILES.aerial.maxNativeZoom, 14);
});
