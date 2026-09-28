import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { schedule } from "./schedule";
import type { ProposedBlock, SchedulerHabit, SchedulerInput, SchedulerWork } from "./types";

const tz = "America/Chicago";
// Monday Sep 28 2026, 9:00 am Chicago
const NOW = "2026-09-28T09:00";

const at = (local: string) => DateTime.fromISO(local, { zone: tz }).toUTC().toISO()!;
const local = (iso: string) => DateTime.fromISO(iso).setZone(tz);
const mins = (b: { start: string; end: string }) => (Date.parse(b.end) - Date.parse(b.start)) / 60000;
const hm = (iso: string) => local(iso).toFormat("ccc HH:mm");

const GYM: SchedulerHabit = {
  id: "gym",
  name: "Gym",
  priority: 1,
  minMin: 30,
  targetMin: 45,
  windowStart: "18:00",
  windowEnd: "23:30",
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  startDate: "2026-01-01",
  endDate: null,
};
const APPS: SchedulerHabit = {
  id: "apps",
  name: "Internship applications",
  priority: 2,
  minMin: 60,
  targetMin: 60,
  windowStart: "18:00",
  windowEnd: "23:30",
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  startDate: "2026-01-01",
  endDate: "2027-01-31",
};

function input(over: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    now: at(NOW),
    tz,
    horizonDays: 7,
    prefs: { dayStart: "08:00", dayEnd: "23:30", minBlockMin: 30, maxBlockMin: 120, dailyWorkCapMin: 360, dueBufferHours: 24 },
    events: [],
    fixedBlocks: [],
    habits: [],
    work: [],
    ...over,
  };
}

function work(id: string, dueLocal: string, estimateMin: number, extra: Partial<SchedulerWork> = {}): SchedulerWork {
  return { id, title: id.toUpperCase(), dueAt: at(dueLocal), estimateMin, ...extra };
}

const workFor = (blocks: ProposedBlock[], id: string) => blocks.filter((b) => b.workItemId === id);
const total = (blocks: ProposedBlock[]) => blocks.reduce((m, b) => m + mins(b), 0);

/** No two placed blocks overlap each other or a busy event. */
function assertNoOverlaps(inp: SchedulerInput, blocks: ProposedBlock[]) {
  const all = [
    ...blocks.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const),
    ...inp.events.filter((e) => e.busy).map((e) => [Date.parse(e.start), Date.parse(e.end)] as const),
    ...inp.fixedBlocks.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const),
  ].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < all.length; i++) expect(all[i][0]).toBeGreaterThanOrEqual(all[i - 1][1]);
}

describe("scheduler: basics", () => {
  it("returns nothing for an empty week", () => {
    const out = schedule(input());
    expect(out.blocks).toEqual([]);
    expect(out.conflicts).toEqual([]);
    expect(out.stats.days).toBe(7);
  });

  it("is deterministic", () => {
    const inp = input({ habits: [GYM, APPS], work: [work("a", "2026-10-02T23:59", 300), work("b", "2026-10-01T12:00", 180)] });
    expect(schedule(inp)).toEqual(schedule(structuredClone(inp)));
  });

  it("never schedules in the past", () => {
    const out = schedule(input({ now: at("2026-09-28T15:07"), work: [work("a", "2026-09-29T23:59", 60)], prefs: { ...input().prefs, dueBufferHours: 0 } }));
    for (const b of out.blocks) expect(Date.parse(b.start)).toBeGreaterThanOrEqual(Date.parse(at("2026-09-28T15:15")));
  });
});

