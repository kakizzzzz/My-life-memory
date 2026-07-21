import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const draggableStarMarker = readFileSync('src/DraggableStarMarker.tsx', 'utf8');
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
