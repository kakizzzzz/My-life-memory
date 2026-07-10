# My Life Memory

My Life Memory is a private life-map app for saving places, notes, photos, routes, coordinates, and travel statistics in one personal memory space.

## Screenshots

Screenshots are kept in `docs/screenshots/` after local or Pages preview capture.

| Login | Map | Records |
| --- | --- | --- |
| ![Login screen](docs/screenshots/login.svg) | ![Map screen](docs/screenshots/map.svg) | ![Records screen](docs/screenshots/records.svg) |

## Features

- Place stars for meaningful locations by tapping the map, dragging the star tool, or importing the GPS metadata from one original photo.
- Tap a star to center it on the map, edit its notes, view and copy coordinates, or choose Apple Maps, AMap, Baidu Maps, or Google Maps for native map handoff.
- Write rich notes with text color, font size, underline, photos, camera capture, direct full-screen editing, and saved creation timestamps.
- Browse records by timeline, month/year filters, calendar markers, and a dedicated search results page that lists every matching note with match counts.
- Track adaptive movement routes, view route statistics, location rankings, star-colored bar charts, and a dotted world-map overview.
- Export a readable HTML memory report with note text, dates, coordinates, and embedded images instead of raw app-state JSON.
- Change the account password from the profile screen through Supabase Auth without storing readable passwords in app state.
- Sync per-user data with Supabase Auth, RLS-protected tables, and private Storage.
- Retry failed image deletions so explicitly deleted photos do not remain in cloud storage.
- Show an in-app user manual for map, record, statistics, account, icon, and permission behavior.

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Leaflet + React Leaflet + MapLibre GL JS
- Motion for small UI transitions
- Supabase Auth, Postgres, Row Level Security, and private Storage
- Supabase Edge Functions for invite registration, the Memory API, MCP token management, and cloud MCP
- Local Model Context Protocol (MCP) server for AI clients
- GitHub Pages for static hosting

## Map Data And Tile Services

- Light and dark styles use OpenFreeMap vector maps rendered with MapLibre GL JS through the Leaflet compatibility layer.
- OpenFreeMap styles use OpenMapTiles schema and OpenStreetMap data. Required source and licence links remain visible.
- The aerial style uses the public VersaTiles Satellite style, which combines openly available satellite imagery with higher-resolution public orthophotos where coverage exists.
- VersaTiles requires no account or API key. Its official imagery-source link and OpenStreetMap attribution remain visible.
- Open imagery resolution varies by region. Areas without public orthophoto coverage cannot match proprietary Google, Apple, or commercial imagery, and the app does not use unlicensed raw tile URLs to imitate them.
- Required source and licence links remain visible in the map corner.
- The Apache License 2.0 applies to this repository's source code, not to third-party map data, imagery, hosted services, fonts, or dependencies.
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE) before changing providers, removing attribution, or deploying for substantial traffic.

## Data And Storage

- Supabase Auth stores passwords and sessions.
- `profiles` stores account ID, nickname, and avatar path metadata.
- `app_states` stores stars, notes, routes, settings, and image metadata.
- `life-media` is a private Supabase Storage bucket for avatar and note image files.
- The frontend stores only Storage metadata in app state: `provider`, `bucket`, `path`, `mimeType`, `size`, and `createdAt`.
- Legacy compressed data URL images still render as fallback, but new uploads use Storage when Supabase is configured.
- Photo-GPS star creation uploads the selected photo through the same Storage flow, then creates a star and a note at the embedded photo coordinates. If the photo has no usable GPS metadata, no star is created.
- Deleting an avatar, note image, star, or note queues the related Storage object for deletion. Failed deletes are retried after login, focus, or network recovery.
- Automatic login cleanup of old unreferenced media is intentionally disabled to avoid multi-device stale-state deletion. Media cleanup should stay user-scoped and conservative.
- Rich note HTML is sanitized before save/load so only the note editor's small allowlist is stored.
- Cloud and local app state are normalized at runtime before entering React state, including stars, notes, routes, image metadata, HTML length, data URL compatibility, and GPS coordinate shape.
- Unsaved active route recording is stored as a local draft and can be restored or discarded after reload.
- Password-like fields are removed before saving cloud app state; password changes go through `supabase.auth.updateUser`.
- Readable export intentionally omits raw app state, settings internals, and password fields. It writes a local `.html` report for the user to keep or archive.

