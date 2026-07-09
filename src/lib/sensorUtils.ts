export type DeviceOrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

export type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

export const canUseBrowserGeolocation = () => (
  typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
);

export const getCompassHeading = (event: DeviceOrientationEventWithCompass) => {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return (event.webkitCompassHeading + 360) % 360;
  }

  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return (360 - event.alpha + 360) % 360;
  }

  return null;
};
