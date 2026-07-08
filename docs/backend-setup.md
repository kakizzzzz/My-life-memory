# Backend Setup

My Life Memory can run in two modes:

- Without Supabase env vars: local-only fallback using browser storage.
- With Supabase env vars: Supabase Auth, per-user app state sync, and private Storage images.

## Supabase Steps

1. Create a Supabase project.
2. Deploy the Supabase Edge Functions:
   - `register-with-invite`
   - `memory-api`
3. Store the invite code only in Supabase Function Secrets as `INVITE_CODE`.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` only in the Edge Function/server environment.
5. After the invite function is deployed, disable public Email signup in Authentication settings so new accounts cannot bypass the invite flow.
6. Open SQL Editor and run `supabase/schema.sql`.
   This creates:
   - `profiles`
   - `app_states`
   - private Storage bucket `life-media`
   - RLS policies for per-user rows
   - Storage policies for per-user image paths
7. Copy `.env.example` to `.env.local`.
8. Fill:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

9. Restart the dev server.

## Memory API

`memory-api` is a Supabase Edge Function for user-scoped memory data. Clients must send a normal Supabase user session token:

```http
Authorization: Bearer <user-access-token>
```

The function validates the token, loads only that user's `profiles` and `app_states` rows, then returns organized memory data. It supports read actions for search, locations, day records, routes, range summaries, and readable report export.

Write actions exist for future integrations, but they require:

```json
{
  "confirmWrite": true
}
```

Delete actions additionally require:

```json
{
  "confirm": "DELETE"
}
```

When deleting notes or stars, the function removes referenced `life-media` Storage objects only if the path starts with the authenticated user's UUID.

## MCP Server

The local stdio MCP server lives at `mcp/my-life-memory.mjs` and calls `memory-api`.

Run it directly:

```bash
npm run mcp:memory
```

Typical MCP client configuration:

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

For read-only AI access, do not set write flags. To intentionally expose write tools on a local trusted machine:

```bash
MLM_MCP_ENABLE_WRITES=true
```

To also expose destructive delete tools:

```bash
MLM_MCP_ENABLE_WRITES=true
MLM_MCP_ENABLE_DELETES=true
```

For mobile MCP clients, deploy the cloud MCP Edge Function and use it directly:

```bash
supabase functions secrets set \
  MLM_ACCOUNT=your-account-id \
  MCP_AUTH_TOKEN=choose-a-long-random-token

supabase functions deploy mcp
```

Mobile MCP client settings:

- Transport: Streamable HTTP
- URL: `https://your-project-ref.supabase.co/functions/v1/mcp`
- Authorization: `Bearer <MCP_AUTH_TOKEN>`

GitHub Pages is a static web host and cannot serve MCP directly. The mobile MCP server address should be the Supabase Edge Function URL, not the Pages URL.

For local development or self-hosting, run the Node Streamable HTTP server from a trusted computer or server:

```bash
MLM_SUPABASE_URL=https://your-project-ref.supabase.co \
MLM_SUPABASE_ANON_KEY=your-publishable-or-anon-key \
MLM_ACCOUNT=your-account-id \
MLM_PASSWORD=your-password \
MCP_AUTH_TOKEN=choose-a-long-random-token \
PORT=3000 \
npm run mcp:http
```

Local MCP client settings:

- Transport: Streamable HTTP
- URL: `http://<server-ip>:3000/mcp` or `https://<your-domain>/mcp`
- Authorization: `Bearer <MCP_AUTH_TOKEN>`

The mobile client should not receive Supabase credentials or the app account ID. They stay in Supabase Function Secrets or server-side environment variables. The cloud MCP function does not store the app password. The installed SDK supports `StreamableHTTPServerTransport`; SSE fallback is not needed for this project version.

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
- Never put the invite code in frontend code, Vite env vars, localStorage, app state, README examples, or exported files.
- Existing accounts log in normally; only new registration goes through `register-with-invite`.
- `memory-api` requires a user bearer token and must never accept service-role credentials from clients.
- MCP should run locally with a normal user account or user access token, not a service-role key.
- MCP write/delete tools are disabled by default.
- Keep `life-media` private.
- Keep Storage object policies scoped to `auth.uid()` path prefixes.
- Do not store image data URLs in cloud state except as a temporary legacy fallback.
