create table if not exists public.edge_rate_limits (
  key_hash text primary key,
  request_count integer not null default 0 check (request_count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.edge_rate_limits enable row level security;
create index if not exists edge_rate_limits_updated_at_idx on public.edge_rate_limits (updated_at);
revoke all on public.edge_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.edge_rate_limits to service_role;

create or replace function public.consume_edge_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(limited boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.edge_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
  safe_window integer := greatest(1, p_window_seconds);
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or p_limit < 1 then
    raise exception 'Invalid rate limit input';
  end if;

  insert into public.edge_rate_limits (key_hash, request_count, reset_at, updated_at)
  values (p_key_hash, 1, current_time + make_interval(secs => safe_window), current_time)
  on conflict (key_hash) do update
  set request_count = case
        when edge_rate_limits.reset_at <= current_time then 1
        else edge_rate_limits.request_count + 1
      end,
      reset_at = case
        when edge_rate_limits.reset_at <= current_time then current_time + make_interval(secs => safe_window)
        else edge_rate_limits.reset_at
      end,
      updated_at = current_time
  returning * into current_row;

  delete from public.edge_rate_limits
  where updated_at < current_time - interval '2 days';

  return query select
    current_row.request_count > p_limit,
    greatest(1, ceil(extract(epoch from (current_row.reset_at - current_time)))::integer);
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;
