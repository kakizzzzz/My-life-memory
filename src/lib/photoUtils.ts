import * as exifr from 'exifr';
import { UPLOAD_IMAGE_MAX_BYTES } from '../constants/appDefaults';

const canvasToImageBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number) => (
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not compress image.'));
    }, mimeType, quality);
  })
);

const imageBlobToDataUrl = (blob: Blob) => (
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  })
);

const getImageExtension = (mimeType: string) => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
};

export const getImageDownloadFileName = (title: string, mimeType = 'image/jpeg') => {
  const baseName = title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${baseName}.${getImageExtension(mimeType)}`;
};

const loadImageFile = (file: File) => (
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image.'));
    };
    image.src = objectUrl;
  })
);

export const compressImageFileToDataUrl = async (file: File) => {
  const image = await loadImageFile(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  const maxDimension = 900;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  let quality = 0.8;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToImageBlob(canvas, 'image/jpeg', quality);
    lastBlob = blob;
    if (blob.size <= UPLOAD_IMAGE_MAX_BYTES) return imageBlobToDataUrl(blob);

    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.12);
    } else {
      width = Math.max(220, Math.round(width * 0.84));
      height = Math.max(220, Math.round(height * 0.84));
      quality = 0.72;
    }
  }

  if (!lastBlob) throw new Error('Could not compress image.');
  return imageBlobToDataUrl(lastBlob);
};

export const dataUrlToFile = async (dataUrl: string, fileName: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
};

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

type TiffEntry = {
  type: number;
  count: number;
  valueOffset: number;
  entryOffset: number;
};

const readExifGpsFromArrayBuffer = (buffer: ArrayBuffer): [number, number] | null => {
  const view = new DataView(buffer);
  if (view.byteLength < 14 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = view.getUint16(offset + 2, false);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;

    if (
      marker === 0xe1 &&
      segmentStart + 14 < view.byteLength &&
      view.getUint8(segmentStart) === 0x45 &&
      view.getUint8(segmentStart + 1) === 0x78 &&
      view.getUint8(segmentStart + 2) === 0x69 &&
      view.getUint8(segmentStart + 3) === 0x66
    ) {
      const tiffStart = segmentStart + 6;
      const byteOrder = view.getUint16(tiffStart, false);
      const littleEndian = byteOrder === 0x4949;
      if (!littleEndian && byteOrder !== 0x4d4d) return null;
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

      const readIfd = (ifdOffset: number) => {
        const entries = new Map<number, TiffEntry>();
        const absoluteOffset = tiffStart + ifdOffset;
        if (absoluteOffset < tiffStart || absoluteOffset + 2 > view.byteLength) return entries;
        const count = view.getUint16(absoluteOffset, littleEndian);
        for (let index = 0; index < count; index += 1) {
          const entryOffset = absoluteOffset + 2 + index * 12;
          if (entryOffset + 12 > view.byteLength) break;
          const tag = view.getUint16(entryOffset, littleEndian);
          entries.set(tag, {
            type: view.getUint16(entryOffset + 2, littleEndian),
            count: view.getUint32(entryOffset + 4, littleEndian),
            valueOffset: view.getUint32(entryOffset + 8, littleEndian),
            entryOffset,
          });
        }
        return entries;
      };

      const entryValueOffset = (entry?: TiffEntry) => {
        if (!entry) return -1;
        const byteLength = (TIFF_TYPE_SIZES[entry.type] || 1) * entry.count;
        return byteLength <= 4 ? entry.entryOffset + 8 : tiffStart + entry.valueOffset;
      };

      const readAscii = (entry?: TiffEntry) => {
        const valueOffset = entryValueOffset(entry);
        if (!entry || valueOffset < 0 || valueOffset + entry.count > view.byteLength) return '';
        let value = '';
        for (let index = 0; index < entry.count; index += 1) {
          const code = view.getUint8(valueOffset + index);
          if (code === 0) break;
          value += String.fromCharCode(code);
        }
        return value.trim();
      };

      const readRationalArray = (entry?: TiffEntry) => {
        const valueOffset = entryValueOffset(entry);
        if (!entry || valueOffset < 0 || valueOffset + entry.count * 8 > view.byteLength) return [];
        const values: number[] = [];
        for (let index = 0; index < entry.count; index += 1) {
          const numerator = view.getUint32(valueOffset + index * 8, littleEndian);
          const denominator = view.getUint32(valueOffset + index * 8 + 4, littleEndian);
          values.push(denominator ? numerator / denominator : 0);
        }
        return values;
      };

      const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
      const ifd0 = readIfd(firstIfdOffset);
      const gpsIfdPointer = ifd0.get(0x8825);
      if (!gpsIfdPointer) return null;
      const gpsIfd = readIfd(gpsIfdPointer.valueOffset);
      const latRef = readAscii(gpsIfd.get(0x0001));
      const latValues = readRationalArray(gpsIfd.get(0x0002));
      const lngRef = readAscii(gpsIfd.get(0x0003));
      const lngValues = readRationalArray(gpsIfd.get(0x0004));
      if (latValues.length < 3 || lngValues.length < 3) return null;

      const toDecimal = (values: number[], ref: string) => {
        const decimal = values[0] + values[1] / 60 + values[2] / 3600;
        return ['S', 'W'].includes(ref.toUpperCase()) ? -decimal : decimal;
      };

      const lat = toDecimal(latValues, latRef);
      const lng = toDecimal(lngValues, lngRef);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [lat, lng]
        : null;
    }

    if (segmentLength < 2 || segmentEnd <= offset) break;
    offset = segmentEnd;
  }

  return null;
};

export const readPhotoGpsCoordinates = async (file: File): Promise<[number, number] | null> => {
  try {
    const gps = await exifr.gps(file);
    if (
      gps &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      Math.abs(gps.latitude) <= 90 &&
      Math.abs(gps.longitude) <= 180
    ) {
      return [gps.latitude, gps.longitude];
    }
  } catch {
    // Fall back to the lightweight JPEG parser below.
  }

  try {
    const buffer = await file.arrayBuffer();
    return readExifGpsFromArrayBuffer(buffer);
  } catch {
    return null;
  }
};
