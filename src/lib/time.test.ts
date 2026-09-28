import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { dayRange, formatDue, formatDuration, fromLocalInput, monthGrid, timeToMinutes, weekRange } from "./time";

const tz = "America/Chicago";

describe("time utils", () => {
  it("interprets datetime-local input in the user's zone", () => {
    expect(fromLocalInput("2026-09-28T14:00", tz)!.toUTC().toISO()).toBe("2026-09-28T19:00:00.000Z");
  });

  it("weeks start on Monday", () => {
    const { start, end } = weekRange("2026-10-01", tz);
    expect(start.toISODate()).toBe("2026-09-28");
    expect(end.toISODate()).toBe("2026-10-05");
  });

  it("day range survives the fall DST change (25-hour day)", () => {
    const { start, end } = dayRange("2026-11-01", tz);
    expect(end.diff(start, "hours").hours).toBe(25);
  });

  it("month grid is always 42 days starting Monday", () => {
    const g = monthGrid("2026-09-15", tz);
    expect(g.days).toHaveLength(42);
    expect(g.days[0].weekday).toBe(1);
    expect(g.days[0].toISODate()).toBe("2026-08-31");
  });

  it("formats durations and due dates", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
    const now = DateTime.fromISO("2026-09-28T10:00", { zone: tz });
    expect(formatDue(DateTime.fromISO("2026-09-28T23:59", { zone: tz }), now)).toBe("today 11:59 pm");
    expect(formatDue(DateTime.fromISO("2026-09-29T09:00", { zone: tz }), now)).toBe("tomorrow 9 am");
    expect(formatDue(DateTime.fromISO("2026-10-20T09:00", { zone: tz }), now)).toBe("Oct 20");
  });

  it("parses clock times", () => {
    expect(timeToMinutes("23:30:00")).toBe(1410);
  });
});
