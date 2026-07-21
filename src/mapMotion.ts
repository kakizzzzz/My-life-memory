import L from 'leaflet';

type AnimatedMapInternals = L.Map & {
  _moveStart: (zoomChanged?: boolean, noMoveStart?: boolean) => L.Map;
  _move: (center: L.LatLngExpression, zoom: number, data?: { flyTo?: boolean }) => L.Map;
  _moveEnd: (zoomChanged?: boolean) => L.Map;
};

type FlightAnimationState = {
  active: boolean;
  frameId: number | null;
  generation: number;
  positionVelocity: L.Point;
  zoomVelocity: number;
  lastPosition: L.Point | null;
  lastZoom: number;
  lastTime: number;
};

type FluidMapFlightOptions = {
  targetZoom: number;
  durationMs: number;
  arcDepth: number;
};

export const getStandardStarFlightOptions = (
  map: L.Map,
  target: L.LatLngExpression,
): FluidMapFlightOptions => {
  const targetZoom = 16;
  const currentCenter = map.getCenter();
  const targetLatLng = L.latLng(target);
  const currentZoom = map.getZoom();
  const distance = currentCenter.distanceTo(targetLatLng);
  const viewportSize = map.getSize();
  const viewportDiagonal = Math.max(1, Math.hypot(viewportSize.x, viewportSize.y));
  const screenDistance = map.project(currentCenter, currentZoom)
    .distanceTo(map.project(targetLatLng, currentZoom));
  const travelRatio = Math.min(screenDistance / viewportDiagonal, 1);
  const isTinyMove = distance < 200 && Math.abs(currentZoom - targetZoom) < 0.001;

  return {
    targetZoom,
    durationMs: (isTinyMove
      ? 0.62 + (travelRatio * 0.18)
      : 1.25 + (travelRatio * 0.3)) * 1000,
    arcDepth: isTinyMove ? 0 : 0.01 + (travelRatio * 0.03),
  };
};

const flightAnimations = new WeakMap<L.Map, FlightAnimationState>();

const getFlightAnimation = (map: L.Map) => {
  const existing = flightAnimations.get(map);
  if (existing) return existing;

  const animation: FlightAnimationState = {
    active: false,
    frameId: null,
    generation: 0,
    positionVelocity: L.point(0, 0),
    zoomVelocity: 0,
    lastPosition: null,
    lastZoom: map.getZoom(),
    lastTime: 0,
  };
  flightAnimations.set(map, animation);
  return animation;
};

const leafletEaseOut = (progress: number) => 1 - Math.pow(1 - progress, 1.5);

const fluidFlightValue = (
  start: number,
  end: number,
  startVelocity: number,
  duration: number,
  progress: number,
) => {
  const delta = end - start;
  const defaultStartVelocity = (delta * 1.5) / duration;
  const inheritedVelocity = startVelocity - defaultStartVelocity;
  const velocityBlend = progress * Math.pow(1 - progress, 2);
  return start
    + (delta * leafletEaseOut(progress))
    + (inheritedVelocity * duration * velocityBlend);
};

const clampPointVelocity = (velocity: L.Point, duration: number, distance: number) => {
  const tangent = velocity.multiplyBy(duration);
  const tangentLength = Math.hypot(tangent.x, tangent.y);
  const maxTangent = Math.max(distance * 1.25, 0.0001);
  if (tangentLength <= maxTangent) return velocity;
  return tangent.multiplyBy(maxTangent / tangentLength).divideBy(duration);
};

const retargetVelocity = (carriedVelocity: L.Point, delta: L.Point, duration: number) => {
  const distance = Math.hypot(delta.x, delta.y);
  if (distance < 0.0001) return L.point(0, 0);

  const direction = delta.divideBy(distance);
  const defaultSpeed = (distance * 1.5) / duration;
  const carriedForwardSpeed = (carriedVelocity.x * direction.x) + (carriedVelocity.y * direction.y);
  const forwardSpeed = Math.max(defaultSpeed, Math.min(carriedForwardSpeed, defaultSpeed * 1.2));
  const carriedLateral = carriedVelocity.subtract(direction.multiplyBy(carriedForwardSpeed));
  const carriedLateralSpeed = Math.hypot(carriedLateral.x, carriedLateral.y);
  const maxLateralSpeed = defaultSpeed * 0.06;
  const lateralVelocity = carriedLateralSpeed > maxLateralSpeed
    ? carriedLateral.multiplyBy(maxLateralSpeed / carriedLateralSpeed)
    : carriedLateral;

  return direction.multiplyBy(forwardSpeed).add(lateralVelocity);
};

