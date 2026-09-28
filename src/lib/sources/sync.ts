import "server-only";
import { DateTime } from "luxon";
import { decryptSecret } from "@/lib/crypto";
import type { DB } from "@/lib/data/queries";
import { contentHash } from "@/lib/hash";
import { COURSE_COLORS } from "@/lib/view";
import { fetchCanvas, htmlToText } from "./canvas";
import { fetchText, SourceError } from "./fetch";
import { canvasAssignmentId, parseIcs, splitCanvasSummary, type IcsInstance } from "./ical";

// Syncs are idempotent: every row is upserted on its natural key
// (user, source, external id). Items that vanish from a source inside the sync
// window are soft-removed, and come back if they reappear.

const LOOKBACK_DAYS = 14;

type Counts = { inserted: number; updated: number; removed: number };
export type SyncResult = { kind: string; ok: boolean; counts: Counts; error?: string };

type Ctx = {
  db: DB; // service-role client: always scope by user_id
  userId: string;
  tz: string;
  rangeStart: DateTime;
  rangeEnd: DateTime;
};

/** Sync every enabled source for one user. Uses the service-role client. */
export async function syncUser(db: DB, userId: string, only?: string): Promise<SyncResult[]> {
  const { data: profile } = await db.from("profiles").select("timezone, horizon_days").eq("id", userId).single();
  if (!profile) throw new Error("Profile missing");
  const now = DateTime.now().setZone(profile.timezone);
  const ctx: Ctx = {
    db,
    userId,
    tz: profile.timezone,
    rangeStart: now.startOf("day").minus({ days: LOOKBACK_DAYS }),
    rangeEnd: now.startOf("day").plus({ days: profile.horizon_days + 1 }),
  };

  let q = db.from("source_connections").select("*").eq("user_id", userId).eq("enabled", true);
  if (only) q = q.eq("id", only);
  const { data: conns } = await q;
  const results: SyncResult[] = [];
  const hasCanvasApi = (conns ?? []).some((c) => c.kind === "canvas_api");

  // Canvas API first so the iCal fallback can defer to it
  const ordered = [...(conns ?? [])].sort((a, b) => order(a.kind) - order(b.kind));
  for (const conn of ordered) {
    const { data: run } = await db.from("sync_runs").insert({ user_id: userId, connection_id: conn.id }).select("id").single();
    let result: SyncResult;
    try {
      const { data: secretRow } = await db.from("source_secrets").select("ciphertext").eq("connection_id", conn.id).eq("user_id", userId).single();
      if (!secretRow) throw new SourceError("No token saved for this source.");
      const secret = decryptSecret(secretRow.ciphertext);
      const counts =
        conn.kind === "canvas_api"
          ? await syncCanvasApi(ctx, conn.base_url!, secret)
          : conn.kind === "canvas_ical"
            ? await syncCanvasIcal(ctx, secret, { assignments: !hasCanvasApi })
            : await syncOutlook(ctx, secret);
      result = { kind: conn.kind, ok: true, counts };
    } catch (e) {
      const message = e instanceof SourceError ? e.message : e instanceof Error ? `Sync failed: ${e.message}` : "Sync failed";
      result = { kind: conn.kind, ok: false, counts: { inserted: 0, updated: 0, removed: 0 }, error: message };
    }
    await db
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), ...result.counts, error: result.error ?? null })
      .eq("id", run!.id);
    await db
      .from("source_connections")
      .update(result.ok ? { last_synced_at: new Date().toISOString(), last_error: null } : { last_error: result.error })
      .eq("id", conn.id);
    results.push(result);
  }
  return results;
}

const order = (k: string) => (k === "canvas_api" ? 0 : k === "canvas_ical" ? 1 : 2);

// ---------------------------------------------------------------------------
// courses
// ---------------------------------------------------------------------------

