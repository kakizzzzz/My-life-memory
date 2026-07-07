# Backend Setup

My Life Memory can run in two modes:

- Without Supabase env vars: local-only fallback using browser storage.
- With Supabase env vars: Supabase Auth, per-user app state sync, and private Storage images.

## Supabase Steps

1. Create a Supabase project.
2. In Authentication settings, disable email confirmation for the current ID-only login flow.
3. Open SQL Editor and run `supabase/schema.sql`.
   This creates:
   - `profiles`
   - `app_states`
   - private Storage bucket `life-media`
   - RLS policies for per-user rows
   - Storage policies for per-user image paths
4. Copy `.env.example` to `.env.local`.
5. Fill:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

6. Restart the dev server.

## Storage Rules

The app uploads avatars and note images to the private `life-media` bucket. Object paths always start with the authenticated user ID:

```text
authUserId/avatars/profile/imageId.jpg
authUserId/notes/noteId/imageId.jpg
```

The app state stores only image metadata:

```json
{
  "provider": "supabase",
  "bucket": "life-media",
  "path": "authUserId/notes/noteId/imageId.jpg",
  "mimeType": "image/jpeg",
  "size": 102400,
  "createdAt": 1783430000000
}
```

Private images render through short-lived Supabase signed URLs. Signed URLs are cached in memory and are not saved to `app_states.state`.

## Verification

Run `supabase/verify-cloud-backend.sql` in SQL Editor to inspect:

- tables
- grants
- RLS policies
- `life-media` bucket
- Storage object policies
- legacy password leakage in `app_states`

If the app says cloud setup is blocked, run `supabase/fix-permissions.sql` once, then run the verification SQL again.

## Security Checklist

- Never commit `.env.local`.
- Never put `service_role`, `DATABASE_URL`, or database password in frontend code.
- The frontend should use only the Supabase publishable/anon key.
- Keep `life-media` private.
- Keep Storage object policies scoped to `auth.uid()` path prefixes.
- Do not store image data URLs in cloud state except as a temporary legacy fallback.
