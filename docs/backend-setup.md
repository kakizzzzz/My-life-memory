# Backend Setup

Production My Life Memory requires Supabase. A local account/password fallback exists only in Vite development mode; a production build with missing Supabase configuration must stop with a setup error instead of storing a password in browser storage.

This file is the authoritative deployment and recovery runbook. Do not replace the ordered migration process with `supabase db push`, and do not rerun production migrations merely because they are listed here. Inspect the target project's migration ledger and verification output first.

## Data Model

- Supabase Auth owns passwords and sessions.
- `profiles` stores the account profile row.
- `memory_settings` stores map/theme/language settings, profile conflict metadata, and the account-wide `dataset_revision`.
- `memory_stars`, `memory_notes`, and `memory_tracks` store ordered entities independently.
- `memory_entity_history` stores pre-update and pre-delete versions for at most seven days, capped at the latest 20 versions per entity.
- `memory_registration_claims` serializes account creation.
- `memory_privacy_consents` stores the accepted notice version and server timestamp.
- `memory_media_deletion_queue` stores server-owned deferred Storage deletions.
- `app_states` is the immutable v1 operator archive after a verified migration. Authenticated clients have no direct access, and normal v2 reads and writes never use it.
- `life-media` is a private Storage bucket. Database rows contain paths and metadata, not public URLs.

Authenticated clients have SELECT-only access to their own normalized rows through RLS. Profile and memory writes use `apply_memory_mutations(expected_revision, mutations)`, which derives the user from `auth.uid()`, locks the user's revision row, validates the batch, writes history, and increments the dataset revision once.

## Environment And Secrets

Frontend `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Edge Function secrets:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
INVITE_CODE
MEMORY_API_INTERNAL_TOKEN
MEDIA_RETENTION_CRON_SECRET
ALLOWED_ORIGINS
```

Optional Memory API settings:

```text
MEMORY_GEOCODER_URL
MEMORY_GEOCODER_USER_AGENT
ENABLE_MEMORY_API_WRITES
```

Keep `ENABLE_MEMORY_API_WRITES` unset in production. Never place an invite code, service-role key, database password, real user session, MCP token, or retention secret in frontend variables, source files, documentation examples, screenshots, or exports.

## Production Installation Order

### 1. Prepare The Release

1. Put the app in a maintenance window and stop old clients from writing.
2. Create a database backup and separately export `public.app_states` with `user_id`, `state`, and `revision`.
3. Record the deployed frontend and Edge Function commit SHA.
4. Run the release checks from that exact commit:

   ```bash
   npm ci
   npm run typecheck
   npm run lint:edge
   npm test
   npm run test:e2e
   npm run build
   ```

5. Confirm the release contains `supabase/schema.sql`, every migration through `20260722_allow_no_referrer_note_images.sql`, both verification scripts, and the same-account recovery template.

### 2. Create Or Upgrade The Database

For a new project, run `supabase/schema.sql` first. For an existing project, run only migrations not already present in its migration ledger, in filename order.

1. Run migrations through `20260713_normalized_memory_storage_v2.sql`.
2. Immediately run `supabase/verify-normalized-memory.sql` before normal v2 editing begins. Every migrated legacy account must report matching counts, IDs, order, content checksums, and a non-null `migration_verified_at`.
3. Run:
   - `20260714_memory_trash_retention.sql`
   - `20260715_registration_integrity.sql`
   - `20260716_account_lifecycle_hardening.sql`
   - `20260717_server_retention_and_archive_redaction.sql`
   - `20260718_server_media_deletion_queue.sql`
   - `20260719_harden_media_deletion_enqueue.sql`
4. Do not run the Cron scheduling migrations until the Function and Vault prerequisites below exist.

`20260713_normalized_memory_storage_v2.sql` is transactional and idempotent. It preserves original IDs and ordering, validates stable checksums, and rolls the transaction back on a structural or content mismatch. New registrations create normalized profile, settings, and default-star rows without a new app-state snapshot.

### 3. Deploy Edge Functions

Deploy these Functions from the same release commit:

- `register-with-invite`
- `delete-account`
- `memory-api`
- `mcp-token`
- `mcp`
- `media-retention`

Confirm `media-retention` is reachable before scheduling it. After invite registration works, disable public Email signup so the anon key cannot bypass the invite flow.

### 4. Configure Media Retention

1. Generate one random retention secret of at least 32 bytes.
2. Store it as the Edge Function secret `MEDIA_RETENTION_CRON_SECRET`.
3. Store the same value in Supabase Vault as `my_life_memory_media_retention_secret`.
4. Store the exact project URL in Vault as `my_life_memory_project_url`.
5. Run `20260720_schedule_media_retention_with_supabase_cron.sql`.
6. Run `20260721_require_media_retention_prerequisites.sql`.
7. Run `20260722_allow_no_referrer_note_images.sql` to align the database rich-HTML validator with the browser and Edge sanitizers.

The `20260721` migration removes the existing named job, requires exactly one valid value for each Vault secret, and recreates the daily job only after validation succeeds. If validation fails, repair the Function or Vault configuration and rerun only `20260721`; it must not leave an unusable scheduled job behind. The following `20260722` migration changes only the note HTML validation function. It accepts the exact `referrerpolicy="no-referrer"` attribute generated by the application and continues to reject every other referrer-policy value.

Keep `.github/workflows/media-retention.yml` as a manual `workflow_dispatch` fallback only. Daily cleanup belongs to Supabase Cron and must not depend on GitHub scheduled-workflow activity.

### 5. Verify The Backend

Run the read-only `supabase/verify-cloud-backend.sql`. Confirm it reports all required objects, including:

