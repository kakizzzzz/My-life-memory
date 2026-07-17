import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = process.argv[2];
const outputPath = resolve(
  process.argv[3] || 'supabase/functions/_shared/memory-country-regions.ts',
);

if (!sourcePath) {
  throw new Error('Usage: node scripts/generate-memory-region-catalog.mjs <Natural Earth GeoJSON> [output]');
}

const source = JSON.parse(readFileSync(resolve(sourcePath), 'utf8'));
const features = Array.isArray(source.features) ? source.features : [];
const localizedNameKeys = [
  'NAME', 'NAME_LONG', 'NAME_SORT', 'NAME_ALT', 'ADMIN', 'SOVEREIGNT',
  'FORMAL_EN', 'ABBREV', 'NAME_EN', 'NAME_ZH', 'NAME_ZHT', 'NAME_JA', 'NAME_KO',
];
const extraAliases = {
  CN: ['中国大陆', '大陆'],
  GB: ['英国', 'UK', 'U.K.'],
  HK: ['香港特别行政区', 'Hong Kong SAR'],
  JP: ['日本国'],
  KP: ['朝鲜', '北韩'],
  KR: ['韩国', '南韩', '大韩民国'],
  MO: ['澳门特别行政区', 'Macao SAR', 'Macau'],
  RU: ['俄罗斯', '俄国'],
  TW: ['台湾'],
  US: ['美国', '美利坚', 'USA', 'U.S.', 'United States of America'],
};
const extraBoxes = {
  JP: [
    [24, 122.5, 27.9, 131.4],
    [20.3, 136, 27.8, 154],
  ],
  US: [[18.8, -160.5, 22.5, -154.5]],
};

const round = value => Math.round(value * 10_000) / 10_000;

const boxForPoints = points => {
  const valid = points.filter(point => Array.isArray(point)
    && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!valid.length) return null;
  const lngs = valid.map(point => Number(point[0]));
  const lats = valid.map(point => Number(point[1]));
  return [
    round(Math.min(...lats)),
    round(Math.min(...lngs)),
    round(Math.max(...lats)),
    round(Math.max(...lngs)),
  ];
};

const boxesForRing = ring => {
  const full = boxForPoints(ring);
  if (!full) return [];
  if (full[3] - full[1] <= 180) return [full];
  return [
    boxForPoints(ring.filter(point => Number(point?.[0]) < 0)),
    boxForPoints(ring.filter(point => Number(point?.[0]) >= 0)),
  ].filter(Boolean);
};

const geometryBoxes = geometry => {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  const boxes = polygons.flatMap(polygon => boxesForRing(Array.isArray(polygon?.[0]) ? polygon[0] : []));
  return [...new Map(boxes.map(box => [box.join(','), box])).values()];
};

const cleanAlias = value => typeof value === 'string' ? value.trim() : '';

const regions = features.map(feature => {
  const properties = feature.properties || {};
  const preferredCode = [properties.ISO_A2_EH, properties.ISO_A2, properties.POSTAL, properties.ADM0_A3]
    .map(cleanAlias)
    .find(value => value && value !== '-99') || '';
  const name = cleanAlias(properties.NAME_EN) || cleanAlias(properties.ADMIN) || preferredCode;
  const aliases = localizedNameKeys
    .map(key => cleanAlias(properties[key]))
    .concat(extraAliases[preferredCode] || [], preferredCode)
    .filter(Boolean);
  return {
    code: preferredCode,
    name,
    aliases: [...new Set(aliases)].sort((left, right) => right.length - left.length || left.localeCompare(right)),
    boxes: [...geometryBoxes(feature.geometry), ...(extraBoxes[preferredCode] || [])],
  };
}).filter(region => region.code && region.name && region.boxes.length);

regions.push(
  {
    code: 'HK',
    name: 'Hong Kong',
    aliases: ['香港特别行政区', 'Hong Kong SAR', 'Hong Kong', '香港', '홍콩', '香港'],
    boxes: [[22.13, 113.8, 22.58, 114.52]],
  },
  {
    code: 'MO',
    name: 'Macao',
    aliases: ['澳门特别行政区', 'Macao SAR', 'Macau', 'Macao', '澳门', '澳門', '마카오', 'マカオ'],
    boxes: [[22.06, 113.52, 22.23, 113.64]],
  },
);

const merged = [...regions.reduce((byCode, region) => {
  const existing = byCode.get(region.code);
  if (!existing) {
    byCode.set(region.code, region);
    return byCode;
  }
  existing.aliases = [...new Set([...existing.aliases, ...region.aliases])]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  existing.boxes = [...new Map([...existing.boxes, ...region.boxes].map(box => [box.join(','), box])).values()];
  return byCode;
}, new Map()).values()].sort((left, right) => left.name.localeCompare(right.name));

const generated = `// Generated from Natural Earth 1:110m admin-0 country data.\n`
  + `// Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/\n`
  + `// Run scripts/generate-memory-region-catalog.mjs to refresh this file.\n\n`
  + `export type MemoryRegionBox = readonly [number, number, number, number];\n\n`
  + `export type MemoryCountryRegion = {\n`
  + `  code: string;\n`
  + `  name: string;\n`
  + `  aliases: readonly string[];\n`
  + `  boxes: readonly MemoryRegionBox[];\n`
  + `};\n\n`
  + `export const MEMORY_COUNTRY_REGIONS: readonly MemoryCountryRegion[] = `
  + `${JSON.stringify(merged, null, 2)} as const;\n`;

writeFileSync(outputPath, generated);
console.log(`Generated ${merged.length} memory regions at ${outputPath}`);
