-- Sundial core schema.
-- Every user-owned table carries user_id and is protected by RLS (user_id = auth.uid()).
-- Child rows reference parents with composite (id, user_id) foreign keys so a user can
-- never attach their rows to another user's parent row.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, holds scheduler preferences
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  timezone           text not null default 'America/Chicago',
  day_start          time not null default '08:00',
  day_end            time not null default '23:30',
  min_block_min      int  not null default 30  check (min_block_min between 15 and 240),
  max_block_min      int  not null default 120 check (max_block_min between 15 and 480),
  daily_work_cap_min int  not null default 360 check (daily_work_cap_min between 0 and 1440),
  due_buffer_hours   int  not null default 24  check (due_buffer_hours between 0 and 168),
  horizon_days       int  not null default 21  check (horizon_days between 7 and 60),
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  check (day_end > day_start),
  check (max_block_min >= min_block_min)
);

-- ---------------------------------------------------------------------------
-- data sources
-- ---------------------------------------------------------------------------
create table public.source_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('canvas_api', 'canvas_ical', 'outlook_ics')),
  base_url       text,                 -- Canvas domain, e.g. https://canvas.school.edu (not secret)
  secret_hint    text,                 -- last 4 chars of the token/URL, for display only
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  unique (user_id, kind),
  unique (id, user_id)
);

-- Encrypted tokens / feed URLs. RLS on with NO policies: only the service role
-- (server-side code) can read or write. The browser never receives a secret.
create table public.source_secrets (
  connection_id uuid primary key references public.source_connections (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  ciphertext    text not null,
  updated_at    timestamptz not null default now()
);

create table public.sync_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  connection_id uuid not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  inserted      int not null default 0,
  updated       int not null default 0,
  removed       int not null default 0,
  error         text,
  foreign key (connection_id, user_id) references public.source_connections (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- courses, work items, events
-- ---------------------------------------------------------------------------
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null default 'manual' check (source in ('canvas', 'manual')),
  external_id text,
  name        text not null,
  code        text,
  color       text not null default 'sage',
  created_at  timestamptz not null default now(),
  unique (user_id, source, external_id),
  unique (id, user_id)
);

create table public.work_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  source       text not null default 'manual' check (source in ('canvas', 'manual')),
  external_id  text,                   -- Canvas assignment id; null for manual items
  course_id    uuid,
  kind         text not null default 'assignment' check (kind in ('assignment', 'task')),
  title        text not null,
  description  text,
  url          text,
  points       numeric,
  due_at       timestamptz,
  planned_for  date,                   -- manual to-dos pinned to a day
  content_hash text,                   -- hash of estimate-relevant fields; drives estimate cache
  status       text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  removed_at   timestamptz,            -- disappeared from source; kept, never hard-deleted
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, source, external_id),
  unique (id, user_id),
  foreign key (course_id, user_id) references public.courses (id, user_id) on delete set null (course_id)
);
create index work_items_open_due on public.work_items (user_id, due_at) where status = 'open' and removed_at is null;

create table public.events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  source         text not null default 'manual' check (source in ('outlook', 'canvas', 'manual')),
  kind           text not null default 'event' check (kind in ('event', 'unavailable')),
  external_uid   text,                 -- iCal UID; null for manual events
  instance_start timestamptz,          -- recurrence instance key (original start)
  title          text not null,
  location       text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  all_day        boolean not null default false,
  busy           boolean not null default true,
  removed_at     timestamptz,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
-- natural key for synced events; manual events (null uid) are excluded
create unique index events_natural_key on public.events (user_id, source, external_uid, instance_start)
  where external_uid is not null;