describe("scheduler: habits", () => {
  it("places gym every day at the start of its window, then applications after it", () => {
    const out = schedule(input({ habits: [APPS, GYM] }));
    const gym = out.blocks.filter((b) => b.habitId === "gym");
    const apps = out.blocks.filter((b) => b.habitId === "apps");
    expect(gym).toHaveLength(7);
    expect(apps).toHaveLength(7);
    expect(gym.map((b) => local(b.start).toFormat("HH:mm"))).toEqual(Array(7).fill("18:00"));
    expect(gym.every((b) => mins(b) === 45)).toBe(true);
    expect(apps.map((b) => local(b.start).toFormat("HH:mm"))).toEqual(Array(7).fill("18:45"));
  });

  it("stops scheduling a habit after its end date and before its start date", () => {
    const out = schedule(input({ habits: [{ ...APPS, startDate: "2026-09-29", endDate: "2026-09-30" }] }));
    expect(out.blocks.map((b) => local(b.start).toISODate())).toEqual(["2026-09-29", "2026-09-30"]);
  });

  it("respects days of week", () => {
    const out = schedule(input({ habits: [{ ...GYM, daysOfWeek: [1, 3, 5] }] }));
    expect(out.blocks.map((b) => local(b.start).toFormat("ccc"))).toEqual(["Mon", "Wed", "Fri"]);
  });

  it("shrinks to the minimum when the window is tight", () => {
    const out = schedule(input({ horizonDays: 1, habits: [GYM], events: [{ id: "e", start: at("2026-09-28T18:00"), end: at("2026-09-28T23:00"), busy: true }] }));
    expect(out.blocks).toHaveLength(1);
    expect(hm(out.blocks[0].start)).toBe("Mon 23:00");
    expect(mins(out.blocks[0])).toBe(30);
    expect(out.blocks[0].reasoning).toMatch(/Shortened/);
  });

  it("moves outside the window rather than dropping gym, with a warning", () => {
    const out = schedule(input({ horizonDays: 1, habits: [GYM], events: [{ id: "e", start: at("2026-09-28T17:00"), end: at("2026-09-28T23:30"), busy: true }] }));
    expect(out.blocks).toHaveLength(1);
    expect(local(out.blocks[0].end).toFormat("HH:mm")).toBe("17:00"); // hugs the window from before
    expect(out.conflicts).toMatchObject([{ kind: "habit", severity: "warning" }]);
  });

  it("reports an error when there is truly no room for gym", () => {
    const out = schedule(input({ horizonDays: 1, habits: [GYM], events: [{ id: "e", start: at("2026-09-28T08:00"), end: at("2026-09-28T23:59"), busy: true }] }));
    expect(out.blocks).toHaveLength(0);
    expect(out.conflicts).toMatchObject([{ kind: "habit", habitId: "gym", severity: "error", shortfallMin: 30 }]);
  });

  it("gym is never displaced by assignment work, even with a crushing deadline", () => {
    const out = schedule(input({ horizonDays: 2, habits: [GYM], work: [work("big", "2026-09-29T23:59", 2400)], prefs: { ...input().prefs, dueBufferHours: 0, dailyWorkCapMin: 1440, maxBlockMin: 480 } }));
    expect(out.blocks.filter((b) => b.habitId === "gym")).toHaveLength(2);
    expect(out.conflicts.some((c) => c.workItemId === "big" && c.severity === "error")).toBe(true);
  });

  it("skips a habit already done today", () => {
    const out = schedule(
      input({
        horizonDays: 1,
        habits: [GYM],
        fixedBlocks: [{ id: "g", kind: "habit", habitId: "gym", start: at("2026-09-28T07:00"), end: at("2026-09-28T07:45"), status: "done", locked: false }],
      }),
    );
    expect(out.blocks).toHaveLength(0);
  });
});

