-- Atomically save profile metadata and app state behind one revision check.
-- Safe to run more than once.

create or replace function public.save_app_snapshot(
  p_expected_revision bigint,
  p_state jsonb,
  p_name text,
  p_avatar_url text
)
returns table(saved boolean, revision bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.app_states
  set
    state = coalesce(p_state, '{}'::jsonb),
    revision = app_states.revision + 1
  where user_id = v_user_id
    and app_states.revision = greatest(0, coalesce(p_expected_revision, 0))
  returning app_states.revision into v_revision;

  if not found then
    select app_states.revision
    into v_revision
    from public.app_states
    where user_id = v_user_id;

    return query select false, coalesce(v_revision, 0);
    return;
  end if;

  update public.profiles
  set
    name = coalesce(p_name, ''),
    avatar_url = coalesce(p_avatar_url, '')
  where id = v_user_id;

  if not found then
    raise exception 'Profile row is missing' using errcode = 'P0002';
  end if;

  return query select true, v_revision;
end;
$$;

revoke all on function public.save_app_snapshot(bigint, jsonb, text, text) from public, anon;
grant execute on function public.save_app_snapshot(bigint, jsonb, text, text) to authenticated;

create or replace function public.load_app_snapshot()
returns table(
  account_id text,
  name text,
  avatar_url text,
  state jsonb,
  revision bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    profiles.account_id,
    profiles.name,
    profiles.avatar_url,
    app_states.state,
    app_states.revision
  from public.profiles
  left join public.app_states on app_states.user_id = profiles.id
  where profiles.id = auth.uid()
  limit 1;
$$;

revoke all on function public.load_app_snapshot() from public, anon;
grant execute on function public.load_app_snapshot() to authenticated;
