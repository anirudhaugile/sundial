import { DateTime } from "luxon";
import type {
  Conflict,
  FixedBlock,
  ItemPlan,
  ProposedBlock,
  SchedulerHabit,
  SchedulerInput,
  SchedulerOutput,
  SchedulerWork,
} from "./types";

/**
 * Deterministic planner.
 *
 *   fixed events  >  habits (by priority)  >  assignment work
 *
 * Time is modelled as 15-minute slots per calendar day in the user's zone.
 * Habits are placed first, inside their windows. Assignments are then
 * back-scheduled: latest deadline first, each filling the days closest to its
 * (deadline − buffer) and working backwards toward today. Within a day, work goes
 * in the earliest free slot so sessions land at sensible hours. Anything that
 * can't be placed becomes a visible conflict — nothing is silently dropped.
 */

export const SLOT_MIN = 15;
const SLOT_MS = SLOT_MIN * 60_000;

const FREE = 0;
const BUSY = 1;
const BREAK = 2; // short gap after a work session; habits may use it, work may not

type Day = {
  date: string;
  dt: DateTime;
  startMs: number;
  n: number;
  slots: Uint8Array;
  workStart: number; // slot index of prefs.dayStart
  workEnd: number; // slot index of prefs.dayEnd
  workUsed: number; // minutes of assignment work already on this day
  perItem: Map<string, number>;
};

type Run = { s: number; e: number };

const ceilSlots = (min: number) => Math.ceil(min / SLOT_MIN);

export function formatMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function clockIdx(day: Day, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ms = day.dt.set({ hour: h, minute: m || 0 }).toMillis();
  return Math.max(0, Math.min(day.n, Math.round((ms - day.startMs) / SLOT_MS)));
}

function slotStart(day: Day, i: number) {
  return DateTime.fromMillis(day.startMs + i * SLOT_MS).setZone(day.dt.zone);
}

function niceTime(dt: DateTime) {
  return (dt.minute ? dt.toFormat("h:mm a") : dt.toFormat("h a")).toLowerCase();
}

function niceDue(dt: DateTime) {
  return `${dt.toFormat("ccc")} ${niceTime(dt)}`;
}

function runs(day: Day, from: number, to: number, ok: (v: number) => boolean): Run[] {
  const out: Run[] = [];
  let s = -1;
  for (let i = Math.max(0, from); i < Math.min(day.n, to); i++) {
    if (ok(day.slots[i])) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      out.push({ s, e: i });
      s = -1;
    }
  }
  if (s >= 0) out.push({ s, e: Math.min(day.n, to) });
  return out;
}

const freeForWork = (v: number) => v === FREE;
const freeForHabit = (v: number) => v !== BUSY;

function mark(days: Day[], startMs: number, endMs: number, value = BUSY) {
  for (const d of days) {
    const dEnd = d.startMs + d.n * SLOT_MS;
    if (endMs <= d.startMs || startMs >= dEnd) continue;
    const s = Math.max(0, Math.floor((startMs - d.startMs) / SLOT_MS));
    const e = Math.min(d.n, Math.ceil((endMs - d.startMs) / SLOT_MS));
    for (let i = s; i < e; i++) d.slots[i] = value;
  }
}

function dayOf(days: Day[], ms: number) {
  return days.find((d) => ms >= d.startMs && ms < d.startMs + d.n * SLOT_MS);
}

function buildDays(input: SchedulerInput, now: DateTime): Day[] {
  const today = now.startOf("day");
  const days: Day[] = [];
  for (let k = 0; k < input.horizonDays; k++) {
    const dt = today.plus({ days: k });
    const next = dt.plus({ days: 1 });
    const n = Math.round((next.toMillis() - dt.toMillis()) / SLOT_MS); // 92/96/100 around DST
    const day: Day = {
      date: dt.toISODate()!,
      dt,
      startMs: dt.toMillis(),
      n,
      slots: new Uint8Array(n),
      workStart: 0,
      workEnd: 0,
      workUsed: 0,
      perItem: new Map(),
    };
    day.workStart = clockIdx(day, input.prefs.dayStart);
    day.workEnd = clockIdx(day, input.prefs.dayEnd);
    days.push(day);
  }
  // the past is gone
  const nowIdx = Math.ceil((now.toMillis() - days[0].startMs) / SLOT_MS);
  for (let i = 0; i < Math.min(nowIdx, days[0].n); i++) days[0].slots[i] = BUSY;
  return days;
}

function habitActive(h: SchedulerHabit, day: Day) {
  if (day.date < h.startDate) return false;
  if (h.endDate && day.date > h.endDate) return false;
  return h.daysOfWeek.includes(day.dt.weekday);
}

