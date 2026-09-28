import type { Metadata } from "next";
import { DateTime } from "luxon";
import { PeriodNav } from "@/components/period-nav";
import { NewButton } from "@/components/quick-add";
import { PageHeader } from "@/components/ui";
import { WeekGrid } from "@/components/week-grid";
import { getCalendar, getCourses, getHabits, getWorkItemsById, requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { timeToMinutes, weekRange } from "@/lib/time";
import { blockToAgenda, dueMarker, eventToAgenda, lookups } from "@/lib/view";

export const metadata: Metadata = { title: "Week" };

export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const tz = profile.timezone;
  const now = DateTime.now().setZone(tz);
  const { d } = await searchParams;
  const anchor = typeof d === "string" && DateTime.fromISO(d).isValid ? d : now.toISODate()!;
  const { start, end } = weekRange(anchor, tz);

  const [cal, courses, habits] = await Promise.all([getCalendar(supabase, start, end), getCourses(supabase), getHabits(supabase, { includeRetired: true })]);
  const items = await getWorkItemsById(supabase, cal.blocks.map((b) => b.work_item_id).filter((x): x is string => !!x));
  const l = lookups(courses, habits, [...items.values(), ...cal.due]);

  const agenda = [...cal.events.filter((e) => !e.all_day).map(eventToAgenda), ...cal.blocks.map((b) => blockToAgenda(b, l))];
  const due = cal.due.map((w) => dueMarker(w, l));
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);

  // visible hours: the user's day, stretched to fit anything outside it
  let fromMin = timeToMinutes(profile.day_start);
  let toMin = timeToMinutes(profile.day_end);
  for (const a of agenda) {
    const s = DateTime.fromISO(a.start).setZone(tz);
    const e = DateTime.fromISO(a.end).setZone(tz);
    if (s.toISODate() === e.toISODate()) {
      fromMin = Math.min(fromMin, s.hour * 60);
      toMin = Math.max(toMin, e.hour * 60 + e.minute);
    }
  }
  fromMin = Math.floor(fromMin / 60) * 60;
  toMin = Math.min(24 * 60, Math.ceil(toMin / 60) * 60);

  const sameMonth = start.month === end.minus({ days: 1 }).month;
  const title = sameMonth ? start.toFormat("LLLL yyyy") : `${start.toFormat("LLL")} – ${end.minus({ days: 1 }).toFormat("LLL yyyy")}`;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`Week of ${start.toFormat("LLL d")}`}
        actions={
          <>
            <PeriodNav
              base="/week"
              prev={start.minus({ weeks: 1 }).toISODate()!}
              next={start.plus({ weeks: 1 }).toISODate()!}
              today={now.toISODate()!}
              isCurrent={now >= start && now < end}
            />
            <NewButton type="event" />
          </>
        }
      />
      <WeekGrid tz={tz} days={days} items={agenda} due={due} fromMin={fromMin} toMin={toMin} nowISO={now.toUTC().toISO()!} />
      {!agenda.length && !due.length ? (
        <p className="mt-6 text-center text-sm text-muted">
          An empty week. Add events with <span className="font-mono text-xs">n</span>, connect Outlook in Settings, or run the planner to place work.
        </p>
      ) : null}
    </>
  );
}
