import type { Metadata } from "next";
import { PreferencesForm } from "@/components/preferences-form";
import { requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  return <PreferencesForm prefs={profile} />;
}
