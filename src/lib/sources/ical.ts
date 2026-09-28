import ICAL from "ical.js";
import { DateTime } from "luxon";

/** One concrete occurrence from an iCalendar feed. */
export type IcsInstance = {
  uid: string;
  instanceStart: string; // UTC ISO of the occurrence's original start; stable per occurrence
  title: string;
  description: string | null;
  location: string | null;
  start: string; // UTC ISO
  end: string; // UTC ISO
  allDay: boolean;
  busy: boolean;
  url: string | null;
};

// Outlook often emits Windows zone names; map the common ones when no VTIMEZONE resolves them.
const WINDOWS_ZONES: Record<string, string> = {
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney",
  UTC: "UTC",
};

function resolveZone(tzid: string | null | undefined, fallback: string) {
  if (!tzid) return fallback;
  const clean = tzid.replace(/^\/+/, "").replace(/^"|"$/g, "");
  if (DateTime.local().setZone(clean).isValid) return clean;
  return WINDOWS_ZONES[clean] ?? fallback;
}

/** Convert an ICAL.Time to an absolute instant, honouring floating and unknown zones. */
function toInstant(t: ICAL.Time, tzid: string | null, fallbackTz: string): DateTime {
  const zone = t.zone;
  const registered = zone && zone !== ICAL.Timezone.localTimezone && zone.tzid !== "floating";
  if (t.isDate) return DateTime.fromObject({ year: t.year, month: t.month, day: t.day }, { zone: resolveZone(tzid, fallbackTz) });
  if (registered) return DateTime.fromMillis(t.toUnixTime() * 1000, { zone: "utc" });
  return DateTime.fromObject(
    { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second },
    { zone: resolveZone(tzid, fallbackTz) },
  );
}

function isBusy(v: ICAL.Component, allDay: boolean) {
  const ms = String(v.getFirstPropertyValue("x-microsoft-cdo-busystatus") ?? "").toUpperCase();
  if (ms) return ms !== "FREE";
  const transp = String(v.getFirstPropertyValue("transp") ?? "").toUpperCase();
  if (transp === "TRANSPARENT") return false;
  if (String(v.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return false;
  return !allDay; // all-day entries (holidays, reminders) don't block time unless marked busy
}

const text = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/**
 * Parse a feed and expand recurrences into concrete occurrences that overlap
 * [rangeStart, rangeEnd). Exceptions (RECURRENCE-ID) and EXDATEs are honoured.
 */
export function parseIcs(raw: string, opts: { rangeStart: DateTime; rangeEnd: DateTime; fallbackTz: string; maxInstances?: number }): IcsInstance[] {
  const root = new ICAL.Component(ICAL.parse(raw));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // malformed VTIMEZONE; floating fallback applies
    }
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of vevents) {
    const ev = new ICAL.Event(v);
    if (!ev.uid) continue;
    if (v.hasProperty("recurrence-id")) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  const orphans: ICAL.Event[] = [];
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else orphans.push(ex);
  }

  const startMs = opts.rangeStart.toMillis();
  const endMs = opts.rangeEnd.toMillis();
  const max = opts.maxInstances ?? 2000;
  const out: IcsInstance[] = [];

  const push = (ev: ICAL.Event, startT: ICAL.Time, endT: ICAL.Time, recurrenceT: ICAL.Time, item: ICAL.Event) => {
    const comp = item.component;
    const tzid = comp.getFirstProperty("dtstart")?.getParameter("tzid") as string | null;
    const allDay = startT.isDate;
    const s = toInstant(startT, tzid, opts.fallbackTz);
    let e = endT ? toInstant(endT, tzid, opts.fallbackTz) : s.plus(allDay ? { days: 1 } : { minutes: 0 });
    if (e <= s) e = allDay ? s.plus({ days: 1 }) : s.plus({ minutes: 1 });
    if (e.toMillis() <= startMs || s.toMillis() >= endMs) return;
    if (String(comp.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    out.push({
      uid: ev.uid,
      instanceStart: toInstant(recurrenceT, tzid, opts.fallbackTz).toUTC().toISO()!,
      title: text(item.summary) ?? "(no title)",
      description: text(item.description),
      location: text(item.location),
      start: s.toUTC().toISO()!,
      end: e.toUTC().toISO()!,
      allDay,
      busy: isBusy(comp, allDay),
      url: text(comp.getFirstPropertyValue("url")),
    });
  };

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate, ev.startDate, ev);
      continue;
    }
    const it = ev.iterator();
    const tzid = ev.component.getFirstProperty("dtstart")?.getParameter("tzid") as string | null;
    // old series (e.g. daily since 2019) are walked cheaply up to the range; only in-range hits count toward `max`
    let steps = 0;
    const before = out.length;
    for (let next = it.next(); next && steps < 100_000 && out.length - before < max; next = it.next(), steps++) {
      if (toInstant(next, tzid, opts.fallbackTz).toMillis() >= endMs) break;
      const d = ev.getOccurrenceDetails(next);
      push(ev, d.startDate, d.endDate, d.recurrenceId, d.item);
    }
  }
  for (const ex of orphans) push(ex, ex.startDate, ex.endDate, ex.recurrenceId, ex);

  return out.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
}

/** Canvas calendar feeds mark assignments with UIDs like `event-assignment-12345`. */
export function canvasAssignmentId(uid: string) {
  return uid.match(/assignment-(\d+)/)?.[1] ?? null;
}

/** Canvas puts the course in brackets at the end of the summary: "HW 3 [CS 225]". */
export function splitCanvasSummary(summary: string) {
  const m = summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return m ? { title: m[1], course: m[2] } : { title: summary, course: null };
}
