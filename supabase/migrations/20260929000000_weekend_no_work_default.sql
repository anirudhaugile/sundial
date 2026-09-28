-- New users start with weekends closed to assignment work (habits like the gym still run).
-- A full-day window is written as 00:00–00:00.
alter table public.profiles
  alter column no_work_windows
  set default '[{"days":[6,7],"start":"00:00","end":"00:00","label":"Weekends"}]'::jsonb;
