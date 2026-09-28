"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/queries";
import { contentHash } from "@/lib/hash";
import { resolveEstimates } from "@/lib/planner/estimates";
import { fromLocalInput } from "@/lib/time";

export type ActionResult = { ok: true; id?: string } | { ok: false, error: string };

function done(id?: string): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true, id };
}

const fail = (error: string): ActionResult => ({ ok: false, error });

const optionalText = z.string().trim().transform((v) => v || null).nullable().optional();
const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v == null ? null : Number(v)))
  .refine((v) => v == null || Number.isFinite(v), "Must be a number");

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task"),
    title: z.string().trim().min(1, "Give it a name"),
    planned_for: z.iso.date(),
  }),
  z.object({
    type: z.literal("assignment"),
    title: z.string().trim().min(1, "Give it a name"),
    due: z.string().min(1, "When is it due?"),
    course_id: optionalText,
    description: optionalText,
    points: optionalNumber,
    estimate_hours: optionalNumber,
  }),
  z.object({
    type: z.literal("event"),
    title: z.string().trim().min(1, "Give it a name"),
    start: z.string().min(1),
    end: z.string().min(1),
    location: optionalText,
    busy: z.boolean().default(true),
  }),
]);

export type EntryInput = z.input<typeof entrySchema>;

export async function createEntry(input: EntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const entry = parsed.data;
  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);
  const tz = profile.timezone;

  if (entry.type === "task") {
    const { data, error } = await supabase
      .from("work_items")
      .insert({ user_id: user.id, kind: "task", title: entry.title, planned_for: entry.planned_for })
      .select("id")
      .single();
    return error ? fail(error.message) : done(data.id);
  }

  if (entry.type === "assignment") {
    const due = fromLocalInput(entry.due, tz);
    if (!due) return fail("Invalid due date");
    let courseName: string | null = null;
    if (entry.course_id) {
      const { data: c } = await supabase.from("courses").select("name").eq("id", entry.course_id).single();
      courseName = c?.name ?? null;
    }
    const hash = contentHash({ title: entry.title, description: entry.description, points: entry.points, courseName });
    const { data, error } = await supabase
      .from("work_items")
      .insert({
        user_id: user.id,
        kind: "assignment",
        title: entry.title,
        course_id: entry.course_id ?? null,
        description: entry.description ?? null,
        points: entry.points,
        due_at: due.toUTC().toISO(),
        content_hash: hash,
      })
      .select("id")
      .single();
    if (error) return fail(error.message);
    if (entry.estimate_hours && entry.estimate_hours > 0) {
      await supabase.from("effort_estimates").insert({
        user_id: user.id,
        work_item_id: data.id,
        content_hash: hash,
        origin: "user",
        hours: entry.estimate_hours,
        reasoning: "Your estimate",
      });
    }
    return done(data.id);
  }

  const start = fromLocalInput(entry.start, tz);
  const end = fromLocalInput(entry.end, tz);
  if (!start || !end) return fail("Invalid time");
  if (end <= start) return fail("End must be after start");
  const { data, error } = await supabase
    .from("events")
    .insert({
      user_id: user.id,
      source: "manual",
      title: entry.title,
      location: entry.location ?? null,
      starts_at: start.toUTC().toISO()!,
      ends_at: end.toUTC().toISO()!,
      busy: entry.busy,
    })
    .select("id")
    .single();
  return error ? fail(error.message) : done(data.id);
}

/**
 * Check a work item off (or reopen it). Finishing an item frees its future, unlocked
 * blocks, counts past sessions as done, and records estimated vs. actual time for calibration.
 */
