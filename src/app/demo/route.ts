import { NextResponse, type NextRequest } from "next/server";
import { DEMO_EMAIL, seedDemo } from "@/lib/demo/seed";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// One click into a fully seeded account. The password never leaves the server.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  const password = serverEnv.demoPassword;

  let { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  if (error) {
    // first visit on a fresh deploy: create and seed the account, then sign in
    await seedDemo(createAdminClient(), password);
    ({ error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password }));
  }
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("The demo is resting. Try again in a minute.")}`);
  return NextResponse.redirect(`${origin}/today`);
}
