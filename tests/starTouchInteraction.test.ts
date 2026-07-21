import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const draggableStarMarker = readFileSync('src/DraggableStarMarker.tsx', 'utf8');
const mapControlsOverlay = readFileSync('src/MapControlsOverlay.tsx', 'utf8');
const mapStarActions = readFileSync('src/hooks/useMapStarActions.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');

test('star keeps its visual size while receiving a larger invisible touch target', () => {
  assert.match(draggableStarMarker, /width: 44px; height: 44px/);
  assert.match(draggableStarMarker, /iconSize: \[52, 52\]/);
  assert.match(draggableStarMarker, /iconAnchor: \[26, 26\]/);
  assert.match(indexCss, /\.app-star-div-icon \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?justify-content: center;/);
});

test('touch selection captures the gesture and uses the same hysteresis as marker dragging', () => {
  assert.match(draggableStarMarker, /const STAR_TOUCH_TOLERANCE = 16/);
  assert.match(draggableStarMarker, /draggable\.options\.clickTolerance = STAR_TOUCH_TOLERANCE/);
  assert.match(draggableStarMarker, /element\.setPointerCapture\(event\.pointerId\)/);
  assert.match(draggableStarMarker, /element\.releasePointerCapture\(event\.pointerId\)/);
  assert.match(draggableStarMarker, /movement >= STAR_TOUCH_TOLERANCE/);
  assert.match(draggableStarMarker, /!activePointer\.moved && !isDraggingRef\.current/);
});

test('touch commits on pointer up and suppresses only the following synthetic click', () => {
  assert.match(draggableStarMarker, /event\.pointerType === 'mouse'/);
  assert.match(draggableStarMarker, /queueMicrotask\(\(\) =>/);
  assert.match(draggableStarMarker, /onSelectRef\.current\(star\.id, \{ originalEvent: event \}/);
  assert.match(draggableStarMarker, /ignoreNativeClickUntilRef\.current = performance\.now\(\) \+ NATIVE_CLICK_SUPPRESSION_MS/);
  assert.match(draggableStarMarker, /if \(performance\.now\(\) < ignoreNativeClickUntilRef\.current\) return/);
  assert.doesNotMatch(draggableStarMarker, /onSelectRef\.current\([^\n]+handlePointerDown/);
});

test('new-star placement preserves the original grab point through preview and drop', () => {
  assert.match(mapStarActions, /grabOffsetX: event\.clientX - buttonCenterX/);
  assert.match(mapStarActions, /grabOffsetY: event\.clientY - buttonCenterY/);
  assert.match(mapStarActions, /dragState\.previewX = event\.clientX - dragState\.grabOffsetX/);
  assert.match(mapStarActions, /dragState\.previewY = event\.clientY - dragState\.grabOffsetY/);
  assert.match(mapStarActions, /placeStarAtClientPoint\(dragState\.previewX, dragState\.previewY\)/);
  assert.doesNotMatch(mapStarActions, /const previewX = event\.clientX - dragState\.grabOffsetX/);
  assert.match(mapControlsOverlay, /style=\{\{ touchAction: 'none' \}\}/);
});

test('new-star placement maps viewport pixels through the rendered map scale', () => {
  assert.match(mapStarActions, /const scaleX = rect\.width > 0 \? mapSize\.x \/ rect\.width : 1/);
  assert.match(mapStarActions, /const scaleY = rect\.height > 0 \? mapSize\.y \/ rect\.height : 1/);
  assert.match(mapStarActions, /\(clientX - rect\.left\) \* scaleX/);
  assert.match(mapStarActions, /\(clientY - rect\.top\) \* scaleY/);
});

test('new-star preview hands off only after the matching Leaflet marker is ready', () => {
  assert.match(draggableStarMarker, /onReady\(star\.id\)/);
  assert.match(mapStarActions, /pendingPlacementStarIdRef\.current = placedStarId/);
  assert.match(mapStarActions, /pendingPlacementStarIdRef\.current !== starId/);
  assert.match(mapStarActions, /window\.requestAnimationFrame/);
  assert.match(app, /h-\[52px\] w-\[52px\]/);
  assert.match(app, /<StarMarkerGlyph \/>/);
  assert.match(indexCss, /\.app-vector-map \{[\s\S]*?backface-visibility: hidden;[\s\S]*?contain: paint;[\s\S]*?will-change: transform, filter;/);
});
