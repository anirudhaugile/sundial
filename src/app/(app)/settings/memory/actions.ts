"use server";

import { revalidatePath } from "next/cache";
import { invalidateAiEstimates } from "@/lib/chat/tools";
import { requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export async function addMemory(content: string) {
  const text = content.trim();
  if (text.length < 3 || text.length > 300) return { ok: false, error: "Keep it between 3 and 300 characters." };
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const { error } = await supabase.from("user_memory").insert({ user_id: user.id, content: text, source: "manual" });
  if (!error) await invalidateAiEstimates(supabase, user.id);
  revalidatePath("/settings/memory");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteMemory(id: string) {
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const { error } = await supabase.from("user_memory").delete().eq("id", id);
  if (!error) await invalidateAiEstimates(supabase, user.id);
  revalidatePath("/settings/memory");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeNoWorkWindow(index: number) {
  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);
  const list = ((profile.no_work_windows as unknown[]) ?? []).filter((_, i) => i !== index);
  await supabase.from("profiles").update({ no_work_windows: list as never }).eq("id", user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
