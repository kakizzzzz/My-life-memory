# Backend Setup

This app can run in two modes:

- Without Supabase env vars: local-only fallback using browser storage.
- With Supabase env vars: Supabase Auth + private per-user cloud sync.

## Supabase Steps

1. Create a Supabase project.
2. In Authentication settings, disable email confirmation for the current ID-only login flow.
3. Open SQL Editor and run `supabase/schema.sql`.
4. If you get a permission/setup error, check the debug details in the app login card (code / status / postgres message) first; then run these grants once if needed:

```sql
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.app_states to authenticated;
```

If the error still shows after grants, open a real row in your app (not production cache) and check debug info:

1. Open the login page in Dev mode.
2. Use the same account/password that fails.
3. In the red error area, expand the technical debug block and confirm both:
   - `details.clientProjectRef` matches your configured `VITE_SUPABASE_URL` project ref.
   - `details.tokenRef` matches the same project ref.

If they differ, you are likely pointing to the wrong Supabase project URL/key pair.

You can also run `supabase/verify-cloud-backend.sql` in SQL Editor after sign-in flow to inspect permissions/policies by project.

5. Copy `.env.example` to `.env.local`.
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
