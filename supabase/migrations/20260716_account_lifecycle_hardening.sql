-- Prevent a deleted account's still-unexpired access token from creating new
-- private media after the Auth user and profile have been removed.
begin;

drop policy if exists "Users can insert own life media" on storage.objects;
create policy "Users can insert own life media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "Users can update own life media" on storage.objects;
create policy "Users can update own life media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
)
with check (
  bucket_id = 'life-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
  )
);

commit;
