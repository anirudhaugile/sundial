import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateTime } from "luxon";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type DB = SupabaseClient<Database>;
export type Profile = Tables<"profiles">;
export type Course = Tables<"courses">;
export type WorkItem = Tables<"work_items">;
export type CalEvent = Tables<"events">;
export type Block = Tables<"blocks">;
export type Habit = Tables<"habits">;

export async function requireProfile(supabase: DB) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error || !profile) throw new Error("Profile missing");
  return { user, profile };
}

export async function getCourses(supabase: DB) {
  const { data } = await supabase.from("courses").select("*").order("name");
  return data ?? [];
}

export async function getHabits(supabase: DB, { includeRetired = false } = {}) {
  let q = supabase.from("habits").select("*").order("priority").order("created_at");
  if (!includeRetired) q = q.is("retired_at", null);
  const { data } = await q;
  return data ?? [];
}

/** Everything that overlaps [start, end): events, committed blocks, and deadlines. */
export async function getCalendar(supabase: DB, start: DateTime, end: DateTime) {
  const s = start.toUTC().toISO()!;
  const e = end.toUTC().toISO()!;
  const [events, blocks, due] = await Promise.all([
    supabase.from("events").select("*").is("removed_at", null).lt("starts_at", e).gt("ends_at", s).order("starts_at"),
    supabase.from("blocks").select("*").in("status", ["scheduled", "done"]).lt("starts_at", e).gt("ends_at", s).order("starts_at"),
    supabase.from("work_items").select("*").is("removed_at", null).gte("due_at", s).lt("due_at", e).order("due_at"),
  ]);
  return { events: events.data ?? [], blocks: blocks.data ?? [], due: due.data ?? [] };
}

/** Today's briefing: schedule, to-dos, and anything carried forward. */
export async function getToday(supabase: DB, now: DateTime) {
  const dayStart = now.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const today = dayStart.toISODate()!;
  const s = dayStart.toUTC().toISO()!;
  const n = now.toUTC().toISO()!;

  const [cal, todos, overdueItems, missedBlocks] = await Promise.all([
    getCalendar(supabase, dayStart, dayEnd),
    supabase
      .from("work_items")
      .select("*")
      .eq("status", "open")
      .is("removed_at", null)
      .eq("kind", "task")
      .lte("planned_for", today)
      .order("planned_for")
      .order("created_at"),
    supabase.from("work_items").select("*").eq("status", "open").is("removed_at", null).lt("due_at", n).order("due_at"),
    supabase.from("blocks").select("*").eq("status", "scheduled").lt("ends_at", s).order("starts_at", { ascending: false }).limit(20),
  ]);

  return {
    ...cal,
    todos: todos.data ?? [],
    overdueItems: overdueItems.data ?? [],
    missedBlocks: missedBlocks.data ?? [],
  };
}

export async function getWorkItemsById(supabase: DB, ids: string[]) {
  if (!ids.length) return new Map<string, WorkItem>();
  const { data } = await supabase.from("work_items").select("*").in("id", ids);
  return new Map((data ?? []).map((w) => [w.id, w]));
}
