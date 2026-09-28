"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

const emailSchema = z.email();

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", message: "That doesn't look like an email address." };
  const email = parsed.data;

  // Optional allowlist so a public deploy doesn't become a free LLM for strangers.
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(email)) {
    return { status: "error", message: "This Sundial is private. Try the demo instead." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/today` },
  });
  if (error) return { status: "error", message: error.message };
  return { status: "sent", email };
}