## Memory API And MCP

My Life Memory exposes a user-scoped Memory API through the Supabase Edge Function `memory-api`. The API reads the authenticated user's `app_states` row, reshapes it into memory-focused JSON, and never exposes service-role credentials to the frontend or MCP clients.

Supported read actions:

- `search_memories`
- `list_locations`
- `get_location_memory`
- `get_day_memory`
- `get_routes`
- `summarize_memory_range`
- `export_memory_report`

The codebase contains these write/delete actions for future controlled integrations:

- `create_star`
- `update_star`
- `add_note_to_star`
- `update_note`
- `delete_note`
- `delete_star`
- `delete_route`

In production, write/delete actions are disabled by default. They are accepted only when the Edge Function secret `ENABLE_MEMORY_API_WRITES=true` is set. Even then, write actions require `confirmWrite: true`, delete actions additionally require `confirm: "DELETE"`, rich HTML is sanitized server-side, and referenced private Storage media is removed only inside the current user's folder.

The local stdio MCP server wraps this API for desktop AI apps:

```sh
npm run mcp:memory
```

MCP environment variables:

```bash
MLM_SUPABASE_URL=https://your-project-ref.supabase.co
MLM_SUPABASE_ANON_KEY=your-publishable-or-anon-key
MLM_ACCOUNT=your-account-id
MLM_PASSWORD=your-password
```

You can use `MLM_SUPABASE_ACCESS_TOKEN` instead of `MLM_ACCOUNT` and `MLM_PASSWORD` if an AI client or helper has already obtained a user token.

Mobile MCP clients should use the cloud MCP Edge Function:

```text
https://your-project-ref.supabase.co/functions/v1/mcp
```

Cloud MCP server secrets:

```bash
MEMORY_API_INTERNAL_TOKEN=choose-a-long-random-server-token
ALLOWED_ORIGINS=https://your-pages-domain.example,http://localhost:3000
```

Users generate their own MCP token inside the app:

1. Log in to My Life Memory.
2. Open Settings.
3. Open AI memory access.
4. Generate an MCP token and copy it immediately.

Phone clients should choose Streamable HTTP, set the URL to the cloud function URL, and set the authorization header to `Bearer <generated-user-mcp-token>`. The full token is shown only once. Each user can have only one active MCP token; generating a new one replaces the old row, and revoking deletes it. Supabase stores only a SHA-256 hash in `public.mcp_tokens`, so each token maps to exactly one user and cannot read another account's data. The phone never receives the Supabase URL, publishable key, service role key, or app password.

MCP exposes only read-only tools. This keeps AI clients useful for retrieval and analysis without letting them create, edit, or delete the user's private memories.

## Local Development