async function upsertCourses(ctx: Ctx, rows: { externalId: string; name: string; code: string | null }[]) {
  const { data: existing } = await ctx.db.from("courses").select("id, external_id, color").eq("user_id", ctx.userId);
  const byExt = new Map((existing ?? []).map((c) => [c.external_id, c]));
  const used = new Set((existing ?? []).map((c) => c.color));
  const nextColor = () => {
    const free = COURSE_COLORS.find((c) => !used.has(c)) ?? COURSE_COLORS[used.size % COURSE_COLORS.length];
    used.add(free);
    return free;
  };
  const payload = rows.map((r) => ({
    user_id: ctx.userId,
    source: "canvas",
    external_id: r.externalId,
    name: r.name,
    code: r.code,
    // keep the color you picked; only new courses get one assigned
    color: byExt.get(r.externalId)?.color ?? nextColor(),
  }));
  if (!payload.length) return new Map<string, { id: string; name: string }>();
  const { data, error } = await ctx.db.from("courses").upsert(payload, { onConflict: "user_id,source,external_id" }).select("id, external_id, name, code");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((c) => [c.external_id!, { id: c.id, name: c.code || c.name }]));
}

// ---------------------------------------------------------------------------
// work items
// ---------------------------------------------------------------------------

type ItemRow = {
  externalId: string;
  title: string;
  description: string | null;
  points: number | null;
  dueAt: string;
  url: string | null;
  courseId: string | null;
  courseName: string | null;
  submittedAt?: string | null;
};

