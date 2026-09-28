-- Phase 7: chat, durable memory, and estimate calibration.

-- facts the user told the planner ("stats psets take me longer"); used in estimate and chat prompts
create table public.user_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  content    text not null check (length(content) between 1 and 500),
  source     text not null default 'chat' check (source in ('chat', 'manual')),
  created_at timestamptz not null default now()
);
create index user_memory_user on public.user_memory (user_id, created_at);

-- one running conversation per user; content is the raw Anthropic content-block array
create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);
create index chat_messages_user on public.chat_messages (user_id, created_at);

-- every tool the model runs, shown in the panel; `undo` holds what's needed to reverse it
create table public.tool_calls (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  tool_use_id text not null,
  name        text not null,
  input       jsonb not null,
  result      jsonb,
  summary     text,
  status      text not null check (status in ('applied', 'read', 'proposed', 'undone', 'error')),
  undo        jsonb,
  created_at  timestamptz not null default now()
);
create index tool_calls_user on public.tool_calls (user_id, created_at desc);

-- calibration: what the estimate was when you finished, and how long it actually took
alter table public.work_items
  add column estimated_minutes int check (estimated_minutes is null or estimated_minutes >= 0),
  add column actual_minutes int check (actual_minutes is null or actual_minutes between 0 and 6000);

-- recurring windows where assignment work is off-limits (habits still allowed), e.g. Friday nights
alter table public.profiles
  add column no_work_windows jsonb not null default '[]';
grant update (no_work_windows) on public.profiles to authenticated;

alter table public.user_memory   enable row level security;
alter table public.chat_messages enable row level security;
alter table public.tool_calls    enable row level security;
create policy "own rows" on public.user_memory   for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.chat_messages for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.tool_calls    for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
