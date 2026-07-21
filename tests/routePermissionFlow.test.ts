import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const appChrome = readFileSync('src/AppChrome.tsx', 'utf8');
const homeCopy = readFileSync('src/copy/homeCopy.ts', 'utf8');
const locationController = readFileSync('src/hooks/useLocationController.ts', 'utf8');
const mapStarActions = readFileSync('src/hooks/useMapStarActions.ts', 'utf8');
const sensorUtils = readFileSync('src/lib/sensorUtils.ts', 'utf8');
const trackRecording = readFileSync('src/hooks/useTrackRecording.ts', 'utf8');

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('route control reuses successful location consent and prompts only before access exists', () => {
  const routeOpen = sourceBetween(
    app,
    'const openRoutePermissionPrompt',
    'const confirmRoutePermission'
  );

  assert.match(app, /onStartRoute=\{openRoutePermissionPrompt\}/);
  assert.match(app, /<RouteTrackingPermissionPrompt/);
  assert.doesNotMatch(app, /onStartRoute=\{startTrackingRoute\}/);
  assert.match(routeOpen, /if \(hasGrantedLocationAccess\)/);
  assert.match(routeOpen, /void beginRouteRecording\(true\)/);
  assert.match(routeOpen, /setIsRoutePermissionPromptOpen\(true\)/);
  assert.match(appChrome, /role="dialog"/);
  assert.match(appChrome, /routePermissionDecline/);
});

test('map origin, settings, and route all share the same live location consent gate', () => {
  assert.match(app, /onLocateMe=\{handleOpenPermissions\}/);
  assert.match(app, /onOpenPermissions=\{handleOpenPermissions\}/);
  assert.match(app, /if \(hasGrantedLocationAccess\)[^]*void beginRouteRecording\(true\)/);
  assert.doesNotMatch(mapStarActions, /const handleLocateMe/);
  assert.doesNotMatch(mapStarActions, /setFlyTarget\(\[userLocation\[0\], userLocation\[1\]\]\)/);
});

test('a direct route start reveals the retry prompt only when the fresh fix fails', () => {
  const beginRoute = sourceBetween(
    app,
    'const beginRouteRecording',
    'const openRoutePermissionPrompt'
  );

  assert.match(beginRoute, /routePermissionRequestRef\.current/);
  assert.match(beginRoute, /const result = await startTrackingRoute\(\)/);
  assert.match(beginRoute, /if \(openPromptOnFailure\) setIsRoutePermissionPromptOpen\(true\)/);
  assert.match(beginRoute, /routePermissionRequestRef\.current = false/);
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
  assert.match(homeCopy, /initialPermissionsBody: 'Used for map location and route recording\.'/);
  assert.match(homeCopy, /initialPermissionsBody: '用于地图定位和路线记录。'/);
  assert.match(homeCopy, /initialPermissionsBody: '지도 위치와 경로 기록에 사용합니다\.'/);
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

test('settings location reuses successful access and prompts only before the first grant', () => {
  const settingsOpen = sourceBetween(
    locationController,
    'const handleOpenPermissions',
    'const closeInitialPermissionPrompt'
  );
  const appPermissionRequest = sourceBetween(
    locationController,
    'const requestAppPermissions',
    'const handleOpenPermissions'
  );

  assert.match(settingsOpen, /if \(hasGrantedLocationAccess\)/);
  assert.match(settingsOpen, /void requestAppPermissions\(\)/);
  assert.match(settingsOpen, /setIsInitialPermissionPromptOpen\(true\)/);
  assert.match(appPermissionRequest, /await requestLocationPermissionOnce\(\)/);
  assert.doesNotMatch(appPermissionRequest, /startHeadingWatch/);
});

test('starting an approved request grants the shared shortcut while browser denial revokes it', () => {
  const currentPositionRequest = sourceBetween(
    locationController,
    'const requestCurrentPosition',
    'const stopGpsWatch'
  );
  const grantIndex = currentPositionRequest.indexOf('setHasGrantedLocationAccess(true)');
  const browserRequestIndex = currentPositionRequest.indexOf('navigator.geolocation.getCurrentPosition');

  assert.ok(grantIndex >= 0);
  assert.ok(browserRequestIndex > grantIndex);
  assert.match(locationController, /if \(reason === 'denied'\) setHasGrantedLocationAccess\(false\)/);
  assert.match(locationController, /setHasGrantedLocationAccess\(false\);[^]*setIsWatchingUserLocation\(false\)/);
  assert.match(locationController, /if \(nextState === 'denied'\) setIsInitialPermissionPromptOpen\(true\)/);
});

test('declining passive location cancels work and restores the centered fallback marker', () => {
  const clearPassiveLocation = sourceBetween(
    locationController,
    'const clearPassiveLocation',
    'const startHeadingWatch'
  );
  const closePrompt = sourceBetween(
    locationController,
    'const closeInitialPermissionPrompt',
    'const handleInitialPermissionRequest'
  );

  assert.match(closePrompt, /clearPassiveLocation\(\)/);
  assert.match(clearPassiveLocation, /cancelPendingLocationRequest\(\)/);
  assert.match(clearPassiveLocation, /stopGpsWatch\(\)/);
  assert.match(clearPassiveLocation, /stopHeadingWatch\(\)/);
  assert.match(clearPassiveLocation, /setUserLocation\(\[\.\.\.DEFAULT_USER_LOCATION\]\)/);
  assert.match(clearPassiveLocation, /setFlyTarget\(\[\.\.\.DEFAULT_USER_LOCATION\]\)/);
});

test('entering the map can open consent UI but cannot call browser geolocation', () => {
  const entryEffect = sourceBetween(
    locationController,
    "if (!isSignedIn || activeView !== 'map' || hasRequestedEntryLocationRef.current) return;",
    "React.useEffect(() => {\n    if (typeof document === 'undefined') return;"
  );

  assert.match(entryEffect, /setIsInitialPermissionPromptOpen\(true\)/);
  assert.doesNotMatch(entryEffect, /requestLocationPermissionOnce/);
  assert.doesNotMatch(entryEffect, /navigator\.geolocation/);
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