export function schedule(input: SchedulerInput): SchedulerOutput {
  const now = DateTime.fromISO(input.now, { zone: "utc" }).setZone(input.tz);
  const nowMs = now.toMillis();
  const days = buildDays(input, now);
  const blocks: ProposedBlock[] = [];
  const conflicts: Conflict[] = [];
  const { prefs } = input;

  // 1. fixed things: busy events and blocks we must not move
  for (const e of input.events) {
    if (!e.busy) continue;
    mark(days, Date.parse(e.start), Date.parse(e.end));
  }
  const fixed = input.fixedBlocks.filter((b) => Date.parse(b.end) > days[0].startMs);
  for (const b of fixed) {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    mark(days, s, e);
    if (b.kind === "work" && b.workItemId) {
      const d = dayOf(days, s);
      if (d) {
        const min = (e - s) / 60_000;
        d.workUsed += min;
        d.perItem.set(b.workItemId, (d.perItem.get(b.workItemId) ?? 0) + min);
      }
    }
  }

  // 2. habits, highest priority first
  const habits = [...input.habits].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const h of habits) {
    for (const day of days) {
      if (!habitActive(h, day)) continue;
      const already = fixed
        .filter((b) => b.habitId === h.id && dayOf(days, Date.parse(b.start)) === day)
        .reduce((m, b) => m + (Date.parse(b.end) - Date.parse(b.start)) / 60_000, 0);
      if (already >= h.minMin) continue;
      placeHabit(h, day, already);
    }
  }

  function placeHabit(h: SchedulerHabit, day: Day, already: number) {
    const target = ceilSlots(Math.max(SLOT_MIN, h.targetMin - already));
    const min = ceilSlots(Math.max(SLOT_MIN, h.minMin - already));
    const ws = clockIdx(day, h.windowStart);
    const we = clockIdx(day, h.windowEnd);
    const windowLabel = `${niceTime(slotStart(day, ws))}–${niceTime(slotStart(day, we))}`;
    const inWindow = runs(day, ws, we, freeForHabit);

    const full = inWindow.find((r) => r.e - r.s >= target);
    if (full) return commitHabit(h, day, full.s, target, `${h.name} in your ${windowLabel} window.`);

    const longest = [...inWindow].sort((a, b) => b.e - b.s - (a.e - a.s) || a.s - b.s)[0];
    if (longest && longest.e - longest.s >= min) {
      const len = longest.e - longest.s;
      return commitHabit(h, day, longest.s, len, `Shortened to ${formatMin(len * SLOT_MIN)} — the ${windowLabel} window is tight today.`);
    }

    // outside the window, anywhere in the day, as close to the window as possible
    const lo = Math.min(day.workStart, ws);
    const hi = Math.max(day.workEnd, we);
    const outside = runs(day, lo, hi, freeForHabit).filter((r) => r.e - r.s >= min);
    if (outside.length) {
      const dist = (r: Run) => (r.e <= ws ? ws - r.e : r.s >= we ? r.s - we : 0);
      const best = outside.sort((a, b) => dist(a) - dist(b) || a.s - b.s)[0];
      const len = Math.min(target, best.e - best.s);
      const start = best.e <= ws ? best.e - len : best.s; // hug the window
      commitHabit(h, day, start, len, `Moved outside its ${windowLabel} window, which is full today.`);
      conflicts.push({
        kind: "habit",
        habitId: h.id,
        day: day.date,
        shortfallMin: 0,
        severity: "warning",
        message: `${h.name} on ${day.dt.toFormat("ccc LLL d")} moved to ${niceTime(slotStart(day, start))}; its window is full.`,
      });
      return;
    }

    const windowPast = day === days[0] && slotStart(day, we).toMillis() <= nowMs;
    conflicts.push({
      kind: "habit",
      habitId: h.id,
      day: day.date,
      shortfallMin: min * SLOT_MIN,
      severity: windowPast ? "warning" : "error",
      message: windowPast
        ? `No time left today for ${h.name}.`
        : `Couldn't fit ${h.name} (${formatMin(min * SLOT_MIN)}) on ${day.dt.toFormat("ccc LLL d")} — no free gap that day.`,
    });
  }

  function commitHabit(h: SchedulerHabit, day: Day, s: number, len: number, reasoning: string) {
    for (let i = s; i < s + len; i++) day.slots[i] = BUSY;
    blocks.push({
      kind: "habit",
      habitId: h.id,
      title: h.name,
      start: slotStart(day, s).toUTC().toISO()!,
      end: slotStart(day, s + len).toUTC().toISO()!,
      reasoning,
    });
  }

  // 3. assignment work
  const doneFromBlocks = new Map<string, number>();
  const lockedAhead = new Map<string, number>();
  for (const b of input.fixedBlocks) {
    if (b.kind !== "work" || !b.workItemId) continue;
    const min = (Date.parse(b.end) - Date.parse(b.start)) / 60_000;
    if (b.status === "done") doneFromBlocks.set(b.workItemId, (doneFromBlocks.get(b.workItemId) ?? 0) + min);
    else if (Date.parse(b.start) >= nowMs) lockedAhead.set(b.workItemId, (lockedAhead.get(b.workItemId) ?? 0) + min);
  }

  type Job = SchedulerWork & { remaining: number; total: number; dueMs: number; deadlineMs: number; placed: ProposedBlock[] };
  const jobs: Job[] = input.work.map((w) => {
    const spent = w.doneMin ?? doneFromBlocks.get(w.id) ?? 0;
    const remaining = Math.max(0, ceilSlots(w.estimateMin - spent - (lockedAhead.get(w.id) ?? 0)) * SLOT_MIN);
    const dueMs = Date.parse(w.dueAt);
    return { ...w, remaining, total: remaining, dueMs, deadlineMs: dueMs - prefs.dueBufferHours * 3_600_000, placed: [] };
  });

  const minSlots = ceilSlots(prefs.minBlockMin);
  const maxSlots = Math.max(minSlots, Math.floor(prefs.maxBlockMin / SLOT_MIN));
  const perItemDayCap = prefs.maxBlockMin * 2;

  /** Fill one day's free runs (earliest first) up to `limit`, respecting caps. */
  function fillDay(job: Job, day: Day, fromIdx: number, limitIdx: number, note: string) {
    const lo = Math.max(day.workStart, fromIdx);
    const hi = Math.min(day.workEnd, limitIdx);
    if (hi <= lo) return;
    for (const run of runs(day, lo, hi, freeForWork)) {
      let s = run.s;
      while (job.remaining > 0 && s < run.e) {
        const capLeft = Math.min(prefs.dailyWorkCapMin - day.workUsed, perItemDayCap - (day.perItem.get(job.id) ?? 0));
        let want = Math.min(run.e - s, maxSlots, job.remaining / SLOT_MIN, Math.floor(capLeft / SLOT_MIN));
        if (want <= 0) return;
        if (want < minSlots) {
          // a short leftover becomes one full minimum-length session rather than a 15-minute sliver
          const fits = run.e - s >= minSlots && capLeft >= minSlots * SLOT_MIN;
          if (job.remaining / SLOT_MIN <= want && fits) want = minSlots;
          else break;
        }
        for (let i = s; i < s + want; i++) day.slots[i] = BUSY;
        if (s + want < day.n && day.slots[s + want] === FREE) day.slots[s + want] = BREAK;
        const min = want * SLOT_MIN;
        day.workUsed += min;
        day.perItem.set(job.id, (day.perItem.get(job.id) ?? 0) + min);
        job.remaining = Math.max(0, job.remaining - min);
        const block: ProposedBlock = {
          kind: "work",
          workItemId: job.id,
          title: job.title,
          start: slotStart(day, s).toUTC().toISO()!,
          end: slotStart(day, s + want).toUTC().toISO()!,
          reasoning: note,
        };
        job.placed.push(block);
        blocks.push(block);
        s += want + 1;
      }
      if (job.remaining <= 0) return;
    }
  }

  function limitIdx(day: Day, ms: number) {
    const end = day.startMs + day.n * SLOT_MS;
    if (ms >= end) return day.n;
    if (ms <= day.startMs) return 0;
    return Math.floor((ms - day.startMs) / SLOT_MS);
  }

  /** Days closest to the limit first, walking back toward today. */
  function backward(job: Job, untilMs: number, fromMs: number, note: string) {
    for (let k = days.length - 1; k >= 0 && job.remaining > 0; k--) {
      const day = days[k];
      if (day.startMs >= untilMs) continue;
      const from = fromMs > day.startMs ? limitIdx(day, fromMs) : 0;
      fillDay(job, day, from, limitIdx(day, untilMs), note);
    }
  }

  function forward(job: Job, note: string) {
    for (const day of days) {
      if (job.remaining <= 0) return;
      fillDay(job, day, 0, day.n, note);
    }
  }

  const active = jobs.filter((j) => j.remaining > 0);
  const onTime = active.filter((j) => j.deadlineMs > nowMs).sort((a, b) => b.dueMs - a.dueMs || a.id.localeCompare(b.id));
  const tight = active.filter((j) => j.deadlineMs <= nowMs && j.dueMs > nowMs).sort((a, b) => a.dueMs - b.dueMs || a.id.localeCompare(b.id));
  const overdue = active.filter((j) => j.dueMs <= nowMs).sort((a, b) => a.dueMs - b.dueMs || a.id.localeCompare(b.id));

  // pass 1: finish before (due − buffer)
  for (const j of onTime) backward(j, j.deadlineMs, 0, "planned");
  // pass 2: whatever is left may use the buffer window
  for (const j of [...onTime, ...tight]) if (j.remaining > 0) backward(j, j.dueMs, 0, "buffer");
  // pass 3: overdue work goes in the first free time, after on-time work is protected
  for (const j of overdue) forward(j, "overdue");

  // conflicts for anything left over
  for (const j of active) {
    if (j.remaining <= 0) continue;
    const due = DateTime.fromMillis(j.dueMs).setZone(input.tz);
    const capBound = hasCappedFreeTime(j.dueMs <= nowMs ? Infinity : j.dueMs);
    const why = capBound
      ? `Raising your ${formatMin(prefs.dailyWorkCapMin)}/day work limit would make room.`
      : "Your calendar is full before then.";
    conflicts.push({
      kind: "work",
      workItemId: j.id,
      shortfallMin: j.remaining,
      severity: "error",
      message:
        j.dueMs <= nowMs
          ? `${j.title} is overdue and ${formatMin(j.remaining)} of it doesn't fit in the next ${input.horizonDays} days.`
          : `${j.title} needs ${formatMin(j.remaining)} more than fits before it's due ${niceDue(due)}. ${why}`,
    });
  }
  for (const j of [...onTime, ...tight]) {
    const inBuffer = j.placed.filter((b) => Date.parse(b.end) > j.deadlineMs);
    if (inBuffer.length && prefs.dueBufferHours > 0) {
      conflicts.push({
        kind: "work",
        workItemId: j.id,
        shortfallMin: 0,
        severity: "warning",
        message: `${j.title} runs into your ${prefs.dueBufferHours}h safety buffer before ${niceDue(DateTime.fromMillis(j.dueMs).setZone(input.tz))}.`,
      });
    }
  }

  function hasCappedFreeTime(untilMs: number) {
    for (const d of days) {
      if (d.startMs >= untilMs) break;
      if (d.workUsed < prefs.dailyWorkCapMin) continue;
      const free = runs(d, d.workStart, Math.min(d.workEnd, limitIdx(d, untilMs)), freeForWork).some((r) => r.e - r.s >= minSlots);
      if (free) return true;
    }
    return false;
  }

  // readable reasoning, written once all sessions for an item are known
  for (const j of jobs) {
    const sessions = [...j.placed].sort((a, b) => a.start.localeCompare(b.start));
    const due = DateTime.fromMillis(j.dueMs).setZone(input.tz);
    const finish = sessions.length ? DateTime.fromISO(sessions[sessions.length - 1].end).setZone(input.tz) : null;
    sessions.forEach((b, i) => {
      const len = (Date.parse(b.end) - Date.parse(b.start)) / 60_000;
      const head = sessions.length > 1 ? `Session ${i + 1} of ${sessions.length}` : "One session";
      const parts = [`${head} · ${formatMin(len)} of the ${formatMin(j.total)} left on ${j.title}.`];
      if (b.reasoning === "overdue") parts.push(`It was due ${niceDue(due)}, so it goes in the first free time.`);
      else if (b.reasoning === "buffer") parts.push(`Due ${niceDue(due)}; this cuts into your ${prefs.dueBufferHours}h buffer.`);
      else if (finish) parts.push(`Due ${niceDue(due)}; on track to finish by ${niceDue(finish)}.`);
      b.reasoning = parts.join(" ");
    });
  }

  const items: ItemPlan[] = jobs.map((j) => {
    const placedMin = j.placed.reduce((m, b) => m + (Date.parse(b.end) - Date.parse(b.start)) / 60_000, 0);
    const first = [...j.placed].sort((a, b) => a.start.localeCompare(b.start))[0];
    return {
      workItemId: j.id,
      title: j.title,
      remainingMin: j.total,
      placedMin,
      startBy: first?.start ?? null,
      status:
        j.total === 0 ? "complete" : j.dueMs <= nowMs ? "overdue" : j.remaining === 0 ? "planned" : placedMin > 0 ? "partial" : "unplaced",
    };
  });

  blocks.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const sum = (k: "habit" | "work") => blocks.filter((b) => b.kind === k).reduce((m, b) => m + (Date.parse(b.end) - Date.parse(b.start)) / 60_000, 0);

  return {
    blocks,
    conflicts: conflicts.sort((a, b) => (a.severity === b.severity ? (a.day ?? "").localeCompare(b.day ?? "") : a.severity === "error" ? -1 : 1)),
    items,
    stats: { workMin: sum("work"), habitMin: sum("habit"), days: days.length },
  };
}

export type { FixedBlock };
