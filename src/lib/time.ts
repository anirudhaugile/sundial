import { DateTime, Interval } from "luxon";

// All scheduling math happens in the user's zone. Timestamps are stored as UTC ISO strings.

export const DEFAULT_TZ = "America/Chicago";

export function isValidZone(tz: string) {
  return DateTime.local().setZone(tz).isValid;
}

export function nowIn(tz: string) {
  return DateTime.now().setZone(tz);
}

export function fromISO(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
}

/** Parse a `<input type="datetime-local">` value as wall-clock time in `tz`. */
export function fromLocalInput(value: string, tz: string) {
  const dt = DateTime.fromISO(value, { zone: tz });
  return dt.isValid ? dt : null;
}

/** "YYYY-MM-DDTHH:mm" in `tz`, for datetime-local inputs. */
export function toLocalInput(iso: string, tz: string) {
  return fromISO(iso, tz).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** ISO date (yyyy-mm-dd) in `tz`. */
export function isoDate(dt: DateTime) {
  return dt.toISODate()!;
}

export function dayRange(date: string, tz: string) {
  const start = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { start, end: start.plus({ days: 1 }) };
}

/** Monday-start week containing `date`. */
export function weekRange(date: string, tz: string) {
  const start = DateTime.fromISO(date, { zone: tz }).startOf("week");
  return { start, end: start.plus({ weeks: 1 }) };
}

/** 6-row grid covering the month containing `date` (Monday start). */
export function monthGrid(date: string, tz: string) {
  const month = DateTime.fromISO(date, { zone: tz }).startOf("month");
  const start = month.startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => start.plus({ days: i }));
  return { month, start, end: start.plus({ days: 42 }), days };
}

/** Parse "HH:mm" or "HH:mm:ss" to minutes after midnight. */
export function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTime(dt: DateTime) {
  return dt.minute === 0 ? dt.toFormat("h a").toLowerCase() : dt.toFormat("h:mm a").toLowerCase();
}

export function formatRange(start: DateTime, end: DateTime) {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Human due label relative to now: "today 11:59 pm", "tomorrow", "Thu", "Oct 12". */
export function formatDue(due: DateTime, now: DateTime) {
  const days = Math.round(due.startOf("day").diff(now.startOf("day"), "days").days);
  if (days === 0) return `today ${formatTime(due)}`;
  if (days === 1) return `tomorrow ${formatTime(due)}`;
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  if (days < 7) return due.toFormat("ccc") + " " + formatTime(due);
  return due.toFormat("LLL d");
}

export function greeting(now: DateTime) {
  const h = now.hour;
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function overlaps(a: Interval, b: Interval) {
  return a.overlaps(b);
}
