import { NextResponse, type NextRequest } from "next/server";
import { seedDemo } from "@/lib/demo/seed";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/** Regenerate the demo account (also run nightly from /api/cron/daily). */
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = await seedDemo(createAdminClient(), serverEnv.demoPassword);
  return NextResponse.json({ ok: true, user: userId.slice(0, 8) });
}
