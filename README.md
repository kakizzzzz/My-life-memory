# My Life Memory

My Life Memory is a private life-map app for saving places, notes, photos, routes, coordinates, and travel statistics in one personal memory space.

## Features

- Place and drag stars on the map for meaningful locations.
- Write rich notes with text, colors, font sizes, and images.
- Browse records by timeline, search, filters, and calendar.
- Track walking routes and view trip statistics.
- Sync per-user data with Supabase Auth, RLS-protected profiles, and app state.

## Backend Notes

- Passwords are handled by Supabase Auth only.
- App state is saved per authenticated user through Row Level Security.
- `supabase/schema.sql` includes the private `life-media` Storage bucket and policies for the next image-storage migration.
- Current image data may still appear as compressed data URLs until the frontend Storage migration is completed.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the environment template:

   ```sh
   cp .env.example .env.local
   ```

3. Fill Supabase values in `.env.local`.

4. Start the dev server:

   ```sh
   npm run dev
   ```

5. Open:

   [http://localhost:3000/](http://localhost:3000/)
