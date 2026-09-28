import type { Metadata } from "next";
import { DateTime } from "luxon";
import { PlanEmpty, PlanReview, type ConflictRow, type PlanItemRow, type RemovedRow } from "@/components/plan-review";
import { PageHeader } from "@/components/ui";
import { getCourses, getHabits, getWorkItemsById, requireProfile } from "@/lib/data/queries";
import type { PlanSummary } from "@/lib/planner/run";
import { createClient } from "@/lib/supabase/server";
import { blockToAgenda, courseLabel, lookups } from "@/lib/view";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const tz = profile.timezone;
  const now = DateTime.now().setZone(tz);

  const [{ data: proposal }, { data: lastApproved }] = await Promise.all([
    supabase.from("plan_runs").select("*").eq("status", "proposed").maybeSingle(),
    supabase.from("plan_runs").select("decided_at").eq("status", "approved").order("decided_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const header = <PageHeader title="Plan" subtitle="Sundial proposes. You decide." />;

  if (!proposal) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <PlanEmpty
          hasApproved={!!lastApproved}
          lastApproved={lastApproved?.decided_at ? DateTime.fromISO(lastApproved.decided_at).setZone(tz).toRelative() : null}
          horizon={profile.horizon_days}
        />
      </div>
    );
  }

  const [{ data: proposed }, { data: current }, { data: conflicts }, courses, habits] = await Promise.all([
    supabase.from("blocks").select("*").eq("plan_run_id", proposal.id).eq("status", "proposed").order("starts_at"),
    supabase
      .from("blocks")
      .select("*")
      .eq("status", "scheduled")
      .eq("locked", false)
      .gte("starts_at", proposal.horizon_start)
      .order("starts_at"),
    supabase.from("plan_conflicts").select("*").eq("plan_run_id", proposal.id),
    getCourses(supabase),
    getHabits(supabase, { includeRetired: true }),
  ]);

  const summary = proposal.summary as unknown as PlanSummary;
  const allBlocks = [...(proposed ?? []), ...(current ?? [])];
  const items = await getWorkItemsById(supabase, [
    ...allBlocks.map((b) => b.work_item_id).filter((x): x is string => !!x),
    ...summary.items.map((i) => i.workItemId),
  ]);
  const l = lookups(courses, habits, [...items.values()]);

  const sameSlot = (a: { kind: string; work_item_id: string | null; habit_id: string | null; starts_at: string; ends_at: string }, b: typeof a) =>
    a.kind === b.kind &&
    a.work_item_id === b.work_item_id &&
    a.habit_id === b.habit_id &&
    Date.parse(a.starts_at) === Date.parse(b.starts_at) &&
    Date.parse(a.ends_at) === Date.parse(b.ends_at);

  const blocks = (proposed ?? []).map((b) => ({ ...blockToAgenda(b, l), unchanged: (current ?? []).some((c) => sameSlot(b, c)) }));
  const removed: RemovedRow[] = (current ?? [])
    .filter((c) => !(proposed ?? []).some((p) => sameSlot(p, c)))
    .map((c) => ({ id: c.id, title: c.title, start: c.starts_at, end: c.ends_at, tint: blockToAgenda(c, l).tint }));

  const planItems: PlanItemRow[] = summary.items
    .filter((i) => items.get(i.workItemId)?.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((i) => {
      const course = i.courseId ? l.courses.get(i.courseId) : undefined;
      return {
        id: i.workItemId,
        title: i.title,
        course: courseLabel(course),
        tint: course?.color ?? "sand",
        dueAt: i.dueAt,
        hours: i.estimate.hours,
        origin: i.estimate.origin,
        reasoning: i.estimate.reasoning,
        remainingMin: i.remainingMin,
        placedMin: i.placedMin,
        startBy: i.startBy,
        status: i.status,
        calibration: i.estimate.calibration ?? null,
      };
    });

  const conflictRows: ConflictRow[] = (conflicts ?? []).map((c) => ({ id: c.id, severity: c.severity as "warning" | "error", message: c.message }));

  return (
    <div className="mx-auto max-w-3xl">
      {header}
      <PlanReview
        tz={tz}
        nowISO={now.toUTC().toISO()!}
        runId={proposal.id}
        createdAt={proposal.created_at}
        blocks={blocks}
        removed={removed}
        conflicts={conflictRows}
        items={planItems}
        stats={summary.stats}
        aiEnabled={!!process.env.ANTHROPIC_API_KEY}
      />
    </div>
  );
}
