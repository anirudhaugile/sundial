-- Upserts need a real unique constraint (not a partial index) to target.
-- NULLs stay distinct, so manual events (null external_uid) never collide.
drop index if exists public.events_natural_key;
alter table public.events
  add constraint events_natural_key unique (user_id, source, external_uid, instance_start);

-- sync writes happen server-side with the service role; users only read their runs
create index sync_runs_recent on public.sync_runs (connection_id, started_at desc);
