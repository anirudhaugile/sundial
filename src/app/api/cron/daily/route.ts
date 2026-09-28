import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { seedDemo } from "@/lib/demo/seed";
import { ensureEstimates } from "@/lib/llm/estimate";
import { createProposal } from "@/lib/planner/run";
import { syncUser } from "@/lib/sources/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Vercel Cron, every morning: sync each user's sources and draft a plan for review.
// A proposal you're in the middle of reviewing (made by you or chat) is never replaced.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();
  const { data: users } = await db.from("profiles").select("id").eq("is_demo", false);
  const report: Record<string, unknown>[] = [];

  for (const { id } of users ?? []) {
    try {
      const sync = await syncUser(db, id);
      await ensureEstimates(db, id);
      const { data: pending } = await db.from("plan_runs").select("trigger").eq("user_id", id).eq("status", "proposed").maybeSingle();
      let planned = false;
      if (!pending || pending.trigger === "cron") {
        await createProposal(db, id, "cron");
        planned = true;
      }
      report.push({ user: id.slice(0, 8), synced: sync.map((s) => `${s.kind}:${s.ok ? "ok" : "error"}`), planned });
    } catch (e) {
      report.push({ user: id.slice(0, 8), error: e instanceof Error ? e.message : String(e) });
    }
  }
  // keep the public demo fresh: dates are relative to today, and visitors may have changed things
  let demo = "skipped";
  if (process.env.DEMO_USER_PASSWORD) {
    try {
      await seedDemo(db, serverEnv.demoPassword);
      demo = "reset";
    } catch (e) {
      demo = e instanceof Error ? e.message : "failed";
    }
  }
  return NextResponse.json({ ok: true, users: report.length, report, demo });
}
