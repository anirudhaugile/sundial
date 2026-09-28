"use server";

import { revalidatePath } from "next/cache";
import { encryptSecret, hint } from "@/lib/crypto";
import { requireProfile } from "@/lib/data/queries";
import { normalizeCanvasBase } from "@/lib/sources/canvas";
import { normalizeFeedUrl, SourceError } from "@/lib/sources/fetch";
import { syncUser, type SyncResult } from "@/lib/sources/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Kind = "canvas_api" | "canvas_ical" | "outlook_ics";
export type SourceActionResult = { ok: true; results?: SyncResult[] } | { ok: false; error: string };

export async function connectSource(kind: Kind, input: { baseUrl?: string; secret: string }): Promise<SourceActionResult> {
  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);
  if (profile.is_demo) return { ok: false, error: "The demo account can't connect real sources." };

  let baseUrl: string | null = null;
  let secret = input.secret.trim();
  try {
    if (kind === "canvas_api") {
      if (!input.baseUrl?.trim()) return { ok: false, error: "Enter your school's Canvas address." };
      baseUrl = normalizeCanvasBase(input.baseUrl);
      if (secret.length < 20) return { ok: false, error: "That token looks too short." };
    } else {
      secret = normalizeFeedUrl(secret);
    }
  } catch (e) {
    return { ok: false, error: e instanceof SourceError ? e.message : "That address doesn't look right." };
  }

  // the row goes through RLS (so the demo policy applies); the secret goes to the locked table
  const { data: conn, error } = await supabase
    .from("source_connections")
    .upsert({ user_id: user.id, kind, base_url: baseUrl, secret_hint: hint(secret), enabled: true, last_error: null }, { onConflict: "user_id,kind" })
    .select("id")
    .single();
  if (error || !conn) return { ok: false, error: error?.message ?? "Couldn't save" };

  const admin = createAdminClient();
  const { error: se } = await admin
    .from("source_secrets")
    .upsert({ connection_id: conn.id, user_id: user.id, ciphertext: encryptSecret(secret), updated_at: new Date().toISOString() });
  if (se) return { ok: false, error: se.message };

  const results = await syncUser(admin, user.id, conn.id);
  revalidatePath("/", "layout");
  const r = results[0];
  return r && !r.ok ? { ok: false, error: `Saved, but the first sync failed: ${r.error}` } : { ok: true, results };
}

export async function syncNow(): Promise<SourceActionResult> {
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const results = await syncUser(createAdminClient(), user.id);
  revalidatePath("/", "layout");
  return { ok: true, results };
}

export async function disconnectSource(id: string): Promise<SourceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("source_connections").delete().eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, error: error.message } : { ok: true };
}
