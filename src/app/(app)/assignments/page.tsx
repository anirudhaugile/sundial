import type { Metadata } from "next";
import { DateTime } from "luxon";
import { AssignmentsList, type AssignmentRow } from "@/components/assignments-list";
import { NewButton } from "@/components/quick-add";
import { PageHeader } from "@/components/ui";
import { getCourses, requireProfile } from "@/lib/data/queries";
import { loadCalibration, resolveEstimates } from "@/lib/planner/estimates";
import { createClient } from "@/lib/supabase/server";
import { courseLabel } from "@/lib/view";

export const metadata: Metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const tz = profile.timezone;
  const now = DateTime.now().setZone(tz);

  const [{ data: items }, courses] = await Promise.all([
    supabase
      .from("work_items")
      .select("*")
      .is("removed_at", null)
      .not("due_at", "is", null)
      .or(`status.eq.open,completed_at.gte.${now.minus({ days: 14 }).toUTC().toISO()}`)
      .order("due_at"),
    getCourses(supabase),
  ]);
  const list = items ?? [];
  const cal = await loadCalibration(supabase);
  const [estimates, { data: blocks }] = await Promise.all([
    resolveEstimates(supabase, list, { calibration: cal.map }),
    list.length
      ? supabase.from("blocks").select("work_item_id, starts_at, ends_at, status").in("work_item_id", list.map((w) => w.id)).in("status", ["scheduled", "done"])
      : Promise.resolve({ data: [] as { work_item_id: string | null; starts_at: string; ends_at: string; status: string }[] }),
  ]);

  const planned = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const b of blocks ?? []) {
    const m = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    if (b.status === "done") spent.set(b.work_item_id!, (spent.get(b.work_item_id!) ?? 0) + m);
    else if (Date.parse(b.ends_at) > now.toMillis()) planned.set(b.work_item_id!, (planned.get(b.work_item_id!) ?? 0) + m);
  }
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const rows: AssignmentRow[] = list.map((w) => {
    const c = w.course_id ? courseById.get(w.course_id) : undefined;
    const e = estimates.get(w.id)!;
    return {
      id: w.id,
      title: w.title,
      course: courseLabel(c),
      tint: c?.color ?? "sand",
      dueAt: w.due_at,
      done: w.status === "done",
      source: w.source,
      url: w.url,
      hours: e.hours,
      origin: e.origin,
      reasoning: e.reasoning,
      plannedMin: planned.get(w.id) ?? 0,
      doneMin: w.actual_minutes ?? spent.get(w.id) ?? 0,
      estimatedMin: w.estimated_minutes,
      calibration: e.calibration,
    };
  });

  const open = rows.filter((r) => !r.done);
  const totalH = open.reduce((m, r) => m + r.hours, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Assignments"
        subtitle={
          (open.length ? `${open.length} open · about ${Math.round(totalH)} hours of work` : "Everything's done.") +
          (cal.total ? ` · estimates calibrated from ${cal.total} completed item${cal.total > 1 ? "s" : ""}` : "")
        }
        actions={<NewButton type="assignment" label="Assignment" />}
      />
      <AssignmentsList tz={tz} nowISO={now.toUTC().toISO()!} rows={rows} />
    </div>
  );
}
