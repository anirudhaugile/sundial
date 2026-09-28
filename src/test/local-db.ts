import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Load .env.local into process.env for integration tests against local Supabase. */
export function loadLocalEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no local env: integration tests skip
  }
}

export async function localDbAvailable() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SECRET_KEY || !url.includes("127.0.0.1")) return false;
  try {
    const r = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export function adminDb() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function createTestUser(db: ReturnType<typeof adminDb>) {
  const email = `test+${Date.now()}${Math.random().toString(36).slice(2, 6)}@sundial.test`;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user!.id;
}

/** A client signed in as a fresh user, so RLS applies exactly as in the app. */
export async function userSession(admin: ReturnType<typeof adminDb>) {
  const email = `chat+${Date.now()}${Math.random().toString(36).slice(2, 6)}@sundial.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-A1`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: se } = await client.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return { client, userId: data.user!.id };
}