async function upsertWorkItems(ctx: Ctx, rows: ItemRow[]): Promise<Counts> {
  const { data: existing } = await ctx.db
    .from("work_items")
    .select("id, external_id, status, removed_at, due_at")
    .eq("user_id", ctx.userId)
    .eq("source", "canvas");
  const byExt = new Map((existing ?? []).map((w) => [w.external_id, w]));
  const counts: Counts = { inserted: 0, updated: 0, removed: 0 };

  const payload = rows.map((r) => {
    if (byExt.has(r.externalId)) counts.updated++;
    else counts.inserted++;
    return {
      user_id: ctx.userId,
      source: "canvas",
      external_id: r.externalId,
      kind: "assignment",
      title: r.title,
      description: r.description,
      points: r.points,
      due_at: r.dueAt,
      url: r.url,
      course_id: r.courseId,
      content_hash: contentHash({ title: r.title, description: r.description, points: r.points, courseName: r.courseName }),
      removed_at: null,
    };
  });
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await ctx.db.from("work_items").upsert(payload.slice(i, i + 200), { onConflict: "user_id,source,external_id" });
    if (error) throw new Error(error.message);
  }

  // submitted in Canvas → done here (never reopen something you checked off)
  const submitted = rows.filter((r) => r.submittedAt && byExt.get(r.externalId)?.status !== "done");
  for (const r of submitted) {
    await ctx.db
      .from("work_items")
      .update({ status: "done", completed_at: r.submittedAt })
      .eq("user_id", ctx.userId)
      .eq("source", "canvas")
      .eq("external_id", r.externalId)
      .eq("status", "open");
  }

  // anything in the window we didn't see this time has been deleted upstream
  const seen = new Set(rows.map((r) => r.externalId));
  const gone = (existing ?? []).filter(
    (w) =>
      !seen.has(w.external_id ?? "") &&
      !w.removed_at &&
      w.due_at &&
      Date.parse(w.due_at) >= ctx.rangeStart.toMillis() &&
      Date.parse(w.due_at) < ctx.rangeEnd.toMillis(),
  );
  if (gone.length) {
    await ctx.db.from("work_items").update({ removed_at: new Date().toISOString() }).in("id", gone.map((w) => w.id));
    counts.removed = gone.length;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

async function upsertEvents(ctx: Ctx, source: "outlook" | "canvas", items: IcsInstance[]): Promise<Counts> {
  const { data: existing } = await ctx.db
    .from("events")
    .select("id, external_uid, instance_start, removed_at")
    .eq("user_id", ctx.userId)
    .eq("source", source)
    .gte("starts_at", ctx.rangeStart.toUTC().toISO()!)
    .lt("starts_at", ctx.rangeEnd.toUTC().toISO()!);
  const key = (uid: string | null, inst: string | null): string => `${uid}|${inst ? Date.parse(inst) : ""}`;
  const have = new Map((existing ?? []).map((e) => [key(e.external_uid, e.instance_start), e] as const));
  const counts: Counts = { inserted: 0, updated: 0, removed: 0 };

  // the same occurrence can appear twice in sloppy feeds; last one wins
  const unique = new Map(items.map((i) => [key(i.uid, i.instanceStart), i]));
  const payload = [...unique.values()].map((i) => {
    if (have.has(key(i.uid, i.instanceStart))) counts.updated++;
    else counts.inserted++;
    return {
      user_id: ctx.userId,
      source,
      kind: "event",
      external_uid: i.uid,
      instance_start: i.instanceStart,
      title: i.title,
      location: i.location,
      starts_at: i.start,
      ends_at: i.end,
      all_day: i.allDay,
      busy: i.busy,
      removed_at: null,
    };
  });
  for (let i = 0; i < payload.length; i += 300) {
    const { error } = await ctx.db.from("events").upsert(payload.slice(i, i + 300), { onConflict: "user_id,source,external_uid,instance_start" });
    if (error) throw new Error(error.message);
  }

  const seen = new Set(unique.keys());
  const gone = (existing ?? []).filter((e) => !e.removed_at && !seen.has(key(e.external_uid, e.instance_start)));
  if (gone.length) {
    await ctx.db.from("events").update({ removed_at: new Date().toISOString() }).in("id", gone.map((e) => e.id));
    counts.removed = gone.length;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

async function syncCanvasApi(ctx: Ctx, base: string, token: string): Promise<Counts> {
  const { courses, assignments } = await fetchCanvas(base, token);
  const courseMap = await upsertCourses(
    ctx,
    courses.map((c) => ({ externalId: String(c.id), name: c.name, code: c.course_code || null })),
  );
  const rows: ItemRow[] = [];
  for (const a of assignments) {
    if (!a.due_at) continue;
    const due = Date.parse(a.due_at);
    if (due < ctx.rangeStart.toMillis() || due >= ctx.rangeEnd.toMillis()) continue;
    const course = courseMap.get(String(a.course_id));
    const state = a.submission?.workflow_state;
    rows.push({
      externalId: String(a.id),
      title: a.name,
      description: htmlToText(a.description),
      points: a.points_possible ?? null,
      dueAt: new Date(due).toISOString(),
      url: a.html_url,
      courseId: course?.id ?? null,
      courseName: course?.name ?? null,
      submittedAt: state === "submitted" || state === "graded" || state === "pending_review" ? (a.submission?.submitted_at ?? new Date().toISOString()) : null,
    });
  }
  return upsertWorkItems(ctx, rows);
}

async function loadFeed(ctx: Ctx, url: string) {
  const { text } = await fetchText(url, { headers: { Accept: "text/calendar, text/plain, */*" } });
  if (!text.includes("BEGIN:VCALENDAR")) throw new SourceError("That link didn't return a calendar (.ics) file.");
  try {
    return parseIcs(text, { rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd, fallbackTz: ctx.tz });
  } catch {
    throw new SourceError("Couldn't read that calendar file.");
  }
}

async function syncCanvasIcal(ctx: Ctx, url: string, opts: { assignments: boolean }): Promise<Counts> {
  const instances = await loadFeed(ctx, url);
  const assignments = instances.filter((i) => canvasAssignmentId(i.uid));
  const others = instances.filter((i) => !canvasAssignmentId(i.uid));
  const eventCounts = await upsertEvents(ctx, "canvas", others);
  if (!opts.assignments) return eventCounts; // the Canvas API connection owns assignments

  const courseNames = [...new Set(assignments.map((a) => splitCanvasSummary(a.title).course).filter((c): c is string => !!c))];
  const courseMap = await upsertCourses(ctx, courseNames.map((n) => ({ externalId: `ical:${n}`, name: n, code: n })));
  const rows: ItemRow[] = assignments.map((a) => {
    const { title, course } = splitCanvasSummary(a.title);
    // all-day assignment entries are due at the end of that day
    const due = a.allDay ? DateTime.fromISO(a.start).setZone(ctx.tz).set({ hour: 23, minute: 59 }).toUTC().toISO()! : a.start;
    return {
      externalId: canvasAssignmentId(a.uid)!,
      title,
      description: a.description,
      points: null,
      dueAt: due,
      url: a.url,
      courseId: course ? (courseMap.get(`ical:${course}`)?.id ?? null) : null,
      courseName: course,
    };
  });
  const c = await upsertWorkItems(ctx, rows);
  return { inserted: c.inserted + eventCounts.inserted, updated: c.updated + eventCounts.updated, removed: c.removed + eventCounts.removed };
}

async function syncOutlook(ctx: Ctx, url: string): Promise<Counts> {
  return upsertEvents(ctx, "outlook", await loadFeed(ctx, url));
}
