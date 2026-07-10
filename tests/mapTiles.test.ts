import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MAP_STYLE, MAP_TILES } from '../src/constants/mapTiles';

test('login map default is the gray vector style', () => {
  assert.equal(DEFAULT_MAP_STYLE, 'light');
});

test('street styles use the open OpenFreeMap vector service', () => {
  for (const style of ['light', 'dark'] as const) {
    const tile = MAP_TILES[style];
    assert.equal(tile.kind, 'vector');
    assert.equal(tile.provider, 'openfreemap');
    assert.match(tile.styleUrl, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
    assert.doesNotMatch(tile.styleUrl, /cartocdn|arcgisonline|google/i);
    assert.match(tile.attribution, /https:\/\//);
    assert.match(tile.attribution, /target="_blank"/);
    assert.match(tile.attribution, /rel="noopener noreferrer"/);
    assert.match(tile.attribution, /OpenFreeMap/);
    assert.match(tile.attribution, /OpenMapTiles/);
  }
});

test('OpenStreetMap-derived styles link to ODbL and source information', () => {
  for (const style of ['light', 'dark'] as const) {
    assert.match(MAP_TILES[style].attribution, /openstreetmap\.org\/copyright/);
    assert.match(MAP_TILES[style].attribution, /OpenStreetMap contributors/);
  }
});

test('satellite uses the keyless open VersaTiles service', () => {
  const satellite = MAP_TILES.aerial;
  assert.equal(satellite.kind, 'vector');
  assert.equal(satellite.provider, 'versatiles');
  assert.equal(satellite.styleUrl, 'https://tiles.versatiles.org/assets/styles/satellite/style.json');
  assert.match(satellite.attribution, /versatiles\.org\/sources/);
  assert.match(satellite.attribution, /openstreetmap\.org\/copyright/);
  assert.doesNotMatch(satellite.styleUrl, /cartocdn|arcgisonline|google|maptiler|eox/i);
});