export async function setWorkItemDone(id: string, isDone: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  if (!isDone) {
    const { error } = await supabase.from("work_items").update({ status: "open", completed_at: null }).eq("id", id);
    return error ? fail(error.message) : done();
  }
  const { user } = await requireProfile(supabase);
  const { data: item } = await supabase.from("work_items").select("*").eq("id", id).single();
  if (!item) return fail("Not found");

  // sessions you had planned before now are assumed done; future ones are released
  await supabase.from("blocks").update({ status: "done", completed_at: now }).eq("work_item_id", id).eq("status", "scheduled").lt("ends_at", now);
  await supabase.from("blocks").delete().eq("work_item_id", id).eq("status", "scheduled").eq("locked", false).gt("starts_at", now);

  const { data: doneBlocks } = await supabase.from("blocks").select("starts_at, ends_at").eq("work_item_id", id).eq("status", "done");
  const spent = Math.round((doneBlocks ?? []).reduce((m, b) => m + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0));
  const est = (await resolveEstimates(supabase, [item], { userId: user.id })).get(id);

  const { error } = await supabase
    .from("work_items")
    .update({
      status: "done",
      completed_at: now,
      estimated_minutes: est ? Math.round(est.baseHours * 60) : null,
      actual_minutes: item.actual_minutes ?? (spent > 0 ? spent : null),
    })
    .eq("id", id);
  return error ? fail(error.message) : done();
}

/** Correct how long something actually took (feeds calibration). */
export async function setActualMinutes(id: string, minutes: number | null): Promise<ActionResult> {
  if (minutes != null && !(minutes >= 0 && minutes <= 6000)) return fail("That's not a plausible duration");
  const supabase = await createClient();
  const { error } = await supabase.from("work_items").update({ actual_minutes: minutes == null ? null : Math.round(minutes) }).eq("id", id);
  return error ? fail(error.message) : done();
}

export async function setBlockStatus(id: string, status: "scheduled" | "done" | "skipped"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blocks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id);
  return error ? fail(error.message) : done();
}

/** Editing a block's time locks it so the scheduler never moves it again. */
export async function updateBlockTime(id: string, startLocal: string, endLocal: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const start = fromLocalInput(startLocal, profile.timezone);
  const end = fromLocalInput(endLocal, profile.timezone);
  if (!start || !end) return fail("Invalid time");
  if (end <= start) return fail("End must be after start");
  const { error } = await supabase
    .from("blocks")
    .update({ starts_at: start.toUTC().toISO()!, ends_at: end.toUTC().toISO()!, locked: true })
    .eq("id", id);
  return error ? fail(error.message) : done();
}

export async function setBlockLocked(id: string, locked: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("blocks").update({ locked }).eq("id", id);
  return error ? fail(error.message) : done();
}

export async function deleteBlock(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("blocks").delete().eq("id", id);
  return error ? fail(error.message) : done();
}

export async function updateEventTime(id: string, startLocal: string, endLocal: string, title?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const start = fromLocalInput(startLocal, profile.timezone);
  const end = fromLocalInput(endLocal, profile.timezone);
  if (!start || !end || end <= start) return fail("End must be after start");
  const patch: { starts_at: string; ends_at: string; title?: string } = {
    starts_at: start.toUTC().toISO()!,
    ends_at: end.toUTC().toISO()!,
  };
  if (title?.trim()) patch.title = title.trim();
  // only manual events are editable; synced ones would be overwritten on next sync
  const { error } = await supabase.from("events").update(patch).eq("id", id).eq("source", "manual");
  return error ? fail(error.message) : done();
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", id).eq("source", "manual");
  return error ? fail(error.message) : done();
}

export async function deleteWorkItem(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("work_items").delete().eq("id", id).eq("source", "manual");
  return error ? fail(error.message) : done();
}

export async function moveTaskToToday(id: string, today: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("work_items").update({ planned_for: today }).eq("id", id);
  return error ? fail(error.message) : done();
}

/** Save your own estimate without re-planning (applied on the next plan). */
export async function setEstimate(workItemId: string, hours: number): Promise<ActionResult> {
  if (!(hours > 0 && hours <= 80)) return fail("Estimate must be between 0.25 and 80 hours");
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const { data: item } = await supabase.from("work_items").select("content_hash").eq("id", workItemId).single();
  const { error } = await supabase.from("effort_estimates").upsert(
    {
      user_id: user.id,
      work_item_id: workItemId,
      origin: "user",
      content_hash: item?.content_hash ?? "",
      hours: Math.round(hours * 4) / 4,
      reasoning: "Your estimate.",
      created_at: new Date().toISOString(),
    },
    { onConflict: "work_item_id,origin,content_hash" },
  );
  return error ? fail(error.message) : done();
}

/** Drop your override so the AI (or default) estimate applies again. */
export async function clearEstimate(workItemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("effort_estimates").delete().eq("work_item_id", workItemId).eq("origin", "user");
  return error ? fail(error.message) : done();
}
