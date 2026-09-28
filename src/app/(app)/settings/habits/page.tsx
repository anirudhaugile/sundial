import type { Metadata } from "next";
import { DateTime } from "luxon";
import { HabitsEditor } from "@/components/habits-editor";
import { getHabits, requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Habits" };

export default async function HabitsPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const habits = await getHabits(supabase, { includeRetired: true });
  return <HabitsEditor habits={habits} today={DateTime.now().setZone(profile.timezone).toISODate()!} />;
}
