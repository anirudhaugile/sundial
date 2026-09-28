import "server-only";
import { DateTime } from "luxon";
import type { DB } from "@/lib/data/queries";
import { schedule } from "@/lib/scheduler/schedule";
import type { FixedBlock, SchedulerInput, SchedulerOutput } from "@/lib/scheduler/types";
import { resolveEstimates, type ResolvedEstimate } from "./estimates";

export type PlanSummary = {
  stats: SchedulerOutput["stats"];
  items: (SchedulerOutput["items"][number] & { estimate: ResolvedEstimate; dueAt: string; courseId: string | null })[];
  conflictCount: number;
};

const OVERDUE_LOOKBACK_DAYS = 14;

/** Gather everything the scheduler needs for the user's horizon. Pure reads. */
export async function buildSchedulerInput(supabase: DB, userId: string, opts: { now?: DateTime } = {}) {
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (!profile) throw new Error("Profile missing");
  const tz = profile.timezone;
  const now = (opts.now ?? DateTime.now()).setZone(tz);
  const horizonEnd = now.startOf("day").plus({ days: profile.horizon_days });
  const nowISO = now.toUTC().toISO()!;
  const endISO = horizonEnd.toUTC().toISO()!;

  const [habits, events, blocks, items] = await Promise.all([
    supabase.from("habits").select("*").is("retired_at", null),
    supabase.from("events").select("id, starts_at, ends_at, busy").is("removed_at", null).lt("starts_at", endISO).gt("ends_at", now.startOf("day").toUTC().toISO()!),
    // blocks the scheduler must respect: locked future blocks and everything done
    supabase
      .from("blocks")
      .select("*")
      .or("locked.eq.true,status.eq.done")
      .in("status", ["scheduled", "done"])
      .gte("ends_at", now.minus({ days: 90 }).toUTC().toISO()!),
    supabase
      .from("work_items")
      .select("*")
      .eq("status", "open")
      .is("removed_at", null)
      .not("due_at", "is", null)
      .gte("due_at", now.minus({ days: OVERDUE_LOOKBACK_DAYS }).toUTC().toISO()!)
      .lt("due_at", endISO),
  ]);

  const work = items.data ?? [];
  const estimates = await resolveEstimates(supabase, work);

  const fixedBlocks: FixedBlock[] = (blocks.data ?? [])
    .filter((b) => b.status === "done" || Date.parse(b.ends_at) > now.toMillis())
    .map((b) => ({
      id: b.id,
      kind: b.kind as "habit" | "work",
      habitId: b.habit_id,
      workItemId: b.work_item_id,
      start: b.starts_at,
      end: b.ends_at,
      status: b.status as "scheduled" | "done",
      locked: b.locked,
    }));

  const input: SchedulerInput = {
    now: nowISO,
    tz,
    horizonDays: profile.horizon_days,
    prefs: {
      dayStart: profile.day_start.slice(0, 5),
      dayEnd: profile.day_end.slice(0, 5),
      minBlockMin: profile.min_block_min,
      maxBlockMin: profile.max_block_min,
      dailyWorkCapMin: profile.daily_work_cap_min,
      dueBufferHours: profile.due_buffer_hours,
    },
    events: (events.data ?? []).map((e) => ({ id: e.id, start: e.starts_at, end: e.ends_at, busy: e.busy })),
    fixedBlocks,
    habits: (habits.data ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      priority: h.priority,
      minMin: h.min_min,
      targetMin: h.target_min,
      windowStart: h.window_start.slice(0, 5),
      windowEnd: h.window_end.slice(0, 5),
      daysOfWeek: h.days_of_week,
      startDate: h.start_date,
      endDate: h.end_date,
    })),
    work: work.map((w) => ({ id: w.id, title: w.title, dueAt: w.due_at!, estimateMin: Math.round(estimates.get(w.id)!.hours * 60) })),
  };

  return { input, profile, now, horizonEnd, work, estimates };
}

/** Run the scheduler and store the result as a proposal awaiting review. */
export async function createProposal(supabase: DB, userId: string, trigger: "manual" | "cron" | "chat" = "manual") {
  const { input, now, horizonEnd, work, estimates } = await buildSchedulerInput(supabase, userId);
  const out = schedule(input);

  // one proposal at a time: replace any pending one
  const { data: pending } = await supabase.from("plan_runs").select("id").eq("status", "proposed");
  for (const p of pending ?? []) await supabase.rpc("discard_plan", { run_id: p.id });

  const byId = new Map(work.map((w) => [w.id, w]));
  const summary: PlanSummary = {
    stats: out.stats,
    conflictCount: out.conflicts.filter((c) => c.severity === "error").length,
    items: out.items.map((it) => ({
      ...it,
      estimate: estimates.get(it.workItemId)!,
      dueAt: byId.get(it.workItemId)!.due_at!,
      courseId: byId.get(it.workItemId)!.course_id,
    })),
  };

  const { data: run, error } = await supabase
    .from("plan_runs")
    .insert({
      user_id: userId,
      trigger,
      horizon_start: now.toUTC().toISO()!,
      horizon_end: horizonEnd.toUTC().toISO()!,
      summary: summary as never,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Could not save plan");

  if (out.blocks.length) {
    const { error: be } = await supabase.from("blocks").insert(
      out.blocks.map((b) => ({
        user_id: userId,
        plan_run_id: run.id,
        kind: b.kind,
        habit_id: b.habitId ?? null,
        work_item_id: b.workItemId ?? null,
        title: b.title,
        starts_at: b.start,
        ends_at: b.end,
        status: "proposed",
        reasoning: b.reasoning,
      })),
    );
    if (be) throw new Error(be.message);
  }
  if (out.conflicts.length) {
    await supabase.from("plan_conflicts").insert(
      out.conflicts.map((c) => ({
        user_id: userId,
        plan_run_id: run.id,
        work_item_id: c.workItemId ?? null,
        habit_id: c.habitId ?? null,
        day: c.day ?? null,
        shortfall_min: c.shortfallMin,
        severity: c.severity,
        message: c.message,
      })),
    );
  }
  return { runId: run.id, output: out };
}
