import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DB } from "@/lib/data/queries";
import { anthropic, MODEL } from "./client";

// The LLM's only job in planning: turn an assignment description into an effort
// estimate with a one-line reason. It never sees or touches the calendar.

export const EstimateBatch = z.object({
  estimates: z.array(
    z.object({
      id: z.string().describe("The id of the assignment exactly as given"),
      hours: z.number().describe("Focused work hours, between 0.25 and 40"),
      reasoning: z.string().describe("One plain sentence, under 140 characters, naming the main driver"),
    }),
  ),
});
export type EstimateBatch = z.infer<typeof EstimateBatch>;

export type EstimateInput = {
  id: string;
  title: string;
  course: string | null;
  points: number | null;
  dueAt: string | null;
  description: string | null;
};

export type Estimate = { id: string; hours: number; reasoning: string };

/** Anything that turns items into estimates. The real one calls Claude; tests pass a fake. */
export type Estimator = (items: EstimateInput[], context: { memories: string[] }) => Promise<Estimate[]>;

const SYSTEM = `You estimate how long university coursework will take one specific student, so a planner can reserve time for it.

Estimate focused working hours from start to submission: reading the prompt, doing the work, writing it up, and submitting. Not calendar time.

Useful anchors (adjust using the description and points):
- Reading quizzes, short discussion posts, surveys: 0.25-1 h
- Weekly problem sets: 2-6 h, more for upper-level math and statistics
- Programming assignments: 3-15 h depending on scope; multi-part projects more
- Lab reports: 3-6 h
- Essays and papers: roughly 1.5-2 h per page including research and revision
- Exams are not assignments; if one appears, estimate study time of 3-6 h

Points hint at weight within a course but vary by instructor; treat them as a weak signal next to the description. When the description is empty, estimate from the title, course and points, and say that the estimate is rough.

Return one estimate for every assignment, using its exact id. Keep each reason to one plain sentence under 140 characters that names the main driver, for example "Six proofs in an upper-level course; proofs usually take this student a while."`;

function userPrompt(items: EstimateInput[], memories: string[]) {
  const about = memories.length
    ? `What the student has told you about how they work (apply these):\n${memories.map((m) => `- ${m}`).join("\n")}\n\n`
    : "";
  const list = items.map((i) => ({
    id: i.id,
    title: i.title,
    course: i.course,
    points: i.points,
    due: i.dueAt,
    description: i.description ? i.description.slice(0, 2000) : null,
  }));
  return `${about}Assignments:\n${JSON.stringify(list, null, 2)}`;
}

export const claudeEstimator: Estimator = async (items, { memories }) => {
  const client = anthropic();
  if (!client) return [];
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(EstimateBatch) },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(items, memories) }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  return response.parsed_output.estimates;
};

/** Keep only well-formed estimates for ids we asked about; clamp hours to a sane range. */
export function sanitizeEstimates(items: EstimateInput[], raw: Estimate[]): Estimate[] {
  const wanted = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  const out: Estimate[] = [];
  for (const e of raw) {
    if (!wanted.has(e.id) || seen.has(e.id) || !Number.isFinite(e.hours)) continue;
    seen.add(e.id);
    const hours = Math.min(40, Math.max(0.25, Math.round(e.hours * 4) / 4));
    const reasoning = (e.reasoning ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "Estimated from the assignment details.";
    out.push({ id: e.id, hours, reasoning });
  }
  return out;
}

const BATCH = 12;
const DAILY_CALL_CAP = 40; // estimates are cached, so this only bites on abuse (e.g. the public demo)

/**
 * Estimate every open assignment that has no estimate for its current content.
 * Unchanged assignments are never re-sent: the cache key is (item, content hash).
 */
export async function ensureEstimates(db: DB, userId: string, opts: { estimator?: Estimator; memories?: string[] } = {}) {
  const estimator = opts.estimator ?? claudeEstimator;
  if (!opts.estimator && !anthropic()) return { requested: 0, saved: 0, skipped: "no-key" as const };

  const { data: items } = await db
    .from("work_items")
    .select("id, title, description, points, due_at, content_hash, course_id, kind")
    .eq("user_id", userId)
    .eq("status", "open")
    .is("removed_at", null)
    .eq("kind", "assignment")
    .not("content_hash", "is", null);
  if (!items?.length) return { requested: 0, saved: 0 };

  const { data: existing } = await db
    .from("effort_estimates")
    .select("work_item_id, origin, content_hash")
    .eq("user_id", userId)
    .in("work_item_id", items.map((i) => i.id));
  const covered = new Set(
    (existing ?? [])
      .filter((e) => e.origin === "user" || e.origin === "llm")
      .filter((e) => e.origin === "user" || items.find((i) => i.id === e.work_item_id)?.content_hash === e.content_hash)
      .map((e) => e.work_item_id),
  );
  const todo = items.filter((i) => !covered.has(i.id));
  if (!todo.length) return { requested: 0, saved: 0 };

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await db.from("effort_estimates").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("origin", "llm").gte("created_at", since);
  const budget = Math.max(0, DAILY_CALL_CAP * BATCH - (count ?? 0));
  const batchItems = todo.slice(0, budget);
  if (!batchItems.length) return { requested: 0, saved: 0, skipped: "cap" as const };

  const { data: courses } = await db.from("courses").select("id, name, code").eq("user_id", userId);
  const courseName = new Map((courses ?? []).map((c) => [c.id, c.code || c.name]));
  const inputs: EstimateInput[] = batchItems.map((i) => ({
    id: i.id,
    title: i.title,
    course: i.course_id ? (courseName.get(i.course_id) ?? null) : null,
    points: i.points,
    dueAt: i.due_at,
    description: i.description,
  }));

  let saved = 0;
  for (let k = 0; k < inputs.length; k += BATCH) {
    const chunk = inputs.slice(k, k + BATCH);
    let raw: Estimate[] = [];
    try {
      raw = await estimator(chunk, { memories: opts.memories ?? [] });
    } catch (e) {
      // estimates are best-effort: the planner falls back to defaults
      if (!(e instanceof Anthropic.APIError)) throw e;
      continue;
    }
    const clean = sanitizeEstimates(chunk, raw);
    if (!clean.length) continue;
    const hashOf = new Map(batchItems.map((i) => [i.id, i.content_hash!]));
    const { error } = await db.from("effort_estimates").upsert(
      clean.map((e) => ({
        user_id: userId,
        work_item_id: e.id,
        content_hash: hashOf.get(e.id)!,
        origin: "llm",
        hours: e.hours,
        reasoning: e.reasoning,
        model: MODEL,
      })),
      { onConflict: "work_item_id,origin,content_hash" },
    );
    if (!error) saved += clean.length;
  }
  return { requested: inputs.length, saved };
}
