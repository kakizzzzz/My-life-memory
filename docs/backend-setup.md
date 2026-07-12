# Backend Setup

Production My Life Memory requires Supabase. A local account/password fallback exists only in Vite development mode; a production build with missing Supabase configuration must stop with a setup error instead of storing a password in browser storage.

## Data Model

- Supabase Auth owns passwords and sessions.
- `profiles` stores the public account profile row.
- `memory_settings` stores map/theme/language settings and the account-wide `dataset_revision`.
- `memory_stars`, `memory_notes`, and `memory_tracks` store ordered entities independently.
- `memory_entity_history` stores pre-update or pre-delete versions for at most seven days, capped at the latest 20 versions per entity.
- `app_states` is the immutable v1 operator archive after a verified migration. Authenticated clients have no direct access, and normal v2 reads and writes never use it.
- `life-media` is a private Storage bucket. Database rows contain paths and metadata, not public URLs.

Authenticated clients have SELECT-only access to their own normalized rows through RLS. All profile and memory writes go through `apply_memory_mutations(expected_revision, mutations)`, which derives the user from `auth.uid()`, locks the user's revision row, validates the whole batch, writes history, and increments the dataset revision once.

## Initial Supabase Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in SQL Editor.
3. Run migrations in filename order through `20260713_normalized_memory_storage_v2.sql`.
4. Immediately after that migration, run `supabase/verify-normalized-memory.sql`. Do this before users begin normal v2 editing, because it compares the normalized rows with the unchanged v1 archive.
5. After verification succeeds, run `20260714_memory_trash_retention.sql`.
6. Run `supabase/verify-cloud-backend.sql` and confirm:
   - every normalized table exists and has RLS enabled;
   - authenticated table privileges are SELECT only;
   - `app_states` has no authenticated privilege, while `profiles` has no direct authenticated write grant;
   - required RPCs exist;
   - the `life-media` bucket and user-folder Storage policies exist.
7. Deploy `register-with-invite`, `memory-api`, `mcp-token`, and `mcp` from the same release commit.
8. Disable public Email signup after invite registration is deployed.

Never deploy the v2 frontend before the v2 migration and checksum verification succeed. The exact maintenance-window, backup, verification, rollback, and recovery order is in the README under **Normalized v2 production checklist**.

## Environment And Secrets

Frontend `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Edge Function secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
INVITE_CODE
MEMORY_API_INTERNAL_TOKEN
ALLOWED_ORIGINS
```

Keep `ENABLE_MEMORY_API_WRITES` unset in production unless write/delete API actions are being intentionally tested. Never put an invite code, service-role key, database URL/password, real user session, or MCP token in frontend environment variables, source files, documentation examples, screenshots, or exports.

## Memory API

`memory-api` authenticates either a normal Supabase user bearer token or the private MCP-to-API internal token. A user-token request resolves the user from Supabase Auth; an internal request receives the user UUID only from the already authenticated MCP token mapping.

Read actions:

- `search_memories`
- `list_locations`
- `get_location_memory`
- `get_day_memory`
- `get_routes`
- `summarize_memory_range`
- `export_memory_report`

The API queries normalized tables with explicit user filters and pagination. Action-specific reads skip unrelated tables, date ranges are pushed into database queries, and `summarize_memory_range` uses the service-only SQL aggregate `summarize_normalized_memory_range`. Route date filtering uses `created_at_ms`; `duration_seconds` is never treated as a timestamp.

Write actions are disabled unless `ENABLE_MEMORY_API_WRITES=true`. When enabled they still require `confirmWrite: true`; deletes additionally require `confirm: "DELETE"`. Every write becomes a target-entity mutation and uses the same optimistic revision RPC. Deletes are soft deletes and do not immediately remove Storage objects.

## MCP

Both local and cloud MCP expose read-only memory tools. They cannot create, edit, or delete memories.

Local stdio server:

```bash
npm run mcp:memory
```

Typical desktop configuration:

```json
{
  "mcpServers": {
    "my-life-memory": {
      "command": "node",
      "args": ["/absolute/path/to/map-app/mcp/my-life-memory.mjs"],
      "env": {
        "MLM_SUPABASE_URL": "https://your-project-ref.supabase.co",
        "MLM_SUPABASE_ANON_KEY": "your-publishable-or-anon-key",
        "MLM_ACCOUNT": "your-account-id",
        "MLM_PASSWORD": "your-password"
      }
    }
  }
}
```

Use `MLM_SUPABASE_ACCESS_TOKEN` instead of account/password only when a trusted local client already manages a normal user session. Never use a service-role key.

Cloud/mobile MCP:

- Transport: Streamable HTTP
- URL: `https://your-project-ref.supabase.co/functions/v1/mcp`
- Header: `Authorization: Bearer <user-mcp-token-generated-in-the-app>`

The full user MCP token is shown once. Supabase stores only one active SHA-256 token hash per user; generating a replacement invalidates the old token. The MCP function resolves that hash to one `user_id`, then calls the Memory API with `MEMORY_API_INTERNAL_TOKEN`. GitHub Pages is static hosting and cannot serve this MCP endpoint.

## Media

Storage object paths are generated under the authenticated UUID:

```text
authUserId/avatars/profile/imageId.jpg
authUserId/notes/noteId/imageId.jpg
```

Stored metadata contains `provider`, `bucket`, `path`/`key`, MIME type, size, and creation time. Private images render with short-lived signed URLs that are kept only in memory.

Soft-deleted rows, conflict copies, retained entity history, the local entity outbox, and unresolved legacy pending snapshots protect their referenced media. The outbox also persists the exact in-flight mutation batch before network I/O so a lost response can be reconciled after restart. Once per account per day, and only after conflict-free cloud sync, `purge_expired_memory_trash()` physically removes that user's soft-deleted entities and history older than seven days. The client then reloads protected paths before applying the seven-day deletion queue and orphan-file grace period. Cleanup scans only the current user's folder and must never use `app_states` as the live reference source.

## Recovery

`supabase/recover-normalized-memory-for-user.sql` is an operator-only same-account template. It cannot import between accounts. Before using it, stop writes and sign out all devices for the target account. It preserves the current normalized rows in history, rebuilds from that same user's untouched archive, and deliberately leaves the account unverified. Rerun the full migration checksum gate and verification before allowing the account to resume.

## Verification Commands

```bash
npm ci
npm run lint
npm run lint:edge
npm test
npm run build
```

The test suite executes the migration against a local PostgreSQL-compatible PGlite database, reruns it for idempotency, verifies checksums, tests RLS isolation and atomic mutations, confirms the archive remains unchanged, and proves a malformed migration rolls back.