describe("scheduler: assignments", () => {
  it("back-schedules into the days just before (due − buffer), not today", () => {
    const out = schedule(input({ work: [work("ps", "2026-10-02T23:59", 180)] }));
    const b = workFor(out.blocks, "ps");
    expect(total(b)).toBe(180);
    // deadline minus 24h buffer = Thu 23:59; work lands on Thu
    expect(new Set(b.map((x) => local(x.start).toFormat("ccc")))).toEqual(new Set(["Thu"]));
    expect(out.items[0]).toMatchObject({ status: "planned", placedMin: 180 });
  });

  it("splits work into sessions between the min and max block length", () => {
    const out = schedule(input({ work: [work("ps", "2026-10-03T23:59", 300)] }));
    const b = workFor(out.blocks, "ps");
    expect(total(b)).toBe(300);
    for (const x of b) {
      expect(mins(x)).toBeLessThanOrEqual(120);
      expect(mins(x)).toBeGreaterThanOrEqual(30);
    }
  });

  it("leaves a break between back-to-back sessions", () => {
    const out = schedule(input({ work: [work("ps", "2026-10-03T23:59", 240)] }));
    const b = workFor(out.blocks, "ps").sort((x, y) => x.start.localeCompare(y.start));
    for (let i = 1; i < b.length; i++) {
      if (local(b[i].start).hasSame(local(b[i - 1].start), "day")) expect(Date.parse(b[i].start) - Date.parse(b[i - 1].end)).toBeGreaterThanOrEqual(15 * 60000);
    }
  });

  it("respects the daily work cap across items", () => {
    const prefs = { ...input().prefs, dailyWorkCapMin: 120 };
    const out = schedule(input({ prefs, work: [work("a", "2026-10-04T23:59", 300), work("b", "2026-10-04T23:59", 300)] }));
    const perDay = new Map<string, number>();
    for (const b of out.blocks) perDay.set(local(b.start).toISODate()!, (perDay.get(local(b.start).toISODate()!) ?? 0) + mins(b));
    for (const v of perDay.values()) expect(v).toBeLessThanOrEqual(120);
  });

  it("only places work inside the day's hours", () => {
    const out = schedule(input({ work: [work("a", "2026-10-04T23:59", 1200)], prefs: { ...input().prefs, dailyWorkCapMin: 1440 } }));
    for (const b of out.blocks) {
      expect(local(b.start).toFormat("HH:mm") >= "08:00").toBe(true);
      expect(local(b.end).toFormat("HH:mm") <= "23:30" || local(b.end).toFormat("HH:mm") === "00:00").toBe(true);
    }
  });

  it("gives the nearer deadline the days it needs", () => {
    const prefs = { ...input().prefs, dailyWorkCapMin: 120, dueBufferHours: 0 };
    // a is due Wed night, b Thu night; each day holds 2h
    const out = schedule(input({ prefs, work: [work("b", "2026-10-01T23:59", 240), work("a", "2026-09-30T23:59", 240)] }));
    expect(out.conflicts).toEqual([]);
    for (const x of workFor(out.blocks, "a")) expect(Date.parse(x.end)).toBeLessThanOrEqual(Date.parse(at("2026-09-30T23:59")));
    for (const x of workFor(out.blocks, "b")) expect(Date.parse(x.end)).toBeLessThanOrEqual(Date.parse(at("2026-10-01T23:59")));
  });

  it("warns instead of dropping when capacity runs out, and accounts for every minute", () => {
    const prefs = { ...input().prefs, dailyWorkCapMin: 120 };
    const out = schedule(input({ prefs, work: [work("big", "2026-09-30T23:59", 600)] }));
    const placed = total(workFor(out.blocks, "big"));
    const c = out.conflicts.find((x) => x.workItemId === "big" && x.severity === "error")!;
    expect(c).toBeDefined();
    expect(placed + c.shortfallMin).toBe(600);
    expect(c.message).toMatch(/work limit/); // the cap, not the calendar, is what's binding
    expect(out.items[0].status).toBe("partial");
  });

  it("uses the buffer window when it must, with a warning", () => {
    const out = schedule(
      input({
        horizonDays: 3,
        now: at("2026-09-28T09:00"),
        // Mon is fully booked; due Tue 23:59 → buffer deadline Mon 23:59
        events: [{ id: "e", start: at("2026-09-28T08:00"), end: at("2026-09-28T23:59"), busy: true }],
        work: [work("q", "2026-09-29T23:59", 60)],
      }),
    );
    expect(total(workFor(out.blocks, "q"))).toBe(60);
    expect(out.conflicts).toMatchObject([{ workItemId: "q", severity: "warning" }]);
    expect(workFor(out.blocks, "q")[0].reasoning).toMatch(/buffer/);
  });

  it("schedules overdue work at the first free time, flagged", () => {
    const out = schedule(input({ work: [work("late", "2026-09-27T23:59", 90)] }));
    const b = workFor(out.blocks, "late").sort((x, y) => x.start.localeCompare(y.start));
    expect(hm(b[0].start)).toBe("Mon 09:00");
    expect(b[0].reasoning).toMatch(/was due/i);
    expect(out.items[0].status).toBe("overdue");
  });

  it("protects on-time work before placing overdue work", () => {
    const prefs = { ...input().prefs, dailyWorkCapMin: 120, dueBufferHours: 0 };
    const out = schedule(input({ horizonDays: 1, prefs, work: [work("late", "2026-09-27T23:59", 120), work("today", "2026-09-28T23:59", 120)] }));
    expect(total(workFor(out.blocks, "today"))).toBe(120);
    expect(out.conflicts.find((c) => c.workItemId === "late")).toBeDefined();
  });

  it("counts done blocks as progress and keeps locked blocks in place", () => {
    const fixedBlocks = [
      { id: "d", kind: "work" as const, workItemId: "ps", start: at("2026-09-27T10:00"), end: at("2026-09-27T11:00"), status: "done" as const, locked: false },
      { id: "l", kind: "work" as const, workItemId: "ps", start: at("2026-09-29T10:00"), end: at("2026-09-29T11:00"), status: "scheduled" as const, locked: true },
    ];
    const inp = input({ fixedBlocks, work: [work("ps", "2026-10-02T23:59", 180)] });
    const out = schedule(inp);
    expect(total(workFor(out.blocks, "ps"))).toBe(60); // 180 − 60 done − 60 locked
    assertNoOverlaps(inp, out.blocks);
  });

  it("an item that's already complete produces no blocks", () => {
    const out = schedule(input({ work: [work("ps", "2026-10-02T23:59", 60, { doneMin: 90 })] }));
    expect(out.blocks).toEqual([]);
    expect(out.items[0].status).toBe("complete");
  });

  it("ignores non-busy events", () => {
    const out = schedule(input({ horizonDays: 1, habits: [GYM], events: [{ id: "e", start: at("2026-09-28T18:00"), end: at("2026-09-28T23:30"), busy: false }] }));
    expect(hm(out.blocks[0].start)).toBe("Mon 18:00");
  });

  it("writes human reasoning on every block", () => {
    const out = schedule(input({ habits: [GYM], work: [work("ps", "2026-10-02T23:59", 200)] }));
    for (const b of out.blocks) expect(b.reasoning.length).toBeGreaterThan(10);
    expect(workFor(out.blocks, "ps")[0].reasoning).toMatch(/Session 1 of \d/);
  });
});

