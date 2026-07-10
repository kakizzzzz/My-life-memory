# Third-Party Notices

The Apache License 2.0 in this repository applies to the My Life Memory source code. It does not relicense third-party map data, imagery, fonts, libraries, hosted tile services, or other external material.

## OpenStreetMap data

The light and dark map styles include map data from OpenStreetMap and other open datasets rendered by EOX.

- Attribution: © OpenStreetMap contributors
- Licence information: https://www.openstreetmap.org/copyright
- OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL).
- OpenStreetMap attribution remains visible beside the interactive map and links to the copyright and licence information.

## EOX::Maps

The built-in map styles request remote tiles from EOX::Maps.

- Service information and permitted application use: https://maps.eox.at/
- Light and dark styles use the EOX Terrain Light layer.
- Rendering attribution: © EOX
- EOX requests a link back to EOX::Maps and the relevant data/rendering attribution. Those links remain visible in the map corner.
- EOX provides its public demo service as-is and may rate-limit requests. The application does not bundle, mirror, bulk-download, or redistribute EOX tile files.
- Deployments expecting substantial traffic should arrange an appropriate dedicated tile service instead of treating the public demo endpoint as an unlimited CDN.

## Sentinel-2 Cloudless

The aerial style uses the EOX Sentinel-2 Cloudless 2025 viewing layer.

- Product and source information: https://cloudless.eox.at/
- Service information: https://maps.eox.at/
- Attribution shown in the app: Sentinel-2 cloudless 2025 © EOX, contains modified Copernicus Sentinel data 2025.
- The aerial layer is loaded remotely and is not distributed under this repository's Apache License 2.0.

## Fonts and software dependencies

Runtime and development dependencies keep their own licences. See `package-lock.json` and the upstream package metadata for exact versions and licence terms. Google Fonts are loaded remotely by the current stylesheet and remain subject to their respective font licences and service terms.

## Replacing map providers

Forks and deployments may replace the URLs in `src/constants/mapTiles.ts`. A replacement provider's attribution, licence, API-key requirements, usage limits, caching rules, and commercial-use terms must be reviewed independently. Removing or hiding required map attribution is not permitted merely because the application source code is open source.
