import "server-only";
import type { DB } from "@/lib/data/queries";
import { ensureEstimates } from "@/lib/llm/estimate";
import { syncUser, type SyncResult } from "@/lib/sources/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProposal } from "./run";

export type PipelineResult = { runId: string; sync: SyncResult[] };

/**
 * The auto-planner, end to end:
 *   1. sync sources for the horizon   (idempotent upserts)
 *   2. estimate new/changed work      (LLM, cached by content hash)
 *   3. schedule deterministically     (plain code)
 *   4. save as a proposal for review  (nothing is committed until approved)
 */
export async function planNow(db: DB, userId: string, trigger: "manual" | "cron" | "chat"): Promise<PipelineResult> {
  const admin = createAdminClient();
  const sync = await syncUser(admin, userId);
  await ensureEstimates(admin, userId);
  const { runId } = await createProposal(db, userId, trigger);
  return { runId, sync };
}
