import type { DB, WorkItem } from "@/lib/data/queries";
import { calibrationNote, courseCalibration, type Calibration } from "./calibration";

export type ResolvedEstimate = {
  hours: number; // what the scheduler uses (calibrated)
  baseHours: number; // before calibration; snapshotted on completion so calibration learns from raw estimates
  origin: "user" | "llm" | "default";
  reasoning: string;
  calibration: string | null;
};

/** Fallback when there's no user or LLM estimate: scale loosely with points. */
export function defaultEstimate(item: Pick<WorkItem, "kind" | "points">): Omit<ResolvedEstimate, "calibration" | "baseHours"> {
  if (item.kind === "task") return { hours: 1, origin: "default", reasoning: "Default for a to-do with a deadline." };
  if (item.points && item.points > 0) {
    const hours = Math.min(8, Math.max(1, Math.round((item.points / 20) * 4) / 4));
    return { hours, origin: "default", reasoning: `Rough default from ${item.points} points. Add your own estimate to refine it.` };
  }
  return { hours: 2, origin: "default", reasoning: "Default guess. Add your own estimate to refine it." };
}

/** Per-course factors learned from finished work with recorded actual time. */
export async function loadCalibration(supabase: DB, userId?: string) {
  let q = supabase
    .from("work_items")
    .select("course_id, estimated_minutes, actual_minutes, completed_at")
    .eq("status", "done")
    .not("estimated_minutes", "is", null)
    .not("actual_minutes", "is", null)
    .gte("completed_at", new Date(Date.now() - 120 * 86_400_000).toISOString());
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const map = courseCalibration(
    (data ?? []).map((d) => ({ courseId: d.course_id, estimatedMin: d.estimated_minutes!, actualMin: d.actual_minutes!, completedAt: d.completed_at ?? "" })),
  );
  const total = [...map.values()].reduce((m, c) => m + c.samples, 0);
  return { map, total };
}

/**
 * Pick the estimate the scheduler uses for each item:
 * your own estimate > cached LLM estimate for the current content > default,
 * then scale AI/default estimates by the course's calibration factor.
 */
export async function resolveEstimates(supabase: DB, items: WorkItem[], opts: { userId?: string; calibration?: Map<string, Calibration> } = {}) {
  const out = new Map<string, ResolvedEstimate>();
  if (!items.length) return out;
  const [{ data }, calibration] = await Promise.all([
    supabase
      .from("effort_estimates")
      .select("work_item_id, origin, hours, reasoning, content_hash, created_at")
      .in("work_item_id", items.map((i) => i.id))
      .order("created_at", { ascending: false }),
    opts.calibration ? Promise.resolve(opts.calibration) : loadCalibration(supabase, opts.userId).then((c) => c.map),
  ]);
  const rows = data ?? [];
  for (const item of items) {
    const mine = rows.filter((r) => r.work_item_id === item.id);
    const user = mine.find((r) => r.origin === "user");
    const llm = mine.find((r) => r.origin === "llm" && r.content_hash === item.content_hash);
    const base = user
      ? { hours: Number(user.hours), origin: "user" as const, reasoning: user.reasoning ?? "Your estimate." }
      : llm
        ? { hours: Number(llm.hours), origin: "llm" as const, reasoning: llm.reasoning ?? "" }
        : defaultEstimate(item);
    // your own numbers are taken as-is; only model and default guesses get calibrated
    const cal = base.origin !== "user" && item.course_id ? calibration.get(item.course_id) : undefined;
    const hours = cal ? Math.round(base.hours * cal.factor * 4) / 4 : base.hours;
    out.set(item.id, { ...base, hours: Math.max(0.25, hours), baseHours: base.hours, calibration: calibrationNote(cal) });
  }
  return out;
}
