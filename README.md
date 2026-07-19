![My Life Memory product overview showing the map, notes, routes, statistics, records, reader, and profile](docs/my-life-memory-overview.webp)

<div align="center">
  <h1>My Life Memory</h1>
  <p>My Life Memory is a private spatial memory system for places, notes, photos, and routes. AI clients the user trusts can research that archive through user-controlled, read-only MCP access.</p>
  <p><a href="https://kakizzzzz.github.io/My-life-memory/"><strong>Live Demo</strong></a></p>
</div>

---

## Screenshots

The six views below follow the app's core journey: shape places with stars, preserve memories in text and photos, record movement, and revisit the patterns and moments that emerge.

<table>
  <tr>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/star-color-customization.webp" alt="Star color customization on the main map" width="160"><br><br>
      <strong>Star color</strong><br>
      <sub>Place memories on the map and give each star its own visual identity.</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/memory-note-editor.webp" alt="Memory note editor with photo and rich text" width="160"><br><br>
      <strong>Memory note</strong><br>
      <sub>Combine a place with rich text, photos, color, size, and underline.</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/route-tracking.webp" alt="Saved route with distance and duration" width="160"><br><br>
      <strong>Route tracking</strong><br>
      <sub>Record real movement and revisit distance, duration, and route shape.</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/trip-statistics.webp" alt="Trip statistics and location ranking" width="160"><br><br>
      <strong>Trip statistics</strong><br>
      <sub>Turn stars and routes into location counts, rankings, and travel patterns.</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/records-timeline.webp" alt="Timeline of saved memory records" width="160"><br><br>
      <strong>My records</strong><br>
      <sub>Revisit saved notes as a dated timeline with monthly and annual views.</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="docs/screenshots/memory-reader.webp" alt="Saved memory reader with writing, photography, and original date" width="160"><br><br>
      <strong>Memory reader</strong><br>
      <sub>Revisit a saved place through writing, photography, and its original date.</sub>
    </td>
  </tr>
</table>

## Features

- **Map meaningful places.** Start from real GPS, choose a map style, and create, move, recolor, sequence, or open stars in external map apps.
- **Turn a photo into a place.** Import one geotagged photo to create a star at its original coordinates and a linked photo note automatically.
- **Keep a place notebook.** Each star holds multiple dated notes with styled text, private photos, camera capture, and focused reading and editing views.
- **Record real movement.** One adaptive GPS recorder handles common travel speeds, pause and resume, weak-signal gaps, drafts, distance, duration, and route shape.
- **Revisit the archive.** Find memories through timelines, calendars, date filters, text or coordinate search, location rankings, route statistics, and the dotted world map.
- **Keep control of the data.** Private accounts sync independently and support an image gallery, date-range export, themes, permissions, password changes, and permanent account deletion.

## AI Memory Research via MCP

My Life Memory extends a private archive to compatible AI clients through a user-generated, read-only MCP token. The service researches only the authenticated user's places, dates, notes, and routes; after a separate ownership check, a vision-capable client may request a bounded set of selected photos linked to supported notes. It cannot create, edit, or delete memories.

