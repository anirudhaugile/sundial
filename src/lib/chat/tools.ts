import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { z } from "zod";
import type { DB, Profile } from "@/lib/data/queries";
import { ensureEstimates } from "@/lib/llm/estimate";
import { resolveEstimates } from "@/lib/planner/estimates";
import { createProposal } from "@/lib/planner/run";
import { habitSchema, preferencesSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDuration, fromLocalInput, timeToMinutes } from "@/lib/time";

// Every change the chat makes goes through one of these, runs as the signed-in
// user (RLS applies), and is recorded as a visible tool call. Mutations carry the
// data needed to undo them. None of them place work blocks: rerun_scheduler asks
// the deterministic scheduler for a proposal that the user reviews.

export type ToolCtx = { db: DB; userId: string; profile: Profile; tz: string };
export type ToolOutcome = {
  result: unknown; // what the model sees
  summary: string; // one line for the tool card
  status: "read" | "applied" | "proposed";
  undo?: Record<string, unknown>;
  link?: string;
};

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use local time as YYYY-MM-DDTHH:mm");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const noWorkWindow = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).describe("ISO weekdays, 1 = Monday … 7 = Sunday"),
  start: hhmm.describe("HH:mm"),
  end: hhmm.describe("HH:mm; 00:00 means midnight"),
  label: z.string().max(60).optional(),
});

const fmt = (iso: string, tz: string) => DateTime.fromISO(iso).setZone(tz);
const human = (iso: string, tz: string) => fmt(iso, tz).toFormat("ccc LLL d, h:mm a");
const localStr = (iso: string, tz: string) => fmt(iso, tz).toFormat("yyyy-LL-dd'T'HH:mm");

function toolError(message: string): never {
  throw new ToolInputError(message);
}
export class ToolInputError extends Error {}

type Def<S extends z.ZodType> = {
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolCtx) => Promise<ToolOutcome>;
};
const def = <S extends z.ZodType>(d: Def<S>) => d;

