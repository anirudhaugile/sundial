-- Approving a plan swaps the committed schedule atomically:
-- future, unlocked scheduled blocks are replaced by the proposal's blocks.
-- security invoker: RLS still applies, so a user can only approve their own plan.
create function public.approve_plan(run_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  run public.plan_runs;
begin
  select * into run from public.plan_runs where id = run_id for update;
  if run is null or run.user_id <> auth.uid() then
    raise exception 'plan not found';
  end if;
  if run.status <> 'proposed' then
    raise exception 'plan already %', run.status;
  end if;

  delete from public.blocks
   where user_id = run.user_id
     and status = 'scheduled'
     and locked = false
     and starts_at >= least(run.horizon_start, now())
     and (plan_run_id is distinct from run.id);

  -- drop any proposed block whose time has already passed while the plan sat unreviewed
  delete from public.blocks where plan_run_id = run.id and status = 'proposed' and ends_at <= now();

  update public.blocks set status = 'scheduled' where plan_run_id = run.id and status = 'proposed';
  update public.plan_runs set status = 'approved', decided_at = now() where id = run.id;
end $$;

create function public.discard_plan(run_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.blocks where plan_run_id = run_id and status = 'proposed';
  update public.plan_runs set status = 'discarded', decided_at = now()
   where id = run_id and status = 'proposed' and user_id = auth.uid();
end $$;

grant execute on function public.approve_plan(uuid) to authenticated;
grant execute on function public.discard_plan(uuid) to authenticated;
revoke execute on function public.approve_plan(uuid) from anon, public;
revoke execute on function public.discard_plan(uuid) from anon, public;
