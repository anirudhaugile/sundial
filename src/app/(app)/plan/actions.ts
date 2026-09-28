"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/queries";
import { createProposal } from "@/lib/planner/run";

type Result = { ok: true } | { ok: false; error: string };
const done = (): Result => {
  revalidatePath("/", "layout");
  return { ok: true };
};

export async function runPlanner(): Promise<Result> {
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  try {
    await createProposal(supabase, user.id, "manual");
    return done();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Planner failed" };
  }
}

export async function approvePlan(runId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_plan", { run_id: runId });
  return error ? { ok: false, error: error.message } : done();
}

export async function discardPlan(runId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_plan", { run_id: runId });
  return error ? { ok: false, error: error.message } : done();
}

export async function removeProposedBlock(blockId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("blocks").delete().eq("id", blockId).eq("status", "proposed");
  return error ? { ok: false, error: error.message } : done();
}

/** Record your own estimate for an item, then re-plan so the proposal reflects it. */
export async function setEstimateAndReplan(workItemId: string, hours: number): Promise<Result> {
  if (!(hours > 0 && hours <= 80)) return { ok: false, error: "Estimate must be between 0.25 and 80 hours" };
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
  if (error) return { ok: false, error: error.message };
  return runPlanner();
}
