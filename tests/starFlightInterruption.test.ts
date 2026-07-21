import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const draggableStarMarker = readFileSync('src/DraggableStarMarker.tsx', 'utf8');
const mapRuntime = readFileSync('src/MapRuntimeComponents.tsx', 'utf8');
const mapStarActions = readFileSync('src/hooks/useMapStarActions.ts', 'utf8');

test('background presses, wheel gestures, and view changes immediately cancel a map flight', () => {
  assert.match(app, /onPointerDownCapture=\{handleMapPointerDownCapture\}/);
  assert.match(app, /onWheelCapture=\{handleMapWheelCapture\}/);
  assert.match(app, /if \(activeView !== 'map'\) cancelMapFlight\(\)/);
  assert.match(app, /target\.closest\('\.app-star-div-icon, \.star-navigation-overlay'\)/);
});

test('deselecting, tapping the background, and changing tag mode cancel at the current frame', () => {
  assert.match(mapStarActions, /const cancelMapFlight = React\.useCallback/);
  assert.match(mapStarActions, /if \(map\) cancelFluidMapFlight\(map\)/);
  assert.match(mapStarActions, /const onMapClick[\s\S]*?cancelMapFlight\(\)/);
  assert.match(mapStarActions, /selectedStarIdRef\.current === id[\s\S]*?cancelMapFlight\(\)/);
  assert.match(mapStarActions, /const toggleTagMenu[\s\S]*?cancelMapFlight\(\)/);
});

test('a real marker drag cancels flight while another star and tag navigation retain continuous retargeting', () => {
  assert.match(draggableStarMarker, /dragstart: \(\) => \{[\s\S]*?onDragStart\(\)/);
  assert.match(app, /onStarDragStart=\{cancelMapFlight\}/);
  assert.match(mapRuntime, /className="star-navigation-overlay"/);
});
