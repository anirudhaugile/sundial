import type { Metadata } from "next";
import { DateTime } from "luxon";
import { MonthGrid, type MonthDay } from "@/components/month-grid";
import { PeriodNav } from "@/components/period-nav";
import { NewButton } from "@/components/quick-add";
import { PageHeader } from "@/components/ui";
import { getCalendar, getCourses, getHabits, getWorkItemsById, requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { monthGrid } from "@/lib/time";
import { blockToAgenda, dueMarker, lookups } from "@/lib/view";

export const metadata: Metadata = { title: "Month" };

export default async function MonthPage({ searchParams }: PageProps<"/month">) {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const tz = profile.timezone;
  const now = DateTime.now().setZone(tz);
  const { d } = await searchParams;
  const anchor = typeof d === "string" && DateTime.fromISO(d).isValid ? d : now.toISODate()!;
  const grid = monthGrid(anchor, tz);

  const [cal, courses, habits] = await Promise.all([getCalendar(supabase, grid.start, grid.end), getCourses(supabase), getHabits(supabase, { includeRetired: true })]);
  const items = await getWorkItemsById(supabase, cal.blocks.map((b) => b.work_item_id).filter((x): x is string => !!x));
  const l = lookups(courses, habits, [...items.values(), ...cal.due]);

  const byDay = new Map<string, MonthDay>(grid.days.map((dt) => [dt.toISODate()!, { date: dt.toISODate()!, due: [], work: [], habitMin: 0, eventCount: 0 }]));
  const dayOf = (iso: string) => byDay.get(DateTime.fromISO(iso).setZone(tz).toISODate()!);

  for (const w of cal.due) dayOf(w.due_at!)?.due.push(dueMarker(w, l));
  for (const e of cal.events) {
    const day = dayOf(e.starts_at);
    if (day) day.eventCount++;
  }
  for (const b of cal.blocks) {
    if (b.status === "skipped") continue;
    const day = dayOf(b.starts_at);
    if (!day) continue;
    const minutes = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    if (b.kind === "habit") {
      day.habitMin += minutes;
      continue;
    }
    const a = blockToAgenda(b, l);
    const existing = day.work.find((w) => w.title === b.title);
    if (existing) existing.minutes += minutes;
    else day.work.push({ title: b.title, tint: a.tint, minutes });
  }

  const totalDue = cal.due.filter((w) => DateTime.fromISO(w.due_at!).setZone(tz).month === grid.month.month).length;

  return (
    <>
      <PageHeader
        title={grid.month.toFormat("LLLL yyyy")}
        subtitle={totalDue ? `${totalDue} deadline${totalDue === 1 ? "" : "s"} this month` : "No deadlines this month yet"}
        actions={
          <>
            <PeriodNav
              base="/month"
              prev={grid.month.minus({ months: 1 }).toISODate()!}
              next={grid.month.plus({ months: 1 }).toISODate()!}
              today={now.toISODate()!}
              isCurrent={now.hasSame(grid.month, "month")}
            />
            <NewButton type="assignment" label="Assignment" />
          </>
        }
      />
      <MonthGrid tz={tz} month={grid.month.month} days={[...byDay.values()]} todayISO={now.toISODate()!} />
    </>
  );
}
