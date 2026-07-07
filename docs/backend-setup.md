# Backend Setup

This app can run in two modes:

- Without Supabase env vars: local-only fallback using browser storage.
- With Supabase env vars: Supabase Auth + private per-user cloud sync.

## Supabase Steps

1. Create a Supabase project.
2. In Authentication settings, disable email confirmation for the current ID-only login flow.
3. Open SQL Editor and run `supabase/schema.sql`.
4. Copy `.env.example` to `.env.local`.
5. Fill:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

6. Restart the dev server.

## Data Model

- Supabase Auth stores the password and session.
- `profiles.account_id` is unique, so duplicate app IDs cannot be created.
- `app_states.state` stores the user's private app state.
- Row Level Security is enabled so users can only read/write their own rows.

## Current Limit

Images are still stored inside the app state as data URLs. This works for small testing, but the next backend step should move avatars and note images into a private Supabase Storage bucket.