describe("scheduler: invariants", () => {
  it("never overlaps events, fixed blocks, or itself in a busy realistic week", () => {
    const events = [];
    for (let d = 0; d < 7; d++) {
      const day = DateTime.fromISO("2026-09-28", { zone: tz }).plus({ days: d });
      if (day.weekday <= 5) {
        events.push({ id: `lec${d}`, start: day.set({ hour: 10 }).toUTC().toISO()!, end: day.set({ hour: 11, minute: 15 }).toUTC().toISO()!, busy: true });
        events.push({ id: `work${d}`, start: day.set({ hour: 13 }).toUTC().toISO()!, end: day.set({ hour: 17 }).toUTC().toISO()!, busy: true });
      }
    }
    const inp = input({
      events,
      habits: [GYM, APPS],
      work: [work("a", "2026-09-30T23:59", 240), work("b", "2026-10-01T12:00", 360), work("c", "2026-10-03T23:59", 480), work("d", "2026-09-26T23:59", 60)],
    });
    const out = schedule(inp);
    assertNoOverlaps(inp, out.blocks);
    // every assignment minute is either placed or reported
    for (const it of out.items) {
      const short = out.conflicts.filter((c) => c.workItemId === it.workItemId && c.severity === "error").reduce((m, c) => m + c.shortfallMin, 0);
      expect(it.placedMin + short).toBe(it.remainingMin);
    }
  });

  it("handles the DST fall-back day", () => {
    const inp = input({ now: at("2026-10-31T09:00"), horizonDays: 3, habits: [GYM], work: [work("a", "2026-11-02T23:59", 120)] });
    const out = schedule(inp);
    expect(out.blocks.filter((b) => b.habitId === "gym").map((b) => local(b.start).toFormat("MM-dd HH:mm"))).toEqual(["10-31 18:00", "11-01 18:00", "11-02 18:00"]);
    expect(total(workFor(out.blocks, "a"))).toBe(120);
    assertNoOverlaps(inp, out.blocks);
  });
});