Prerequisite: Node.js 20 or newer is recommended.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000/](http://localhost:3000/).

`.env.local` needs:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

## Supabase Setup

1. Create a Supabase project.
2. In Authentication settings, disable public Email signup after the invite function is deployed, so new users cannot bypass the invite flow with the anon key.
3. Open SQL Editor and run `supabase/schema.sql`.
4. Confirm these objects exist:
   - `public.profiles`
   - `public.app_states`
   - private Storage bucket `life-media`
   - RLS policies for both tables and `storage.objects`
5. Deploy the Supabase Edge Functions `register-with-invite`, `memory-api`, `mcp-token`, and `mcp`.
6. Store the invite code only as the Edge Function secret named `INVITE_CODE`. Do not put the code in frontend env vars, source files, README examples, localStorage, app state, or export data.
7. Store `MEMORY_API_INTERNAL_TOKEN` as a long random Edge Function secret. The cloud MCP function uses it only to call `memory-api` internally.
8. Store `ALLOWED_ORIGINS` as a comma-separated list of browser origins allowed to call the browser-facing Edge Functions, for example `https://yourname.github.io,http://localhost:3000`. The token-protected cloud `mcp` endpoint accepts native-client origins separately so mobile MCP transports are not blocked by browser-origin rules.
9. Keep `ENABLE_MEMORY_API_WRITES` unset unless you intentionally want to test API write/delete actions.
10. The functions also require Supabase server environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
11. If permissions look wrong, run `supabase/verify-cloud-backend.sql` to inspect the project.
12. If table grants are missing, run `supabase/fix-permissions.sql`.

Storage paths are user scoped:

```text
authUserId/notes/noteId/imageId.jpg
authUserId/avatars/profile/imageId.jpg
```

## Deployment

For GitHub Pages:

1. Add production Supabase env vars to the build environment.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Run:

   ```sh
   npm run build
   ```

3. Publish `dist/` to the Pages branch or use `.github/workflows/deploy-pages.yml`.
4. After deploy, open the Pages URL and test:
   - register and log in
   - switch accounts on the same device and confirm each account sees only its own data
   - upload an avatar
   - add a note image
   - create a star from a photo with GPS metadata
   - search note text and open a result from the search results page
   - change the password from the profile screen
   - export a readable HTML report
   - call `memory-api` with a logged-in user's bearer token
   - generate an MCP token in Settings and list cloud MCP read-only tools from a mobile/HTTP MCP client
   - start the local MCP server and list read-only tools
   - reload on another device/browser
   - delete the image and confirm it disappears
   - switch all map styles and confirm attribution links remain visible and open the correct provider/licence pages

## Security Notes

- Do not commit `.env.local`, service role keys, database passwords, or raw SQL connection strings.
- The frontend must use only the Supabase publishable/anon key.
- `service_role` belongs only in trusted server environments and is not needed for this app.
- Registration is gated by the Supabase Edge Function `register-with-invite`; existing accounts log in normally and do not need an invite code.
- Browser-facing Edge Functions reject origins outside `ALLOWED_ORIGINS`. The cloud `mcp` endpoint accepts native MCP origins because access is instead gated by a per-user bearer token; all functions continue to apply basic in-memory rate limits by IP plus account/token prefix.
- The `memory-api` Edge Function must authenticate a real user bearer token, or a private internal MCP call with a resolved `user_id`, before reading or changing app state.
- Cloud MCP tokens are per-user. The app shows the full token once, stores only one active hash per user in `public.mcp_tokens`, and can delete the active token from Settings.
- The local MCP server logs in as one normal user or uses one user access token; it does not use service-role credentials.
- MCP is read-only and updates `mcp_tokens.last_used_at` after successful token authentication. Direct Memory API write/delete actions are production-disabled by default and require normal user authentication, `ENABLE_MEMORY_API_WRITES=true`, and explicit confirmation fields.
- Rich text HTML is sanitized on the client and in Memory API write paths. Stored notes allow only `p`, `br`, `span`, `u`, `figure`, and `img`, plus a small safe style/metadata allowlist.
- Note editors paste plain text by default. Pasted images go through the upload path, and external HTML is not inserted directly into contentEditable editors.
- Statistics iframe previews run without `allow-same-origin` in the sandbox. Future production work should localize external D3/topojson/world-atlas assets.
- The invite code must live only in Supabase Function Secrets as `INVITE_CODE`.
- After deployment, disable public Supabase Email signup so registration cannot bypass the Edge Function.
- RLS ensures users can read/write only their own profile, app state, and Storage objects.
- Private images are rendered with short-lived signed URLs; signed URLs are not stored in app state.
- App state sanitization strips password-like fields before cloud save. Production builds do not allow local account/password fallback when Supabase is not configured.
- Supabase Auth passwords cannot be viewed by the app. The app supports changing passwords, not revealing saved passwords.
- Explicit media deletion is user scoped by the authenticated user UUID folder, for example `authUserId/notes/noteId/imageId.jpg`.
- Legacy data URL images are kept only as compatibility fallback. They should not be used as the long-term storage path for new media.
- If GitHub Pages is used as a live demo, configure Supabase environment variables in GitHub Actions secrets before building.

## Useful Scripts

```sh
npm run dev
npm run mcp:memory
npm run lint
npm test
npm run build
```

## License

My Life Memory source code is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Third-party map data, imagery, hosted services, fonts, and dependencies are not relicensed by Apache 2.0. See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
