import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const appChrome = readFileSync('src/AppChrome.tsx', 'utf8');
const homeCopy = readFileSync('src/copy/homeCopy.ts', 'utf8');
const locationController = readFileSync('src/hooks/useLocationController.ts', 'utf8');
const sensorUtils = readFileSync('src/lib/sensorUtils.ts', 'utf8');
const trackRecording = readFileSync('src/hooks/useTrackRecording.ts', 'utf8');

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('route control opens an app consent prompt instead of starting immediately', () => {
  assert.match(app, /onStartRoute=\{openRoutePermissionPrompt\}/);
  assert.match(app, /<RouteTrackingPermissionPrompt/);
  assert.doesNotMatch(app, /onStartRoute=\{startTrackingRoute\}/);
  assert.match(appChrome, /role="dialog"/);
  assert.match(appChrome, /routePermissionDecline/);
});

test('route state and clock begin only after a successful fresh GPS fix', () => {
  const startRoute = sourceBetween(
    trackRecording,
    'const startTrackingRoute',
    'const toggleTrackingPause'
  );

  const locationRequestIndex = startRoute.indexOf('await requestTrackingLocation()');
  const trackingStateIndex = startRoute.indexOf('setIsTracking(true)');
  assert.ok(locationRequestIndex >= 0);
  assert.ok(trackingStateIndex > locationRequestIndex);
  assert.match(startRoute, /if \(!locationResult\.ready \|\| !startingLocation\)/);
  assert.match(startRoute, /return locationResult/);
  assert.match(startRoute, /setTrackPaths\(\[\[startingLocation\]\]\)/);
  assert.doesNotMatch(startRoute, /userLocation/);
});

test('route GPS request does not silently enable passive map watching', () => {
  const routeRequest = sourceBetween(
    locationController,
    'const requestTrackingLocation',
    'const requestLocationPermissionOnce'
  );
  const passiveRequest = sourceBetween(
    locationController,
    'const requestLocationPermissionOnce',
    'const requestAppPermissions'
  );

  assert.match(routeRequest, /requestCurrentPosition\(GEOLOCATION_OPTIONS\)/);
  assert.doesNotMatch(routeRequest, /setIsWatchingUserLocation/);
  assert.match(passiveRequest, /setIsWatchingUserLocation\(result\.ready\)/);
});

test('denial, retry, loading, and all supported languages have explicit copy', () => {
  assert.match(appChrome, /errorText/);
  assert.match(appChrome, /isRequesting/);
  assert.match(homeCopy, /routePermissionTitle: 'Record route\?'/);
  assert.match(homeCopy, /routePermissionTitle: '记录路线？'/);
  assert.match(homeCopy, /routePermissionTitle: '경로 기록할까요\?'/);
  assert.equal((homeCopy.match(/routePermissionRetry:/g) || []).length, 3);
  assert.equal((homeCopy.match(/permissionInsecure:/g) || []).length, 3);
  assert.equal((homeCopy.match(/permissionTimeout:/g) || []).length, 3);
});

test('initial prompt stays open on GPS failure and closes only after GPS is ready', () => {
  const initialRequest = sourceBetween(
    locationController,
    'const handleInitialPermissionRequest',
    'React.useEffect'
  );
  const appPermissionRequest = sourceBetween(
    locationController,
    'const requestAppPermissions',
    'const handleOpenPermissions'
  );

  const permissionResultIndex = initialRequest.indexOf('await requestAppPermissions()');
  const closePromptIndex = initialRequest.indexOf('setIsInitialPermissionPromptOpen(false)');
  assert.ok(permissionResultIndex >= 0);
  assert.ok(closePromptIndex > permissionResultIndex);
  assert.match(initialRequest, /if \(nextState !== 'ready'\) return/);
  assert.match(appPermissionRequest, /locationResult\.ready \? 'ready' : locationResult\.reason/);
  assert.doesNotMatch(appPermissionRequest, /headingReady \|\| locationReady/);
});

test('location failures distinguish insecure preview, denial, timeout, and unavailable position', () => {
  assert.match(sensorUtils, /!window\.isSecureContext/);
  assert.match(sensorUtils, /return 'insecure'/);
  assert.match(sensorUtils, /PERMISSION_DENIED[^]*return 'denied'/);
  assert.match(sensorUtils, /TIMEOUT[^]*return 'timeout'/);
  assert.match(sensorUtils, /return 'unavailable'/);
});

test('pausing a route disables its active sensor watch', () => {
  const stateBridge = sourceBetween(
    locationController,
    'const setTrackingState',
    'return {'
  );
  assert.match(stateBridge, /state\.isTracking && !state\.isPaused/);
  assert.match(stateBridge, /stopHeadingWatch\(\)/);
});