Research combines spatial, temporal, note, and route evidence, including supported user-relative places such as home, work, or study. Unsupported questions return no unrelated records, while genuine ambiguity asks the user to confirm a privacy-screened clue or neutral fallback. No model, embedding service, or vector database runs in the backend. See [Memory API And MCP Reference](#memory-api-and-mcp-reference) for the interface and connection steps.

## OpenAI Build Week

My Life Memory existed before OpenAI Build Week, with its core map, place stars, memory notes, route recording, foundational interface, normalized user-scoped storage, synchronization foundation, account lifecycle, and core privacy controls already in place.

During the official Submission Period, I continued to lead the product direction, feature decisions, testing, and acceptance. All visual design, UI/UX, and interaction design were created independently by me. Under my direction, the project was extended with server-owned media retention, date-range export, local-time-zone handling, rich-text and media reliability improvements, and an evidence-grounded read-only MCP research layer with strict ambiguity and privacy boundaries.

Codex handled implementation, refactoring, debugging, testing, documentation, and deployment verification. GPT-5.6 supported product and architecture review, privacy and interaction analysis, test planning, and competition-demo preparation. Dated implementation decisions and validation results are recorded in [`docs/codex-progress.md`](docs/codex-progress.md). GPT-5.6 is not built into the web application; compatible AI clients can instead connect through the project's user-controlled, read-only MCP.

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Leaflet + React Leaflet + MapLibre GL JS
- Motion for small UI transitions
- Supabase Auth, Postgres, Row Level Security, and private Storage
- Supabase Edge Functions for invite registration, the Memory API, MCP token management, cloud MCP, account deletion, and scheduled media retention
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

- Supabase Auth owns passwords and sessions; normalized Postgres tables store stars, notes, routes, settings, privacy consent, and bounded seven-day history under user-scoped RLS.
- Each cloud edit is an entity mutation guarded by `dataset_revision`. An IndexedDB outbox preserves queued and in-flight work across crashes, retries, and temporary network loss without storing the complete archive in localStorage.
- `life-media` is a private Storage bucket. Rows keep paths and metadata rather than public URLs, and signed display URLs remain temporary.
- Rich note HTML is sanitized before storage and after loading. The page and stored image elements use a no-referrer policy; legacy HTTP(S) images remain readable for compatibility and should be migrated to private Storage rather than silently removed.
- Deleting a note, star, or route is reversible for seven days. Supabase Cron and the authenticated `media-retention` Function recheck references before physically removing expired rows, history, and private files.
- A same-origin service worker caches only the public app shell. Supabase responses, private media, map tiles, and memory records are excluded.
- Readable HTML export omits password fields and internal app state. Account deletion re-verifies the password, clears the user's Storage folder, Auth user, sessions, MCP token, and cascaded database rows.
- The privacy notice explains Supabase hosting, administrator access, retention, recovery limits, export, and deletion. The service is not end-to-end encrypted.

The complete schema, migration, backup, Cron, recovery, and verification runbook is in [`docs/backend-setup.md`](docs/backend-setup.md).

## Memory API And MCP Reference

My Life Memory provides a focused, read-only MCP tool server over local stdio and cloud Streamable HTTP. It is designed for personal memory research rather than as a general-purpose MCP platform; the cloud transport uses a user-generated bearer token and does not claim MCP OAuth discovery or every optional MCP capability.

My Life Memory exposes a user-scoped Memory API through the Supabase Edge Function `memory-api`. The API reads `memory_stars`, `memory_notes`, and `memory_tracks` with explicit user scoping and pagination; action-specific loads avoid unrelated tables and push date ranges into database queries. Range summaries use the service-only `summarize_normalized_memory_range` aggregate. The API does not read or rewrite `app_states`. Service-role credentials never reach the frontend or MCP clients.

The public MCP interface exposes exactly nine read-only tools:

- `research_memory_context`
- `get_memory_images`
- `search_memories`
- `list_locations`
- `get_location_memory`
- `get_day_memory`
- `get_routes`
- `summarize_memory_range`
- `export_memory_report`

Eight text-oriented tools call same-named Memory API read actions. The public MCP tool `get_memory_images` instead uses the internal authenticated `get_note_media` action to validate image references before returning standard MCP image content. `get_note_media` is not a public MCP tool.

`research_memory_context` is the preferred action for natural-language questions. It builds a structured query plan, applies explicit public-place and date constraints, resolves user-relative anchors only from first-person evidence in the authenticated archive, and then matches requested events, targets, or nearby routes. Ambiguous anchors are not chosen by recency, and the latest saved memory is never presented as the user's current location. Confidence bands are heuristic retrieval labels rather than calibrated probabilities.

Every research response uses one strict state: `supported`, `ambiguous`, `not-found`, or `candidate-review`. Only `supported` can contain evidence passages, records, coordinates, routes, or image note IDs. Every other state physically omits those answer paths and supplies an exact directive that the client must relay or follow without adding guesses. Fuzzy candidates are ranked only inside the authenticated service. When clarification is useful, the public response may identify an option with a privacy-screened short title, explicit name, generic soft cue, or ordinal fallback plus a short-lived opaque token; it never exposes note bodies, dates, coordinates, scores, routes, images, or internal IDs. The encrypted token restores the original question when the user replies with a short confirmation. Only deterministic stored evidence or the user's explicit confirmation can authorize a supported answer. Host-model vocabulary hints may rank candidates but can never promote them into evidence.

My Life Memory contains no model runtime, calls no model API, needs no model key, and creates no model-inference bill. `search_memories` keeps exact substring search for compatibility, but an empty literal result is automatically retried through the same evidence-grounded research flow so less capable clients do not stop at a missing phrase.

For visual questions, MCP uses a deliberate second step instead of downloading the user's whole gallery. After research returns relevant note IDs, a vision-capable client can call `get_memory_images`; the server revalidates active note references and the authenticated user's private `life-media/<userId>/` paths, then returns a small bounded set of standard MCP image blocks without exposing signed URLs. Clients without image support can ignore this tool and use the same text results and image metadata. If no image block is returned, the model is explicitly instructed not to claim it has seen the photo.

Country scope is resolved offline from a generated Natural Earth catalogue. Smaller named places use a replaceable server-side Nominatim lookup with a one-request-per-second limiter and warm-instance cache. Only the explicit geographic name in the MCP `place` argument is sent for lookup; full user questions, note text, private coordinates, and account data are not sent. The endpoint can be changed without a client update through `MEMORY_GEOCODER_URL`, and `MEMORY_GEOCODER_USER_AGENT` can identify a self-hosted deployment. Moderate deployments may use the default public endpoint under its usage policy; larger deployments should configure a self-hosted or contracted compatible service.

The codebase contains these write/delete actions for future controlled integrations:

- `create_star`
- `update_star`
- `add_note_to_star`
- `update_note`
- `delete_note`
- `delete_star`
- `delete_route`

In production, write/delete actions are disabled by default. They are accepted only when the Edge Function secret `ENABLE_MEMORY_API_WRITES=true` is set. Even then, write actions require `confirmWrite: true`, delete actions additionally require `confirm: "DELETE"`, and all writes go through the same user-scoped `apply_memory_mutations` RPC. API deletes are soft deletes; Storage cleanup is deferred to protected-reference maintenance.

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

Both transports derive all nine tool names, descriptions, annotations, and input schemas from one shared manifest. The cloud endpoint implements MCP `2025-03-26`: it negotiates unsupported initialization versions instead of blindly echoing them, rejects `initialize` inside a batch, and accepts notification-only messages with HTTP `202` and no response body. Native clients may omit `Origin` or send `Origin: null`; any concrete browser Origin must match `ALLOWED_ORIGINS`. Every request still requires the user's bearer token.

Users generate their own MCP token inside the app:

1. Log in to My Life Memory.
2. Open Settings.
3. Open AI memory access.
4. Generate an MCP token and copy it immediately.

Phone clients should choose Streamable HTTP, set the URL to the cloud function URL, and set the authorization header to `Bearer <generated-user-mcp-token>`. The full token is shown only once. Each user can have only one active MCP token; generating a new one replaces the old row, and revoking deletes it. Supabase stores only a SHA-256 hash in `public.mcp_tokens`, so each token maps to exactly one user and cannot read another account's data. The phone never receives the Supabase URL, publishable key, service role key, or app password.

MCP exposes only read-only tools. This keeps AI clients useful for retrieval and analysis without letting them create, edit, or delete the user's private memories. Image blocks are delivered only to the authenticated MCP client after user-scoped reference checks, so users should connect only AI clients they trust with the selected private photos.

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

## Backend Setup

The complete production runbook is maintained in [`docs/backend-setup.md`](docs/backend-setup.md). It covers the normalized v2 migration and checksum gate, Edge Function deployment, Vault and Supabase Cron configuration, media retention, RLS verification, backup, rollback, and same-account recovery.

Do not deploy the normalized frontend against a v1 database, skip a migration, or run `supabase db push` as a substitute for the documented release order. For an existing production project, inspect the migration ledger and verification queries before running any SQL again.

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
   Backend releases use the official Supabase GitHub Integration connected only to this repository. The repository root is the Supabase working directory and `main` is the production branch, so committed migrations and Edge Functions deploy without storing an account-wide Supabase access token in GitHub Actions. Protect `main`, review backend changes before merging, and keep the GitHub App installation limited to this repository.
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

### Production backup policy

Database backups and Storage backups are separate. Supabase database backups do not contain the private `life-media` objects, so a production recovery plan must cover both sources.

- Before opening registration beyond invited testers, choose either a Supabase plan with managed database backups or an encrypted off-site `supabase db dump` schedule.
- Export `life-media` independently with a service-role process running only in a trusted operator environment. Preserve object paths so normalized image metadata remains restorable.
- Never commit a dump, Storage export, database URL, service-role key, or backup passphrase. Do not upload an unencrypted user-data backup as an artifact of this public repository.
- Test a restore into a separate Supabase project before describing the backup as usable. Record the last successful database backup, Storage backup, and restore drill outside the repository.

## Security Notes

- Do not commit `.env.local`, service role keys, database passwords, or raw SQL connection strings.
- The frontend must use only the Supabase publishable/anon key.
- `service_role` belongs only in trusted Edge Function/server environments and must never be included in the frontend.
- Registration is gated by the Supabase Edge Function `register-with-invite`; existing accounts log in normally and do not need an invite code.
- Registration requires two matching passwords of at least eight characters and explicit acceptance of the current privacy notice. A unique account claim serializes concurrent requests before Auth creation. An existing incomplete Auth user must prove the original password and is never taken over by an administrator password reset.
- Registration rollback can delete only an Auth user created by that exact request nonce while it is still marked pending. It rechecks profile, settings, and privacy consent first, so a completed concurrent registration cannot be removed.
- Account deletion is performed only by the authenticated `delete-account` Edge Function after current-password verification. The function scopes Storage cleanup to the authenticated user UUID, scans again after Auth deletion, and relies on a live-profile Storage policy to close the last-upload race.
- Browser-facing Edge Functions reject origins outside `ALLOWED_ORIGINS`. The cloud `mcp` endpoint allows requests without an Origin header and native-client `Origin: null`, but any concrete browser Origin must be allowlisted; every request remains gated by a per-user bearer token. Rate-limit keys are SHA-256 hashed and counted atomically in Postgres, with an in-memory fallback until the migration is available.
- The `memory-api` Edge Function must authenticate a real user bearer token, or a private internal MCP call with a resolved `user_id`, before reading normalized rows. Optional writes are user-scoped entity mutations and never rewrite the legacy archive.
- Cloud MCP tokens are per-user. The app shows the full token once, stores only one active hash per user in `public.mcp_tokens`, and can delete the active token from Settings.
- The local MCP server logs in as one normal user or uses one user access token; it does not use service-role credentials.
- MCP is read-only and updates `mcp_tokens.last_used_at` after successful token authentication. Direct Memory API write/delete actions are production-disabled by default and require normal user authentication, `ENABLE_MEMORY_API_WRITES=true`, and explicit confirmation fields.
- Rich text HTML is sanitized on the client and in Memory API write paths. Stored notes allow only `p`, `br`, `span`, `u`, `figure`, and `img`, plus a small safe style/metadata allowlist.
- Note editors paste plain text by default. Pasted images go through the upload path, and external HTML is not inserted directly into contentEditable editors.
- The document-level referrer policy and both HTML sanitizers force note images to use `no-referrer`. Legacy HTTP(S) image URLs remain readable for compatibility, so operators should migrate them to private Storage; silently blocking them would remove user-visible content and requires a separate migration UX.
- Statistics iframe previews run without `allow-same-origin` in the sandbox. Future production work should localize external D3/topojson/world-atlas assets.
- The invite code must live only in Supabase Function Secrets as `INVITE_CODE`.
- After deployment, disable public Supabase Email signup so registration cannot bypass the Edge Function.
- RLS ensures users can read only their own profile, normalized rows, and history. Authenticated writes use the user-scoped mutation RPC; normal clients cannot access the v1 `app_states` archive at all. Storage policies continue to scope media objects to the authenticated user's UUID folder.
- Private images are rendered with short-lived signed URLs; signed URLs are not stored in normalized metadata.
- Mutation sanitization strips password-like fields before cloud save. Production builds do not allow local account/password fallback when Supabase is not configured.
- Supabase Auth passwords cannot be viewed by the app. The app supports changing passwords, not revealing saved passwords.
- Synthetic account emails cannot receive Supabase reset mail. A secure self-service recovery-code flow is not implemented yet; do not add security questions or an administrator password-reset shortcut as a substitute.
- Explicit media deletion is user scoped by the authenticated user UUID folder, for example `authUserId/notes/noteId/imageId.jpg`. Previously referenced media enters a seven-day database queue. Owner-only Supabase Cron jobs release expired normalized rows and invoke the separately authenticated `media-retention` Edge Function, which rechecks references before deleting Storage objects. The Function URL and bearer secret are read from encrypted Supabase Vault entries; client maintenance and the manual GitHub workflow remain fallbacks, not the only cleanup executors.
- Legacy data URL images are kept only as compatibility fallback and are automatically migrated to private Storage after login or network recovery.
- If GitHub Pages is used as a live demo, configure Supabase environment variables in GitHub Actions secrets before building.

## Useful Scripts

```sh
npm run dev
npm run mcp:memory
npm run typecheck
npm run lint
npm run lint:edge
npm test
npm run test:e2e
npm run build
```

## License

My Life Memory source code is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Third-party map data, imagery, hosted services, fonts, and dependencies are not relicensed by Apache 2.0. See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
