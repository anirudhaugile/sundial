import type { Metadata } from "next";
import { SourcesEditor } from "@/components/sources-editor";
import { requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sources" };

export default async function SourcesPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const { data } = await supabase.from("source_connections").select("id, kind, base_url, secret_hint, last_synced_at, last_error").order("created_at");
  return <SourcesEditor conns={(data ?? []) as never} tz={profile.timezone} isDemo={profile.is_demo} />;
}
