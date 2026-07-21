import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mapStarActions = readFileSync('src/hooks/useMapStarActions.ts', 'utf8');
const draggableStarMarker = readFileSync('src/DraggableStarMarker.tsx', 'utf8');
const mapRuntime = readFileSync('src/MapRuntimeComponents.tsx', 'utf8');
const mapMotion = readFileSync('src/mapMotion.ts', 'utf8');

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('tag taps update ordering without selecting a star or starting the normal selection animation', () => {
  const starClick = sourceBetween(mapStarActions, 'const onStarClick', 'const onUpdateStar');
  const addBranch = sourceBetween(starClick, "if (currentTagMode === 'add')", "if (currentTagMode === 'remove')");
  const removeBranch = sourceBetween(starClick, "if (currentTagMode === 'remove')", 'const clickedStar');

  assert.match(addBranch, /setStars/);
  assert.match(addBranch, /flyMapTowardStar/);
  assert.match(addBranch, /return;/);
  assert.doesNotMatch(addBranch, /setSelectedStarId|setFlyTarget/);
  assert.match(removeBranch, /setStars/);
  assert.match(removeBranch, /flyMapTowardStar/);
  assert.match(removeBranch, /return;/);
  assert.doesNotMatch(removeBranch, /setSelectedStarId|setFlyTarget/);
});

test('tag movement uses the same distance-aware timing as normal star selection', () => {
  const flight = sourceBetween(mapStarActions, 'const flyMapTowardStar', 'const onStarClick');
  assert.match(flight, /startFluidMapFlight/);
  assert.match(flight, /getStandardStarFlightOptions\(map, target\)/);
  assert.match(mapRuntime, /getStandardStarFlightOptions\(map, target\)/);
  assert.match(mapMotion, /0\.62 \+ \(travelRatio \* 0\.18\)/);
  assert.match(mapMotion, /1\.25 \+ \(travelRatio \* 0\.3\)/);
  assert.match(mapMotion, /const flightAnimations = new WeakMap<L\.Map, FlightAnimationState>\(\)/);
  assert.doesNotMatch(flight, /0\.48|map\.flyTo|map\.stop|setFlyTarget|setZoom/);
});

test('star click handler stays stable while tag ordering changes', () => {
  const starClick = sourceBetween(mapStarActions, 'const onStarClick', 'const onUpdateStar');
  assert.match(starClick, /starsRef\.current/);
  assert.match(starClick, /tagModeRef\.current/);
  assert.doesNotMatch(starClick, /\], \[[^\]]*stars/);
});

test('tag mode removes the draggable gesture recognizer from star markers', () => {
  assert.match(draggableStarMarker, /draggable=\{!isTagging\}/);
  assert.match(draggableStarMarker, /React\.memo/);
});

test('map background cancels selection on pointer down while controls remain interactive', () => {
  assert.match(mapRuntime, /addEventListener\('pointerdown', handleBackgroundPointerDown, true\)/);
  assert.match(mapRuntime, /\.app-star-div-icon/);
  assert.match(mapRuntime, /\.star-action-overlay/);
  assert.doesNotMatch(mapRuntime, /map\.on\('click', handleClick\)/);
});
