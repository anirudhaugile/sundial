"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

// Sign-in is scanner-proof: the email carries a 6-digit code (primary) and a link to
// /auth/confirm, which only verifies on a POST from its button. Mail scanners
// (Microsoft 365 Safe Links etc.) fetch links with GET, so they can't burn the token.

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

const emailSchema = z.email();

function allowed(email: string) {
  const list = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !list.length || list.includes(email);
}

export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", message: "That doesn't look like an email address." };
  const email = parsed.data;
  // an allowlist keeps a public deploy from becoming a free LLM for strangers
  if (!allowed(email)) return { status: "error", message: "This Sundial is private. Try the demo instead." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm` },
  });
  if (error) {
    const wait = /security purposes|rate limit|seconds/i.test(error.message);
    return { status: wait ? "sent" : "error", email, message: wait ? "A code was sent a moment ago. Check your inbox, or try again in a minute." : error.message };
  }
  return { status: "sent", email };
}

export type VerifyState = { error?: string };

export async function verifyCode(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("token") ?? "").replace(/\D/g, "");
  if (!emailSchema.safeParse(email).success) return { error: "Start again with your email." };
  if (token.length !== 6) return { error: "Enter the 6-digit code from the email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { error: /expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Check the latest email, or send a new code." : error.message };
  redirect("/today");
}

const LINK_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/** The only place a link token is spent: a POST from the Continue button on /auth/confirm. */
export async function confirmLink(form: FormData) {
  const tokenHash = String(form.get("token_hash") ?? "");
  const rawType = String(form.get("type") ?? "email") as EmailOtpType;
  const type = LINK_TYPES.includes(rawType) ? rawType : "email";
  const supabase = await createClient();

  const { error } = tokenHash ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : { error: new Error("missing") };
  if (error) {
    // already signed in (e.g. the code was used first): nothing to fix
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/today");
    redirect(`/login?error=${encodeURIComponent("That link has already been used or expired. Enter the code from the email, or send a new one.")}`);
  }
  redirect("/today");
}
