import type { Metadata } from "next";
import { DateTime } from "luxon";
import { NewButton } from "@/components/quick-add";
import { TodayView, type DueRow, type OverdueRow, type TodoRow } from "@/components/today-view";
import { getCourses, getHabits, getToday, getWorkItemsById, requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { formatDue, formatDuration, formatTime, greeting } from "@/lib/time";
import { blockToAgenda, courseLabel, eventToAgenda, lookups, type AgendaItem } from "@/lib/view";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);
  const tz = profile.timezone;
  const now = DateTime.now().setZone(tz);
  const nowISO = now.toUTC().toISO()!;

  const [data, courses, habits, upcomingRes] = await Promise.all([
    getToday(supabase, now),
    getCourses(supabase),
    getHabits(supabase, { includeRetired: true }),
    supabase
      .from("work_items")
      .select("*")
      .eq("status", "open")
      .is("removed_at", null)
      .gt("due_at", nowISO)
      .lte("due_at", now.plus({ days: 7 }).toUTC().toISO()!)
      .order("due_at")
      .limit(6),
  ]);
  const upcomingItems = upcomingRes.data ?? [];

  const blockItemIds = [...data.blocks, ...data.missedBlocks].map((b) => b.work_item_id).filter((x): x is string => !!x);
  const items = await getWorkItemsById(supabase, blockItemIds);
  const l = lookups(courses, habits, [...items.values(), ...data.due, ...data.overdueItems]);

  const { data: futureBlocks } = upcomingItems.length
    ? await supabase
        .from("blocks")
        .select("work_item_id, starts_at, ends_at, status")
        .in("work_item_id", upcomingItems.map((w) => w.id))
        .in("status", ["scheduled", "done"])
    : { data: [] };
  const planned = new Map<string, number>();
  for (const b of futureBlocks ?? []) {
    // count work that is done or still ahead; missed blocks don't count as planned
    if (Date.parse(b.ends_at) < now.toMillis() && b.status !== "done") continue;
    const m = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    planned.set(b.work_item_id!, (planned.get(b.work_item_id!) ?? 0) + m);
  }

  const agenda: AgendaItem[] = [...data.events.map(eventToAgenda), ...data.blocks.map((b) => blockToAgenda(b, l))].sort(
    (a, b) => a.start.localeCompare(b.start),
  );

  const today = now.toISODate()!;
  const todos: TodoRow[] = data.todos.map((t) => {
    const carried = !!t.planned_for && t.planned_for < today;
    return {
      id: t.id,
      title: t.title,
      tint: "sand",
      carried,
      meta: carried ? `from ${DateTime.fromISO(t.planned_for!, { zone: tz }).toFormat("ccc")}` : null,
    };
  });

  const overdue: OverdueRow[] = [
    ...data.overdueItems.map((w) => {
      const course = w.course_id ? l.courses.get(w.course_id) : undefined;
      return {
        id: w.id,
        kind: "item" as const,
        title: w.title,
        tint: course?.color ?? "sand",
        meta: `Was due ${formatDue(DateTime.fromISO(w.due_at!).setZone(tz), now)}${course ? ` · ${courseLabel(course)}` : ""}`,
      };
    }),
    ...data.missedBlocks
      .filter((b) => !b.work_item_id || l.items.get(b.work_item_id)?.status !== "done")
      .map((b) => {
        const a = blockToAgenda(b, l);
        const s = DateTime.fromISO(b.starts_at).setZone(tz);
        return { id: b.id, kind: "block" as const, title: b.title, tint: a.tint, meta: `Missed ${s.toFormat("ccc")} ${formatTime(s)}` };
      }),
  ];

  const upcoming: DueRow[] = upcomingItems.map((w) => {
    const course = w.course_id ? l.courses.get(w.course_id) : undefined;
    return { id: w.id, title: w.title, course: courseLabel(course), due: w.due_at!, tint: course?.color ?? "sand", plannedMin: planned.get(w.id) ?? 0 };
  });

  // Up next: whatever is happening now, else the next thing to start.
  const remaining = agenda.filter((a) => a.status !== "done" && a.status !== "skipped" && DateTime.fromISO(a.end) > now);
  const next = remaining[0];
  const workMin = agenda
    .filter((a) => a.kind === "work" && a.status !== "skipped")
    .reduce((m, a) => m + (Date.parse(a.end) - Date.parse(a.start)) / 60000, 0);

  const name = profile.display_name || titleCase(user.email?.split("@")[0]?.split(/[.+_-]/)[0] ?? "");
  const dueToday = data.due.filter((w) => w.status === "open").length;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-10 animate-rise">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">{now.toFormat("cccc, LLLL d")}</p>
            <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.025em]">
              {greeting(now)}{name ? `, ${name}` : ""}.
            </h1>
          </div>
          <NewButton />
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{summaryLine(agenda.length, workMin, dueToday, overdue.length)}</p>

        {next ? <UpNext item={next} now={now} tz={tz} /> : null}
      </header>

      <TodayView tz={tz} nowISO={nowISO} agenda={agenda} todos={todos} overdue={overdue} upcoming={upcoming} />
    </div>
  );
}

function UpNext({ item, now, tz }: { item: AgendaItem; now: DateTime; tz: string }) {
  const s = DateTime.fromISO(item.start).setZone(tz);
  const e = DateTime.fromISO(item.end).setZone(tz);
  const live = s <= now;
  const mins = Math.round((live ? e : s).diff(now, "minutes").minutes);
  return (
    <div className={`tint-${item.tint} mt-6 flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4`}>
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">{live ? "Now" : "Up next"}</p>
        <p className="mt-0.5 truncate text-[15px] font-medium">{item.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm tabular-nums">{formatTime(live ? e : s)}</p>
        <p className="text-xs text-muted">{live ? `${formatDuration(mins)} left` : `in ${formatDuration(Math.max(mins, 1))}`}</p>
      </div>
    </div>
  );
}

function summaryLine(count: number, workMin: number, dueToday: number, overdue: number) {
  if (!count && !dueToday && !overdue) return "A clear day. Nothing is scheduled yet.";
  const parts: string[] = [];
  if (count) parts.push(`${count} thing${count === 1 ? "" : "s"} on the calendar`);
  if (workMin) parts.push(`${formatDuration(workMin)} of focused work`);
  if (dueToday) parts.push(`${dueToday} due today`);
  let line = parts.join(", ");
  if (overdue) line += `${line ? ". " : ""}${overdue} carried over from earlier`;
  return line + ".";
}

function titleCase(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
