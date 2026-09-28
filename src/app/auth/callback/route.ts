import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Handles both magic-link styles: PKCE (?code=) and token hash (?token_hash=&type=),
// the latter works when the link is opened on a different device.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const supabase = await createClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing sign-in code") };

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link expired or was already used. Request a new one.")}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/today";
}