export const TOOLS = {
  read_schedule: def({
    description:
      "Read the student's calendar for a date range: fixed events, scheduled work and habit blocks (with ids), and deadlines. Use this before moving anything or when asked about their day or week.",
    schema: z.object({ start_date: isoDay, end_date: isoDay.describe("Inclusive; at most 14 days after start_date") }),
    async run({ start_date, end_date }, { db, tz }) {
      const start = DateTime.fromISO(start_date, { zone: tz }).startOf("day");
      let end = DateTime.fromISO(end_date, { zone: tz }).endOf("day");
      if (!start.isValid || !end.isValid || end < start) toolError("Invalid date range");
      if (end.diff(start, "days").days > 14) end = start.plus({ days: 14 }).endOf("day");
      const s = start.toUTC().toISO()!;
      const e = end.toUTC().toISO()!;
      const [events, blocks, due] = await Promise.all([
        db.from("events").select("id, title, starts_at, ends_at, busy, kind, source").is("removed_at", null).lt("starts_at", e).gt("ends_at", s).order("starts_at"),
        db.from("blocks").select("id, kind, title, starts_at, ends_at, status, locked").in("status", ["scheduled", "done"]).lt("starts_at", e).gt("ends_at", s).order("starts_at"),
        db.from("work_items").select("id, title, due_at, status").is("removed_at", null).gte("due_at", s).lt("due_at", e).order("due_at"),
      ]);
      const days: Record<string, string[]> = {};
      const push = (iso: string, line: string) => (days[fmt(iso, tz).toISODate()!] ??= []).push(line);
      for (const ev of events.data ?? [])
        push(ev.starts_at, `${fmt(ev.starts_at, tz).toFormat("HH:mm")}-${fmt(ev.ends_at, tz).toFormat("HH:mm")} ${ev.kind === "unavailable" ? "UNAVAILABLE" : "event"}: ${ev.title}${ev.busy ? "" : " (free)"}`);
      for (const b of blocks.data ?? [])
        push(b.starts_at, `${fmt(b.starts_at, tz).toFormat("HH:mm")}-${fmt(b.ends_at, tz).toFormat("HH:mm")} ${b.kind} block [id ${b.id}]: ${b.title}${b.locked ? " (locked)" : ""}${b.status === "done" ? " (done)" : ""}`);
      for (const w of due.data ?? []) push(w.due_at!, `DUE ${fmt(w.due_at!, tz).toFormat("HH:mm")} [item ${w.id}]: ${w.title}${w.status === "done" ? " (done)" : ""}`);
      for (const k of Object.keys(days)) days[k].sort();
      return {
        result: { timezone: tz, days },
        summary: `Read your calendar, ${start.toFormat("ccc LLL d")}${end.hasSame(start, "day") ? "" : ` – ${end.toFormat("ccc LLL d")}`}`,
        status: "read",
      };
    },
  }),

  find_free_time: def({
    description: "List free gaps on one day, inside the student's day hours, after events and existing blocks.",
    schema: z.object({ date: isoDay, min_minutes: z.number().int().min(15).max(480).optional() }),
    async run({ date, min_minutes = 30 }, { db, tz, profile }) {
      const day = DateTime.fromISO(date, { zone: tz }).startOf("day");
      const from = day.plus({ minutes: timeToMinutes(profile.day_start) });
      const to = day.plus({ minutes: timeToMinutes(profile.day_end) });
      const s = from.toUTC().toISO()!;
      const e = to.toUTC().toISO()!;
      const [events, blocks] = await Promise.all([
        db.from("events").select("starts_at, ends_at").eq("busy", true).is("removed_at", null).lt("starts_at", e).gt("ends_at", s),
        db.from("blocks").select("starts_at, ends_at").in("status", ["scheduled", "done"]).lt("starts_at", e).gt("ends_at", s),
      ]);
      const busy = [...(events.data ?? []), ...(blocks.data ?? [])]
        .map((b) => [Math.max(Date.parse(b.starts_at), from.toMillis()), Math.min(Date.parse(b.ends_at), to.toMillis())] as const)
        .sort((a, b) => a[0] - b[0]);
      const gaps: string[] = [];
      let cursor = Math.max(from.toMillis(), Date.now());
      for (const [bs, be] of [...busy, [to.toMillis(), to.toMillis()] as const]) {
        if (bs - cursor >= min_minutes * 60000) {
          gaps.push(`${DateTime.fromMillis(cursor).setZone(tz).toFormat("HH:mm")}-${DateTime.fromMillis(bs).setZone(tz).toFormat("HH:mm")} (${formatDuration((bs - cursor) / 60000)})`);
        }
        cursor = Math.max(cursor, be);
      }
      return { result: { date, gaps }, summary: `Looked for free time on ${day.toFormat("ccc LLL d")}`, status: "read" };
    },
  }),

  list_assignments: def({
    description: "List open assignments with ids, course, due time, the estimate the planner uses (and whether it's the student's, AI, or default), and how much work is already scheduled.",
    schema: z.object({ include_done: z.boolean().optional() }),
    async run({ include_done }, { db, tz, userId }) {
      let q = db.from("work_items").select("*").is("removed_at", null).not("due_at", "is", null).order("due_at").limit(60);
      if (!include_done) q = q.eq("status", "open");
      const { data: items } = await q;
      const list = items ?? [];
      const [estimates, { data: courses }, { data: blocks }] = await Promise.all([
        resolveEstimates(db, list, { userId }),
        db.from("courses").select("id, name, code"),
        list.length ? db.from("blocks").select("work_item_id, starts_at, ends_at").in("status", ["scheduled"]).gt("ends_at", new Date().toISOString()).in("work_item_id", list.map((w) => w.id)) : Promise.resolve({ data: [] }),
      ]);
      const cname = new Map((courses ?? []).map((c) => [c.id, c.code || c.name]));
      const planned = new Map<string, number>();
      for (const b of blocks ?? []) planned.set(b.work_item_id!, (planned.get(b.work_item_id!) ?? 0) + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000);
      return {
        result: list.map((w) => {
          const e = estimates.get(w.id)!;
          return {
            id: w.id,
            title: w.title,
            course: w.course_id ? cname.get(w.course_id) : null,
            due: localStr(w.due_at!, tz),
            status: w.status,
            estimate_hours: e.hours,
            estimate_source: e.origin,
            estimate_reason: e.reasoning,
            planned_minutes_ahead: Math.round(planned.get(w.id) ?? 0),
          };
        }),
        summary: `Looked over ${list.length} assignment${list.length === 1 ? "" : "s"}`,
        status: "read",
      };
    },
  }),

  move_block: def({
    description:
      "Move one existing work or habit block to a new time, only when the student explicitly asks to move that block. Moving locks it so re-planning won't move it back. Applies immediately; the student can undo.",
    schema: z.object({ block_id: z.string().uuid(), start: localTime, end: localTime.optional().describe("Defaults to keeping the same length") }),
    async run({ block_id, start, end }, { db, tz }) {
      const { data: b } = await db.from("blocks").select("*").eq("id", block_id).single();
      if (!b) toolError("No block with that id. Read the schedule first.");
      if (b.status !== "scheduled") toolError(`That block is ${b.status}; only scheduled blocks can be moved.`);
      const s = fromLocalInput(start, tz);
      if (!s) toolError("Invalid start time");
      const len = Date.parse(b.ends_at) - Date.parse(b.starts_at);
      const e = end ? fromLocalInput(end, tz) : s.plus({ milliseconds: len });
      if (!e || e <= s) toolError("End must be after start");
      const { data: clash } = await db
        .from("events")
        .select("title")
        .eq("busy", true)
        .is("removed_at", null)
        .lt("starts_at", e.toUTC().toISO()!)
        .gt("ends_at", s.toUTC().toISO()!);
      const { error } = await db.from("blocks").update({ starts_at: s.toUTC().toISO()!, ends_at: e.toUTC().toISO()!, locked: true }).eq("id", block_id);
      if (error) toolError(error.message);
      return {
        result: { moved: true, now: `${localStr(s.toISO()!, tz)} to ${localStr(e.toISO()!, tz)}`, overlaps_events: (clash ?? []).map((c) => c.title) },
        summary: `Moved ${b.title} to ${s.toFormat("ccc h:mm a")}`,
        status: "applied",
        undo: { block_id, starts_at: b.starts_at, ends_at: b.ends_at, locked: b.locked },
      };
    },
  }),

  mark_unavailable: def({
    description:
      "Block off time when the student can't work (sick, travel, an appointment). Creates an 'unavailable' event that the scheduler treats as busy. Applies immediately; usually follow it with rerun_scheduler so work moves out of that time.",
    schema: z.object({ start: localTime, end: localTime, reason: z.string().min(1).max(80) }),
    async run({ start, end, reason }, { db, tz, userId }) {
      const s = fromLocalInput(start, tz);
      const e = fromLocalInput(end, tz);
      if (!s || !e || e <= s) toolError("End must be after start");
      if (e.diff(s, "days").days > 14) toolError("Keep it under two weeks at a time");
      const { data: ev, error } = await db
        .from("events")
        .insert({ user_id: userId, source: "manual", kind: "unavailable", title: reason, starts_at: s.toUTC().toISO()!, ends_at: e.toUTC().toISO()!, busy: true })
        .select("id")
        .single();
      if (error || !ev) toolError(error?.message ?? "Couldn't save");
      const { count } = await db
        .from("blocks")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .lt("starts_at", e.toUTC().toISO()!)
        .gt("ends_at", s.toUTC().toISO()!);
      const sameDay = s.hasSame(e, "day");
      return {
        result: { created: true, blocks_now_overlapping: count ?? 0, hint: count ? "Call rerun_scheduler to move work out of this time." : undefined },
        summary: `Marked you unavailable ${sameDay ? `${s.toFormat("ccc h:mm a")} – ${e.toFormat("h:mm a")}` : `${s.toFormat("ccc h:mm a")} – ${e.toFormat("ccc h:mm a")}`} (${reason})`,
        status: "applied",
        undo: { event_id: ev.id },
      };
    },
  }),

  rerun_scheduler: def({
    description:
      "Ask the deterministic scheduler to draft a fresh plan from the current inputs. It does not change the calendar: the student reviews and approves the proposal on the Plan page. Call this after changing inputs.",
    schema: z.object({}),
    async run(_input, { db, userId, tz }) {
      await ensureEstimates(createAdminClient(), userId);
      const { output } = await createProposal(db, userId, "chat");
      const errors = output.conflicts.filter((c) => c.severity === "error");
      return {
        result: {
          proposal_ready: true,
          review_at: "/plan",
          work_hours: Math.round(output.stats.workMin / 6) / 10,
          sessions: output.blocks.filter((b) => b.kind === "work").length,
          conflicts: output.conflicts.map((c) => `${c.severity}: ${c.message}`),
          next_sessions: output.blocks
            .filter((b) => b.kind === "work")
            .slice(0, 6)
            .map((b) => `${human(b.start, tz)}: ${b.title}`),
        },
        summary: `Drafted a new plan${errors.length ? ` · ${errors.length} conflict${errors.length > 1 ? "s" : ""}` : ""}`,
        status: "proposed",
        link: "/plan",
      };
    },
  }),

  update_preferences: def({
    description:
      "Change planning preferences: day start/end (HH:mm), daily assignment work cap in minutes, min/max session length in minutes, due buffer in hours, planning horizon in days, and recurring no-work windows (e.g. no work Friday nights). Pass only fields to change; no_work_windows replaces the whole list.",
    schema: z.object({
      day_start: hhmm.optional(),
      day_end: hhmm.optional(),
      daily_work_cap_min: z.number().int().min(0).max(1440).optional(),
      min_block_min: z.number().int().min(15).max(240).optional(),
      max_block_min: z.number().int().min(15).max(480).optional(),
      due_buffer_hours: z.number().int().min(0).max(168).optional(),
      horizon_days: z.number().int().min(7).max(60).optional(),
      no_work_windows: z.array(noWorkWindow).max(10).optional(),
    }),
    async run(input, { db, userId, profile }) {
      const { no_work_windows, ...rest } = input;
      const parsed = preferencesSchema.safeParse({ day_start: profile.day_start.slice(0, 5), day_end: profile.day_end.slice(0, 5), ...rest });
      if (!parsed.success) toolError(parsed.error.issues[0].message);
      const patch: Record<string, unknown> = { ...rest };
      if (no_work_windows) patch.no_work_windows = no_work_windows;
      if (!Object.keys(patch).length) toolError("Nothing to change");
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) before[k] = (profile as Record<string, unknown>)[k];
      const { error } = await db.from("profiles").update(patch as never).eq("id", userId);
      if (error) toolError(error.message);
      const parts = Object.entries(patch).map(([k, v]) =>
        k === "no_work_windows" ? `${(v as unknown[]).length} no-work window${(v as unknown[]).length === 1 ? "" : "s"}` : `${k.replace(/_/g, " ")} → ${v}`,
      );
      return { result: { updated: patch }, summary: `Updated preferences: ${parts.join(", ")}`, status: "applied", undo: { before } };
    },
  }),

  update_habit: def({
    description:
      "Edit or retire an existing habit (use its id from the context). Fields: name, target_min, min_min, window_start/window_end (HH:mm), days_of_week (1=Mon…7=Sun), end_date (YYYY-MM-DD or null), priority (1 = placed first), retired (true to stop scheduling it, false to restore).",
    schema: z.object({
      habit_id: z.string().uuid(),
      name: z.string().min(1).max(60).optional(),
      target_min: z.number().int().min(5).max(600).optional(),
      min_min: z.number().int().min(5).max(600).optional(),
      window_start: hhmm.optional(),
      window_end: hhmm.optional(),
      days_of_week: z.array(z.number().int().min(1).max(7)).min(1).optional(),
      end_date: isoDay.nullable().optional(),
      priority: z.number().int().min(1).max(99).optional(),
      retired: z.boolean().optional(),
    }),
    async run({ habit_id, retired, ...patch }, { db }) {
      const { data: h } = await db.from("habits").select("*").eq("id", habit_id).single();
      if (!h) toolError("No habit with that id");
      const merged = { ...h, window_start: h.window_start.slice(0, 5), window_end: h.window_end.slice(0, 5), ...patch };
      const check = habitSchema.safeParse(merged);
      if (!check.success) toolError(check.error.issues[0].message);
      const update: Record<string, unknown> = { ...patch };
      if (retired !== undefined) update.retired_at = retired ? new Date().toISOString() : null;
      if (!Object.keys(update).length) toolError("Nothing to change");
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(update)) before[k] = (h as Record<string, unknown>)[k];
      const { error } = await db.from("habits").update(update as never).eq("id", habit_id);
      if (error) toolError(error.message);
      const what = retired === true ? `Retired ${h.name}` : retired === false ? `Restored ${h.name}` : `Updated ${h.name}: ${Object.keys(patch).map((k) => k.replace(/_/g, " ")).join(", ")}`;
      return { result: { updated: update }, summary: what, status: "applied", undo: { habit_id, before } };
    },
  }),

  add_habit: def({
    description: "Add a new daily or weekly habit the planner protects before assignment work.",
    schema: z.object({
      name: z.string().min(1).max(60),
      target_min: z.number().int().min(5).max(600),
      min_min: z.number().int().min(5).max(600).optional(),
      window_start: hhmm,
      window_end: hhmm,
      days_of_week: z.array(z.number().int().min(1).max(7)).min(1).optional(),
      end_date: isoDay.optional(),
    }),
    async run(input, { db, userId, tz }) {
      const { data: hs } = await db.from("habits").select("priority").is("retired_at", null);
      const row = {
        name: input.name,
        target_min: input.target_min,
        min_min: input.min_min ?? input.target_min,
        window_start: input.window_start,
        window_end: input.window_end,
        days_of_week: input.days_of_week ?? [1, 2, 3, 4, 5, 6, 7],
        start_date: DateTime.now().setZone(tz).toISODate()!,
        end_date: input.end_date ?? null,
        priority: Math.max(0, ...(hs ?? []).map((h) => h.priority)) + 1,
        color: "moss" as const,
      };
      const check = habitSchema.safeParse(row);
      if (!check.success) toolError(check.error.issues[0].message);
      const { data, error } = await db.from("habits").insert({ ...row, user_id: userId }).select("id").single();
      if (error || !data) toolError(error?.message ?? "Couldn't save");
      return { result: { created: data.id }, summary: `Added habit: ${input.name} (${formatDuration(input.target_min)})`, status: "applied", undo: { habit_id: data.id } };
    },
  }),

  set_estimate: def({
    description: "Set the student's own estimate (hours) for one assignment, when they say how long it will take. Their number overrides the AI estimate.",
    schema: z.object({ work_item_id: z.string().uuid(), hours: z.number().min(0.25).max(80) }),
    async run({ work_item_id, hours }, { db, userId }) {
      const { data: item } = await db.from("work_items").select("title, content_hash").eq("id", work_item_id).single();
      if (!item) toolError("No assignment with that id");
      const { data: prev } = await db.from("effort_estimates").select("hours").eq("work_item_id", work_item_id).eq("origin", "user").maybeSingle();
      await db.from("effort_estimates").delete().eq("work_item_id", work_item_id).eq("origin", "user");
      const { error } = await db.from("effort_estimates").insert({
        user_id: userId,
        work_item_id,
        origin: "user",
        content_hash: item.content_hash ?? "",
        hours: Math.round(hours * 4) / 4,
        reasoning: "Your estimate.",
      });
      if (error) toolError(error.message);
      return { result: { saved: true }, summary: `Set ${item.title} to ${formatDuration(hours * 60)}`, status: "applied", undo: { work_item_id, previous_hours: prev ? Number(prev.hours) : null } };
    },
  }),

  remember: def({
    description:
      "Save a durable fact about how the student works (pace in a course, recurring constraints, preferences), to use in future estimates and plans. Not for one-off events. Existing AI estimates are refreshed with it on the next plan.",
    schema: z.object({ fact: z.string().min(3).max(300).describe("Written in third person, e.g. 'Statistics problem sets take them longer than average.'") }),
    async run({ fact }, { db, userId }) {
      const { data, error } = await db.from("user_memory").insert({ user_id: userId, content: fact.trim(), source: "chat" }).select("id").single();
      if (error || !data) toolError(error?.message ?? "Couldn't save");
      // estimates are cached by content; a new fact about the student invalidates AI guesses
      await invalidateAiEstimates(db, userId);
      return { result: { saved: true }, summary: `Remembered: “${fact.trim()}”`, status: "applied", undo: { memory_id: data.id } };
    },
  }),
};