- `profiles`, read-only `app_states`, `mcp_tokens`, and `edge_rate_limits`
- `memory_settings`, `memory_stars`, `memory_notes`, `memory_tracks`, and `memory_entity_history`
- `memory_registration_claims`, `memory_privacy_consents`, and `memory_media_deletion_queue`
- registration RPCs `claim_memory_registration`, `bind_memory_registration_claim`, `release_memory_registration_claim`, and `initialize_claimed_memory_account`
- data RPCs `apply_memory_mutations`, `list_protected_memory_media_paths`, `purge_expired_memory_trash`, `purge_expired_memory_trash_all_users`, `summarize_normalized_memory_range`, `run_server_memory_retention`, `claim_due_memory_media_deletions`, and `memory_media_path_is_protected`
- private Cron bridge `invoke_memory_media_retention`
- private bucket `life-media`
- RLS enabled for normalized tables, own-user SELECT policies, no authenticated direct writes, and no authenticated access to `app_states`

Verify `cron.job` contains:

- `my-life-memory-expired-trash-daily`
- `my-life-memory-media-retention-daily`

Confirm the two Vault secret names exist without printing their values. Manually run:

```sql
select public.invoke_memory_media_retention();
```

Inspect the matching `net._http_response` row and require HTTP `200`. Disable the job until the Function, Vault, and network configuration are corrected if this call fails.

Only after normalized v2 exists may `supabase/fix-permissions.sql` be used to restore expected v2 grants. Never use an older permissions script that grants legacy `app_states` access.

### 6. Deploy And Smoke-Test The Frontend

Deploy the v2 frontend only after database verification succeeds. Test:

1. registration, login, session restoration, logout, and account isolation;
2. map style, theme, language, stars, note order, private images, route dates, and route recording;
3. one-note editing, confirming only the intended entity/history rows and one dataset revision change;
4. two-device disjoint edits, same-entity conflicts, and delete-versus-edit behavior;
5. offline editing, browser termination, outbox recovery, and retry;
6. soft deletion and seven-day retention without immediate Storage removal;
7. readable export, account deletion, MCP token generation, and all nine read-only MCP tools.

Monitor Postgres, Edge Function, and client sync-error logs before ending the maintenance window.

## Memory API And MCP

`memory-api` authenticates either a normal user bearer token or the private MCP-to-API internal token. Internal calls receive a user UUID only after the cloud MCP token hash resolves to that account. Service-role credentials never reach the frontend or MCP clients.

The public MCP contract contains exactly nine read-only tools from one shared manifest. The local stdio server and cloud Streamable HTTP endpoint share tool names, descriptions, annotations, and input schemas. The cloud endpoint supports MCP `2025-03-26`, negotiates unknown requested versions, forbids `initialize` in batches, and returns HTTP `202` without a body for accepted notification-only traffic.

Concrete browser Origins must match `ALLOWED_ORIGINS`. Native clients may omit the Origin header or send `Origin: null`; every request still needs a valid per-user bearer token. Supabase stores only the SHA-256 hash of the one active MCP token for each user.

Local stdio:

```bash
npm run mcp:memory
```

Local variables:

```text
MLM_SUPABASE_URL
MLM_SUPABASE_ANON_KEY
MLM_ACCOUNT
MLM_PASSWORD
```

A trusted local client may use `MLM_SUPABASE_ACCESS_TOKEN` instead of account/password. Never use a service-role key.

Cloud/mobile configuration:

- Transport: Streamable HTTP
- URL: `https://your-project-ref.supabase.co/functions/v1/mcp`
- Header: `Authorization: Bearer <user-mcp-token-generated-in-the-app>`

The research path is evidence-first. The latest record is never treated as current location, home, work, or school. Candidate notes remain unverified and cannot become evidence through host-model judgment. Visual retrieval is a second call: the server rechecks active note ownership and private Storage paths before returning a bounded set of image blocks.

## Media And Rich HTML

Storage paths are generated under the authenticated UUID:

```text
authUserId/avatars/profile/imageId.jpg
authUserId/notes/noteId/imageId.jpg
```

Stored metadata contains provider, bucket, path/key, MIME type, size, and creation time. Signed display URLs remain in memory and are not persisted.

Soft-deleted rows and retained history protect their media for seven days. Database triggers enqueue newly unreferenced paths before physical row/history cleanup. The scheduled `media-retention` Function leases due items, rechecks all active and retained references, and deletes only safe paths. Failed removals remain queued with bounded retry backoff.

Rich HTML is sanitized in the browser and Memory API. The page-level Referrer Policy and sanitized image nodes use `no-referrer`. Legacy HTTP(S) images remain readable for compatibility; new media should use private Storage. Fully blocking legacy remote images requires a visible migration flow so user content is not silently removed.

## Backup, Rollback, And Recovery

Database backups do not contain Storage objects. A usable recovery plan must protect both Postgres and `life-media`, preserve object paths, encrypt off-site copies, and be tested in a separate project.

Keep `app_states` untouched as the immutable v1 rollback archive. A database-level rollback must restore the matching pre-v2 database and v1 application build together; never run a v2 frontend against a v1 schema.

For one damaged account only, use `supabase/recover-normalized-memory-for-user.sql`. Stop writes, sign out every device for that account, set exactly one user UUID, run the same-account recovery, then rerun the checksum gate and verification before access resumes. The script cannot import between accounts and is not exposed in the UI.

## Verification Commands

```bash
npm ci
npm run typecheck
npm run lint:edge
npm test
npm run test:e2e
npm run build
```

If global Deno is unavailable, install it or run an equivalent `npx --yes deno check` over all production Functions and record that substitution explicitly. Never report an environment-dependent command as passing when it did not run.
