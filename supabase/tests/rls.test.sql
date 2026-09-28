begin;
select plan(15);

-- two users; the signup trigger creates their profiles and default habits
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev');

select is((select count(*)::int from public.habits where user_id = '00000000-0000-0000-0000-00000000000a'), 2,
  'signup seeds Gym and Internship habits');

insert into public.work_items (id, user_id, title) values
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'B secret task');
insert into public.source_connections (id, user_id, kind) values
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'outlook_ics');
insert into public.source_secrets (connection_id, user_id, ciphertext) values
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'enc');

insert into public.user_memory (user_id, content) values ('00000000-0000-0000-0000-00000000000b', 'B private fact');
insert into public.chat_messages (user_id, role, content) values ('00000000-0000-0000-0000-00000000000b', 'user', '"hi"');
insert into public.tool_calls (user_id, tool_use_id, name, input, status) values ('00000000-0000-0000-0000-00000000000b', 't', 'remember', '{}', 'applied');

-- act as user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from public.work_items), 0, 'A cannot see B work items');
select is((select count(*)::int from public.profiles), 1, 'A sees only own profile');
select is((select count(*)::int from public.habits), 2, 'A sees only own habits');
select is((select count(*)::int from public.source_connections), 0, 'A cannot see B sources');
select is((select count(*)::int from public.user_memory), 0, 'A cannot see B memories');
select is((select count(*)::int from public.chat_messages), 0, 'A cannot see B chat');
select is((select count(*)::int from public.tool_calls), 0, 'A cannot see B tool calls');
select throws_ok($$select * from public.source_secrets$$, '42501', null, 'secrets unreadable by users');

select throws_ok(
  $$insert into public.work_items (user_id, title) values ('00000000-0000-0000-0000-00000000000b', 'x')$$,
  '42501', null, 'A cannot insert rows for B');

-- A cannot attach a block to B's work item (composite FK + RLS)
select throws_ok(
  $$insert into public.blocks (user_id, kind, work_item_id, title, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000000a', 'work', '10000000-0000-0000-0000-00000000000b', 'x', now(), now() + interval '1 hour')$$,
  '23503', null, 'cannot reference another user''s work item');

select lives_ok($$update public.profiles set horizon_days = 14$$, 'A can update own preferences');
select throws_ok($$update public.profiles set is_demo = true$$, '42501', null, 'A cannot flip is_demo');

-- demo restrictions
reset role;
update public.profiles set is_demo = true where id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select throws_ok(
  $$insert into public.source_connections (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'canvas_api')$$,
  '42501', null, 'demo account cannot add sources');
select lives_ok(
  $$insert into public.work_items (user_id, title) values ('00000000-0000-0000-0000-00000000000a', 'demo task')$$,
  'demo account can still add tasks');

select * from finish();
rollback;