export type ToolName = keyof typeof TOOLS;

export async function invalidateAiEstimates(db: DB, userId: string) {
  const { data: open } = await db.from("work_items").select("id").eq("user_id", userId).eq("status", "open");
  if (open?.length) await db.from("effort_estimates").delete().eq("origin", "llm").in("work_item_id", open.map((w) => w.id));
}

/** Tool definitions for the API, generated from the same zod schemas used to validate inputs. */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return Object.entries(TOOLS).map(([name, t]) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _drop;
    return {
      name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    };
  });
}

/** Validate and run one tool call. Invalid input comes back as an error for the model to fix. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  const tool = (TOOLS as Record<string, Def<z.ZodType>>)[name];
  if (!tool) throw new ToolInputError(`Unknown tool ${name}`);
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return tool.run(parsed.data, ctx);
}

/** Reverse an applied tool call using the data recorded when it ran. */
export async function undoTool(name: string, undo: Record<string, unknown>, { db, userId }: ToolCtx) {
  switch (name) {
    case "move_block":
      return db.from("blocks").update({ starts_at: undo.starts_at as string, ends_at: undo.ends_at as string, locked: undo.locked as boolean }).eq("id", undo.block_id as string);
    case "mark_unavailable":
      return db.from("events").delete().eq("id", undo.event_id as string).eq("kind", "unavailable");
    case "update_preferences":
      return db.from("profiles").update(undo.before as never).eq("id", userId);
    case "update_habit":
      return db.from("habits").update(undo.before as never).eq("id", undo.habit_id as string);
    case "add_habit":
      return db.from("habits").delete().eq("id", undo.habit_id as string);
    case "set_estimate": {
      await db.from("effort_estimates").delete().eq("work_item_id", undo.work_item_id as string).eq("origin", "user");
      if (undo.previous_hours != null) {
        const { data: item } = await db.from("work_items").select("content_hash").eq("id", undo.work_item_id as string).single();
        return db.from("effort_estimates").insert({ user_id: userId, work_item_id: undo.work_item_id as string, origin: "user", content_hash: item?.content_hash ?? "", hours: undo.previous_hours as number, reasoning: "Your estimate." });
      }
      return { error: null };
    }
    case "remember":
      return db.from("user_memory").delete().eq("id", undo.memory_id as string);
    default:
      throw new Error("This action can't be undone");
  }
}
