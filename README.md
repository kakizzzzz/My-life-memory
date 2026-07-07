# My Life Memory

My Life Memory is a private life-map app for saving places, notes, photos, routes, coordinates, and travel statistics in one personal memory space.

## Screenshots

Screenshots are kept in `docs/screenshots/` after local or Pages preview capture.

| Login | Map | Records |
| --- | --- | --- |
| ![Login screen](docs/screenshots/login.svg) | ![Map screen](docs/screenshots/map.svg) | ![Records screen](docs/screenshots/records.svg) |

## Features

- Place, tap, and drag stars on the map for meaningful locations.
- Write rich notes with text color, font size, underline, photos, and camera capture.
- Browse records by timeline, search, filters, and calendar.
- Track walking routes and view trip statistics.
- Copy coordinates and open saved places in map apps.
- Sync per-user data with Supabase Auth, RLS-protected tables, and private Storage.

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Leaflet + React Leaflet
- Motion for small UI transitions
- Supabase Auth, Postgres, Row Level Security, and private Storage
- GitHub Pages for static hosting

## Data And Storage

- Supabase Auth stores passwords and sessions.
- `profiles` stores account ID, nickname, and avatar path metadata.
- `app_states` stores stars, notes, routes, settings, and image metadata.
- `life-media` is a private Supabase Storage bucket for avatar and note image files.
- The frontend stores only Storage metadata in app state: `provider`, `bucket`, `path`, `mimeType`, `size`, and `createdAt`.
- Legacy compressed data URL images still render as fallback, but new uploads use Storage when Supabase is configured.

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
2. In Authentication settings, disable email confirmation for the current ID/password flow.
3. Open SQL Editor and run `supabase/schema.sql`.
4. Confirm these objects exist:
   - `public.profiles`
   - `public.app_states`
   - private Storage bucket `life-media`
   - RLS policies for both tables and `storage.objects`
5. If permissions look wrong, run `supabase/verify-cloud-backend.sql` to inspect the project.
6. If table grants are missing, run `supabase/fix-permissions.sql`.

Storage paths are user scoped:

```text
authUserId/notes/noteId/imageId.jpg
authUserId/avatars/profile/imageId.jpg
```

## Deployment

For GitHub Pages:

1. Add production Supabase env vars to the build environment.
2. Run:

   ```sh
   npm run build
   ```

3. Publish `dist/` to the Pages branch or use `.github/workflows/deploy-pages.yml`.
4. After deploy, open the Pages URL and test:
   - register and log in
   - upload an avatar
   - add a note image
   - reload on another device/browser
   - delete the image and confirm it disappears

## Security Notes

- Do not commit `.env.local`, service role keys, database passwords, or raw SQL connection strings.
- The frontend must use only the Supabase publishable/anon key.
- `service_role` belongs only in trusted server environments and is not needed for this app.
- RLS ensures users can read/write only their own profile, app state, and Storage objects.
- Private images are rendered with short-lived signed URLs; signed URLs are not stored in app state.
- App state sanitization strips password-like fields before cloud save.

## Useful Scripts

```sh
npm run dev
npm run lint
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
