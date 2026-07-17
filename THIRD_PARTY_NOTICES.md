# Third-Party Notices

The Apache License 2.0 in this repository applies to the My Life Memory source code. It does not relicense third-party map data, imagery, fonts, libraries, hosted tile services, or other external material.

## OpenStreetMap data

The light and dark map styles include map data from OpenStreetMap delivered through OpenFreeMap and the OpenMapTiles schema.

- Attribution: © OpenStreetMap contributors
- Licence information: https://www.openstreetmap.org/copyright
- OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL).
- OpenStreetMap attribution remains visible beside the interactive map and links to the copyright and licence information.

## Memory place resolution

The read-only Memory API can resolve an explicit city, town, village, neighbourhood, or administrative place name through a configurable Nominatim-compatible endpoint.

- Default public-service policy: https://operations.osmfoundation.org/policies/nominatim/
- API documentation: https://nominatim.org/release-docs/latest/api/Search/
- Attribution: Geocoding data © OpenStreetMap contributors, ODbL 1.0.
- Only the explicit geographic name is sent to the resolver. Note text, full user prompts, account data, and saved coordinates are not submitted.
- Requests are user-triggered, limited to at most one per second per warm function instance, and cached for 24 hours in that instance.
- `MEMORY_GEOCODER_URL` makes the service replaceable without a client update. Substantial deployments should self-host or use a provider whose capacity and terms fit their traffic.

The offline country catalogue is generated from Natural Earth 1:110m admin-0 data. Natural Earth states that its vector and raster data is in the public domain: https://www.naturalearthdata.com/about/terms-of-use/

## OpenFreeMap and OpenMapTiles

The light and dark styles request remote vector map resources from OpenFreeMap.

- Service and source information: https://openfreemap.org/
- OpenMapTiles information: https://openmaptiles.org/
- OpenFreeMap's public instance is free to use without an API key and is provided without an SLA.
- Attribution remains visible as OpenFreeMap, OpenMapTiles, and OpenStreetMap links.
- The application does not bundle, mirror, bulk-download, or redistribute OpenFreeMap tiles.

## MapLibre GL JS and the Leaflet compatibility layer

OpenFreeMap vector styles are rendered with MapLibre GL JS and `@maplibre/maplibre-gl-leaflet`.

- MapLibre GL JS is an open-source, community-governed WebGL map renderer.
- The Leaflet compatibility layer keeps the existing Leaflet markers, routes, and location controls working above the vector basemap.
- These packages retain their upstream licences as recorded in `package-lock.json` and package metadata.

## VersaTiles Satellite and orthophotos

The aerial style uses the public VersaTiles Satellite style and tile service.

- Service information: https://versatiles.org/
- Imagery sources and their attribution requirements: https://versatiles.org/sources/
- Tileset documentation: https://docs.versatiles.org/basics/tilesets.html#satellite
- The tileset combines openly available global satellite imagery with regional public orthophotos. Resolution and source licensing vary by region.
- The application displays a linked `VersaTiles imagery sources` credit and the OpenStreetMap attribution used by the hybrid style.
- The application does not bundle, mirror, bulk-download, or redistribute the hosted imagery. The public server is provided without an application-specific SLA; substantial deployments should review the service policy or self-host the published dataset.
- Imagery, source datasets, and the hosted service are not distributed under this repository's Apache License 2.0.

## Fonts and software dependencies

Runtime and development dependencies keep their own licences. See `package-lock.json` and the upstream package metadata for exact versions and licence terms. Google Fonts are loaded remotely by the current stylesheet and remain subject to their respective font licences and service terms.

## Replacing map providers

Forks and deployments may replace the URLs in `src/constants/mapTiles.ts`. A replacement provider's attribution, licence, API-key requirements, usage limits, caching rules, and commercial-use terms must be reviewed independently. Removing or hiding required map attribution is not permitted merely because the application source code is open source.
