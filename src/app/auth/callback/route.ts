import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Legacy entry point. Token-hash links are forwarded to /auth/confirm, which only
// verifies on a button POST, so a mail scanner's GET here can't spend the token.
// PKCE ?code= links (older emails) are still exchanged.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  if (tokenHash) {
    const url = new URL("/auth/confirm", origin);
    url.searchParams.set("token_hash", tokenHash);
    url.searchParams.set("type", searchParams.get("type") ?? "email");
    return NextResponse.redirect(url);
  }

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/today`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link expired or was already used. Enter the code from the email, or send a new one.")}`);
}
