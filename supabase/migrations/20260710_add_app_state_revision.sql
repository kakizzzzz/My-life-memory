-- Add optimistic-concurrency metadata for multi-device app-state saves.
-- Safe to run more than once.

alter table public.app_states
  add column if not exists revision bigint not null default 0;

alter table public.app_states
  drop constraint if exists app_states_revision_nonnegative;

alter table public.app_states
  add constraint app_states_revision_nonnegative check (revision >= 0);
