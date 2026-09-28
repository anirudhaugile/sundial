"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/queries";
import { habitSchema, preferencesSchema, type HabitInput, type PreferencesInput } from "@/lib/schemas";
import { COURSE_COLORS } from "@/lib/view";

export type { HabitInput, PreferencesInput };
export type SettingsResult = { ok: true } | { ok: false; error: string };
const ok = (): SettingsResult => {
  revalidatePath("/", "layout");
  return { ok: true };
};
const fail = (error: string): SettingsResult => ({ ok: false, error });

export async function updatePreferences(input: PreferencesInput): Promise<SettingsResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  return error ? fail(friendly(error.message)) : ok();
}

export async function saveHabit(id: string | null, input: HabitInput): Promise<SettingsResult> {
  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const row = { ...parsed.data, end_date: parsed.data.end_date ?? null };
  const { error } = id
    ? await supabase.from("habits").update(row).eq("id", id)
    : await supabase.from("habits").insert({ ...row, user_id: user.id });
  return error ? fail(friendly(error.message)) : ok();
}

/** Retiring keeps history (past blocks) but stops the habit from being scheduled. */
export async function setHabitRetired(id: string, retired: boolean): Promise<SettingsResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("habits").update({ retired_at: retired ? new Date().toISOString() : null }).eq("id", id);
  if (error) return fail(error.message);
  if (retired) {
    await supabase.from("blocks").delete().eq("habit_id", id).eq("status", "scheduled").eq("locked", false).gt("starts_at", new Date().toISOString());
  }
  return ok();
}

const courseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(20).transform((v) => v || null).nullable().optional(),
  color: z.enum(COURSE_COLORS),
});

export async function saveCourse(id: string | null, input: z.input<typeof courseSchema>): Promise<SettingsResult> {
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  // synced courses keep their Canvas name; only code/color are editable there
  const { error } = id
    ? await supabase.from("courses").update(parsed.data).eq("id", id)
    : await supabase.from("courses").insert({ ...parsed.data, user_id: user.id, source: "manual" });
  return error ? fail(friendly(error.message)) : ok();
}

export async function deleteCourse(id: string): Promise<SettingsResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("courses").delete().eq("id", id).eq("source", "manual");
  return error ? fail(error.message) : ok();
}

function friendly(message: string) {
  if (message.includes("check constraint")) return "Those values don't fit together. Check the times and lengths.";
  return message;
}
