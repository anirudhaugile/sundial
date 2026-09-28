import type { DB, WorkItem } from "@/lib/data/queries";

export type ResolvedEstimate = {
  hours: number;
  origin: "user" | "llm" | "default";
  reasoning: string;
};

/** Fallback when there's no user or LLM estimate: scale loosely with points. */
export function defaultEstimate(item: Pick<WorkItem, "kind" | "points">): ResolvedEstimate {
  if (item.kind === "task") return { hours: 1, origin: "default", reasoning: "Default for a to-do with a deadline." };
  if (item.points && item.points > 0) {
    const hours = Math.min(8, Math.max(1, Math.round((item.points / 20) * 4) / 4));
    return { hours, origin: "default", reasoning: `Rough default from ${item.points} points. Add your own estimate to refine it.` };
  }
  return { hours: 2, origin: "default", reasoning: "Default guess. Add your own estimate to refine it." };
}

/**
 * Pick the estimate the scheduler uses for each item:
 * your own estimate > cached LLM estimate for the current content > default.
 */
export async function resolveEstimates(supabase: DB, items: WorkItem[]) {
  const out = new Map<string, ResolvedEstimate>();
  if (!items.length) return out;
  const { data } = await supabase
    .from("effort_estimates")
    .select("work_item_id, origin, hours, reasoning, content_hash, created_at")
    .in("work_item_id", items.map((i) => i.id))
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  for (const item of items) {
    const mine = rows.filter((r) => r.work_item_id === item.id);
    const user = mine.find((r) => r.origin === "user");
    const llm = mine.find((r) => r.origin === "llm" && r.content_hash === item.content_hash);
    if (user) out.set(item.id, { hours: Number(user.hours), origin: "user", reasoning: user.reasoning ?? "Your estimate." });
    else if (llm) out.set(item.id, { hours: Number(llm.hours), origin: "llm", reasoning: llm.reasoning ?? "" });
    else out.set(item.id, defaultEstimate(item));
  }
  return out;
}
