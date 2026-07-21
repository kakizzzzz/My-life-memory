export type DeviceOrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

export type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

export type LocationFailureReason = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export type LocationRequestResult =
  | { ready: true; reason: null }
  | { ready: false; reason: LocationFailureReason };

export const getBrowserGeolocationFailure = (): LocationFailureReason | null => {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  return null;
};

export const canUseBrowserGeolocation = () => getBrowserGeolocationFailure() === null;

export const getGeolocationFailureReason = (error: GeolocationPositionError): LocationFailureReason => {
  if (error.code === error.PERMISSION_DENIED) return 'denied';
  if (error.code === error.TIMEOUT) return 'timeout';
  return 'unavailable';
};

export const getCompassHeading = (event: DeviceOrientationEventWithCompass) => {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return (event.webkitCompassHeading + 360) % 360;
  }

  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return (360 - event.alpha + 360) % 360;
  }

  return null;
};