const resetFlightAnimation = (animation: FlightAnimationState) => {
  animation.active = false;
  animation.frameId = null;
  animation.positionVelocity = L.point(0, 0);
  animation.zoomVelocity = 0;
};

export const cancelFluidMapFlight = (map: L.Map) => {
  const animation = flightAnimations.get(map);
  if (!animation) return;

  animation.generation += 1;
  if (animation.frameId !== null) L.Util.cancelAnimFrame(animation.frameId);
  if (animation.active) (map as AnimatedMapInternals)._moveEnd(true);
  resetFlightAnimation(animation);
};

export const startFluidMapFlight = (
  map: L.Map,
  target: L.LatLngExpression,
  { targetZoom, durationMs, arcDepth }: FluidMapFlightOptions,
) => {
  const animatedMap = map as AnimatedMapInternals;
  const animation = getFlightAnimation(map);
  const wasActive = animation.active;
  animation.generation += 1;
  const generation = animation.generation;
  if (animation.frameId !== null) L.Util.cancelAnimFrame(animation.frameId);

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (wasActive) animatedMap._moveEnd(true);
    resetFlightAnimation(animation);
    map.setView(target, targetZoom, { animate: false });
    return;
  }

  const currentCenter = map.getCenter();
  const targetLatLng = L.latLng(target);
  const currentZoom = map.getZoom();
  const duration = Math.max(1, durationMs);
  const startPosition = map.project(currentCenter, 0);
  const targetPosition = map.project(targetLatLng, 0);
  const worldBounds = map.getPixelWorldBounds(0);
  const worldWidth = worldBounds?.getSize().x;
  if (worldWidth) {
    const wrappedDistance = targetPosition.x - startPosition.x;
    if (wrappedDistance > worldWidth / 2) targetPosition.x -= worldWidth;
    else if (wrappedDistance < -worldWidth / 2) targetPosition.x += worldWidth;
  }

  const positionDelta = targetPosition.subtract(startPosition);
  const worldDistance = Math.hypot(positionDelta.x, positionDelta.y);
  let startVelocity = wasActive
    ? retargetVelocity(animation.positionVelocity, positionDelta, duration)
    : positionDelta.multiplyBy(1.5 / duration);
  startVelocity = clampPointVelocity(startVelocity, duration, worldDistance);

  const maxZoomTangent = Math.max(1, Math.abs(targetZoom - currentZoom) + (arcDepth * 2));
  const rawZoomTangent = (wasActive ? animation.zoomVelocity : 0) * duration;
  const startZoomVelocity = Math.abs(rawZoomTangent) > maxZoomTangent
    ? (Math.sign(rawZoomTangent) * maxZoomTangent) / duration
    : (wasActive ? animation.zoomVelocity : 0);
  const startedAt = performance.now();

  if (!wasActive) animatedMap._moveStart(true);
  animation.active = true;
  animation.lastPosition = startPosition;
  animation.lastZoom = currentZoom;
  animation.lastTime = startedAt;

  const frame = () => {
    if (animation.generation !== generation) return;

    const now = performance.now();
    const progress = Math.min((now - startedAt) / duration, 1);
    const nextPosition = L.point(
      fluidFlightValue(startPosition.x, targetPosition.x, startVelocity.x, duration, progress),
      fluidFlightValue(startPosition.y, targetPosition.y, startVelocity.y, duration, progress),
    );
    const baseZoom = fluidFlightValue(currentZoom, targetZoom, startZoomVelocity, duration, progress);
    const arcEnvelope = 16 * progress * progress * (1 - progress) * (1 - progress);
    const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), baseZoom - (arcDepth * arcEnvelope)));
    const deltaTime = Math.max(1, now - animation.lastTime);

    if (animation.lastPosition) {
      animation.positionVelocity = nextPosition.subtract(animation.lastPosition).divideBy(deltaTime);
    }
    animation.zoomVelocity = (nextZoom - animation.lastZoom) / deltaTime;
    animation.lastPosition = nextPosition;
    animation.lastZoom = nextZoom;
    animation.lastTime = now;

    animatedMap._move(map.unproject(nextPosition, 0), nextZoom, { flyTo: true });

    if (progress < 1) {
      animation.frameId = L.Util.requestAnimFrame(frame);
      return;
    }

    resetFlightAnimation(animation);
    animation.lastPosition = targetPosition;
    animation.lastZoom = targetZoom;
    animatedMap._moveEnd(true);
  };

  animation.frameId = L.Util.requestAnimFrame(frame);
};