create index events_range on public.events (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- effort estimates (LLM cache + user overrides)
-- ---------------------------------------------------------------------------
create table public.effort_estimates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  work_item_id uuid not null,
  content_hash text not null,
  origin       text not null check (origin in ('llm', 'user', 'default')),
  hours        numeric(5, 2) not null check (hours > 0 and hours <= 80),
  reasoning    text,
  model        text,
  created_at   timestamptz not null default now(),
  unique (work_item_id, origin, content_hash),
  foreign key (work_item_id, user_id) references public.work_items (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------
create table public.habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  priority     int  not null default 10,   -- lower = placed first
  min_min      int  not null check (min_min between 5 and 600),
  target_min   int  not null check (target_min between 5 and 600),
  window_start time not null,
  window_end   time not null,
  days_of_week int[] not null default '{1,2,3,4,5,6,7}',  -- ISO weekday, 1 = Monday
  start_date   date not null default current_date,
  end_date     date,
  color        text not null default 'clay',
  retired_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (target_min >= min_min),
  check (window_end > window_start),
  check (end_date is null or end_date >= start_date),
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- plans, blocks, conflicts
-- ---------------------------------------------------------------------------
create table public.plan_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'proposed' check (status in ('proposed', 'approved', 'discarded')),
  trigger       text not null default 'manual' check (trigger in ('manual', 'cron', 'chat')),
  horizon_start timestamptz not null,
  horizon_end   timestamptz not null,
  summary       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  unique (id, user_id)
);
-- at most one proposal awaiting review per user
create unique index plan_runs_one_proposed on public.plan_runs (user_id) where status = 'proposed';

create table public.blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  plan_run_id  uuid,
  kind         text not null check (kind in ('habit', 'work')),
  habit_id     uuid,
  work_item_id uuid,
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'scheduled' check (status in ('proposed', 'scheduled', 'done', 'skipped')),
  locked       boolean not null default false,  -- user-edited; the scheduler never moves it
  reasoning    text,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((kind = 'habit' and habit_id is not null) or (kind = 'work' and work_item_id is not null)),
  foreign key (plan_run_id, user_id)  references public.plan_runs (id, user_id)  on delete cascade,
  foreign key (habit_id, user_id)     references public.habits (id, user_id)     on delete cascade,
  foreign key (work_item_id, user_id) references public.work_items (id, user_id) on delete cascade
);
create index blocks_range on public.blocks (user_id, starts_at);

create table public.plan_conflicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  plan_run_id   uuid not null,
  work_item_id  uuid,
  habit_id      uuid,
  day           date,
  shortfall_min int not null default 0,
  severity      text not null default 'error' check (severity in ('warning', 'error')),
  message       text not null,
  foreign key (plan_run_id, user_id)  references public.plan_runs (id, user_id)  on delete cascade,
  foreign key (work_item_id, user_id) references public.work_items (id, user_id) on delete cascade,
  foreign key (habit_id, user_id)     references public.habits (id, user_id)     on delete cascade
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger work_items_touch before update on public.work_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- new user bootstrap: profile + default habits
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.habits (user_id, name, priority, min_min, target_min, window_start, window_end, end_date, color)
  values
    (new.id, 'Gym', 1, 30, 45, '18:00', '23:30', null, 'clay'),
    (new.id, 'Internship applications', 2, 60, 60, '18:00', '23:30', '2027-01-31', 'plum');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_demo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_demo from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.source_connections enable row level security;
alter table public.source_secrets     enable row level security;
alter table public.sync_runs          enable row level security;
alter table public.courses            enable row level security;
alter table public.work_items         enable row level security;
alter table public.events             enable row level security;
alter table public.effort_estimates   enable row level security;
alter table public.habits             enable row level security;
alter table public.plan_runs          enable row level security;
alter table public.blocks             enable row level security;
alter table public.plan_conflicts     enable row level security;

create policy "own profile read"   on public.profiles for select using (id = (select auth.uid()));
create policy "own profile update" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- users may not flip is_demo or create/delete profiles directly
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, timezone, day_start, day_end, min_block_min, max_block_min,
              daily_work_cap_min, due_buffer_hours, horizon_days)
  on public.profiles to authenticated;

create policy "own rows" on public.source_connections for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- demo account can look but not connect real sources
create policy "demo cannot write sources" on public.source_connections as restrictive
  for insert with check (not public.is_demo());
create policy "demo cannot update sources" on public.source_connections as restrictive
  for update using (not public.is_demo());

revoke all on public.source_secrets from anon, authenticated;

create policy "own rows" on public.sync_runs        for select using (user_id = (select auth.uid()));
create policy "own rows" on public.courses          for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.work_items       for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.events           for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.effort_estimates for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.habits           for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.plan_runs        for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.blocks           for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.plan_conflicts   for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
