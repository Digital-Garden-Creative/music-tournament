-- Public bucket for ripped MP3s. The rip worker (service role) writes here; clients read.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;

-- Anyone can read audio files (URLs are unguessable submission ids); only the service
-- role (used by the local rip worker) may write, so no public write policy is needed.
create policy "public read audio"
  on storage.objects for select
  using (bucket_id = 'audio');
