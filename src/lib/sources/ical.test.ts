import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { canvasAssignmentId, parseIcs, splitCanvasSummary } from "./ical";

const tz = "America/Chicago";
const range = { rangeStart: DateTime.fromISO("2026-09-28T00:00", { zone: tz }), rangeEnd: DateTime.fromISO("2026-10-12T00:00", { zone: tz }), fallbackTz: tz };
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}\r\nEND:VCALENDAR\r\n`;

const OUTLOOK_TZ = `BEGIN:VTIMEZONE
TZID:Central Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE`;

describe("parseIcs", () => {
  it("expands a weekly Outlook meeting with an exception and an EXDATE", () => {
    const ics = wrap(`${OUTLOOK_TZ}
BEGIN:VEVENT
UID:standup-1
SUMMARY:Team standup
DTSTART;TZID=Central Standard Time:20260901T100000
DTEND;TZID=Central Standard Time:20260901T103000
RRULE:FREQ=WEEKLY;BYDAY=TU,TH
EXDATE;TZID=Central Standard Time:20261001T100000
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:standup-1
RECURRENCE-ID;TZID=Central Standard Time:20261006T100000
SUMMARY:Team standup (moved)
DTSTART;TZID=Central Standard Time:20261006T140000
DTEND;TZID=Central Standard Time:20261006T143000
END:VEVENT`);
    const out = parseIcs(ics, range);
    const local = out.map((o) => `${DateTime.fromISO(o.start).setZone(tz).toFormat("LLL dd HH:mm")} ${o.title}`);
    expect(local).toEqual([
      "Sep 29 10:00 Team standup",
      // Oct 1 removed by EXDATE
      "Oct 06 14:00 Team standup (moved)",
      "Oct 08 10:00 Team standup",
    ]);
    // the moved instance keeps its original slot as a stable key
    expect(DateTime.fromISO(out[1].instanceStart).setZone(tz).toFormat("LLL dd HH:mm")).toBe("Oct 06 10:00");
    expect(out.every((o) => o.busy)).toBe(true);
  });

  it("walks long-running series to the current range", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:daily
SUMMARY:Daily
DTSTART:20190101T150000Z
DTEND:20190101T151500Z
RRULE:FREQ=DAILY
END:VEVENT`);
    expect(parseIcs(ics, range)).toHaveLength(14);
  });

  it("marks free, transparent and all-day items as not busy", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:a
SUMMARY:Lunch (tentative free)
DTSTART:20260929T170000Z
DTEND:20260929T180000Z
X-MICROSOFT-CDO-BUSYSTATUS:FREE
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261001
DTEND;VALUE=DATE:20261002
END:VEVENT
BEGIN:VEVENT
UID:c
SUMMARY:Reminder
DTSTART:20260930T170000Z
DTEND:20260930T180000Z
TRANSP:TRANSPARENT
END:VEVENT`);
    const out = parseIcs(ics, range);
    expect(out.map((o) => [o.uid, o.busy, o.allDay])).toEqual([
      ["a", false, false],
      ["c", false, false],
      ["b", false, true],
    ]);
  });

  it("interprets floating times and unknown TZIDs in the user's zone", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:f
SUMMARY:Floating
DTSTART:20260930T090000
DTEND:20260930T100000
END:VEVENT
BEGIN:VEVENT
UID:g
SUMMARY:IANA without VTIMEZONE
DTSTART;TZID=America/New_York:20260930T090000
DTEND;TZID=America/New_York:20260930T100000
END:VEVENT`);
    const out = parseIcs(ics, range);
    const f = out.find((o) => o.uid === "f")!;
    const g = out.find((o) => o.uid === "g")!;
    expect(DateTime.fromISO(f.start).setZone(tz).toFormat("HH:mm")).toBe("09:00");
    expect(DateTime.fromISO(g.start).setZone(tz).toFormat("HH:mm")).toBe("08:00");
  });

  it("skips cancelled events and events outside the range", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:x
SUMMARY:Cancelled
STATUS:CANCELLED
DTSTART:20260930T170000Z
DTEND:20260930T180000Z
END:VEVENT
BEGIN:VEVENT
UID:y
SUMMARY:Far future
DTSTART:20270101T170000Z
DTEND:20270101T180000Z
END:VEVENT`);
    expect(parseIcs(ics, range)).toEqual([]);
  });
});

describe("canvas helpers", () => {
  it("extracts assignment ids and course names", () => {
    expect(canvasAssignmentId("event-assignment-48213")).toBe("48213");
    expect(canvasAssignmentId("event-calendar-event-9")).toBeNull();
    expect(splitCanvasSummary("MP2: Linked lists [CS 225 AL1]")).toEqual({ title: "MP2: Linked lists", course: "CS 225 AL1" });
    expect(splitCanvasSummary("Office hours")).toEqual({ title: "Office hours", course: null });
  });
});
