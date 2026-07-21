import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mapRuntime = readFileSync('src/MapRuntimeComponents.tsx', 'utf8');
const mapMotion = readFileSync('src/mapMotion.ts', 'utf8');
const mapStarActions = readFileSync('src/hooks/useMapStarActions.ts', 'utf8');
const draggableStarMarker = readFileSync('src/DraggableStarMarker.tsx', 'utf8');
const smoothMarker = readFileSync('src/SmoothMarker.tsx', 'utf8');
const starActionOverlay = readFileSync('src/StarActionOverlay.tsx', 'utf8');

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('normal star flights keep their existing arc without snapping an interrupted zoom', () => {
  const flight = sourceBetween(mapRuntime, 'export function FlyToTarget', 'export function MapViewportSync');

  assert.match(flight, /getStandardStarFlightOptions\(map, target\)/);
  assert.match(mapMotion, /1\.25 \+ \(travelRatio \* 0\.3\)/);
  assert.match(mapMotion, /0\.62 \+ \(travelRatio \* 0\.18\)/);
  assert.match(mapMotion, /0\.01 \+ \(travelRatio \* 0\.03\)/);
  assert.match(flight, /startFluidMapFlight/);
  assert.match(mapMotion, /animatedMap\._move/);
  assert.doesNotMatch(flight, /map\.flyTo|map\.stop\(\)|invalidateSize/);
  assert.doesNotMatch(mapMotion, /map\.flyTo|map\.stop\(\)|invalidateSize/);
});

test('rapid retargeting responds toward the new target while retaining safe momentum', () => {
  const flight = sourceBetween(mapMotion, 'export const startFluidMapFlight', 'animation.frameId = L.Util.requestAnimFrame(frame);');

  assert.match(flight, /retargetVelocity\(animation\.positionVelocity, positionDelta, duration\)/);
  assert.match(mapMotion, /forwardSpeed = Math\.max\(defaultSpeed/);
  assert.match(mapMotion, /maxLateralSpeed = defaultSpeed \* 0\.06/);
  assert.match(flight, /wasActive\s*\?\s*animation\.zoomVelocity/);
  assert.match(flight, /fluidFlightValue/);
  assert.match(flight, /if \(!wasActive\) animatedMap\._moveStart/);
});

test('flight landing keeps Leaflet ease-out and does not issue a duplicate final correction', () => {
  const flight = sourceBetween(mapMotion, 'export const startFluidMapFlight', 'animation.frameId = L.Util.requestAnimFrame(frame);');

  assert.match(mapMotion, /1 - Math\.pow\(1 - progress, 1\.5\)/);
  assert.match(mapMotion, /velocityBlend = progress \* Math\.pow\(1 - progress, 2\)/);
  assert.doesNotMatch(flight, /animatedMap\._move\(targetLatLng, targetZoom\)/);
});

test('selection and tag-mode changes use the fluid controller instead of quantizing with public map stop', () => {
  assert.match(mapStarActions, /cancelFluidMapFlight/);
  assert.match(mapStarActions, /const cancelMapFlight/);
  assert.doesNotMatch(mapStarActions, /mapInstanceRef\.current\?\.stop\(\)|map\.stop\(\)/);
});

test('normal selection changes the existing star DOM instead of replacing its Leaflet icon', () => {
  const iconMemo = sourceBetween(draggableStarMarker, 'const icon = React.useMemo', 'useLayoutEffect(() =>');

  assert.match(draggableStarMarker, /class="app-star-outline"/);
  assert.match(draggableStarMarker, /classList\.toggle\('is-selected', isSelected\)/);
  assert.doesNotMatch(iconMemo, /isSelected/);
});

test('star markers retain subpixel positions during map zoom frames', () => {
  assert.match(draggableStarMarker, /<SmoothMarker/);
  assert.match(smoothMarker, /latLngToContinuousLayerPoint/);
  assert.match(smoothMarker, /projectedPoint\.subtract\(map\.getPixelOrigin\(\)\)/);
  assert.match(smoothMarker, /center \?\? map\.getCenter\(\)/);
  assert.match(smoothMarker, /subtract\(map\.project\(preciseCenter, zoom\)\)/);
  assert.match(smoothMarker, /add\(map\.getSize\(\)\.divideBy\(2\)\)/);
  assert.match(smoothMarker, /subtract\(smoothMap\._getMapPanePos\(\)\)/);
  assert.doesNotMatch(smoothMarker, /_lastCenter/);
  assert.doesNotMatch(smoothMarker, /latLngToLayerPoint\(marker\._latlng\)/);
  assert.doesNotMatch(smoothMarker, /\.round\(\)/);
});

test('map-anchored controls update compositor transforms without React position renders', () => {
  const tagOverlay = sourceBetween(mapRuntime, 'export function StarNavigationOverlay', 'export function MapEventHandlers');

  assert.match(tagOverlay, /translate3d/);
  assert.match(tagOverlay, /latLngToContinuousLayerPoint/);
  assert.doesNotMatch(tagOverlay, /setPos/);
  assert.match(starActionOverlay, /syncOverlayPosition/);
  assert.match(starActionOverlay, /latLngToContinuousLayerPoint/);
  assert.match(starActionOverlay, /translate3d/);
  assert.doesNotMatch(starActionOverlay, /const \[pos, setPos\]/);
});
