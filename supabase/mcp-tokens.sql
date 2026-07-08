create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  name text not null default 'My Life Memory MCP',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_id_created_at_idx
  on public.mcp_tokens (user_id, created_at desc);

create index if not exists mcp_tokens_active_hash_idx
  on public.mcp_tokens (token_hash)
  where revoked_at is null;

alter table public.mcp_tokens enable row level security;

revoke all on public.mcp_tokens from anon, authenticated;
grant select, insert, update, delete on public.mcp_tokens to service_role;
