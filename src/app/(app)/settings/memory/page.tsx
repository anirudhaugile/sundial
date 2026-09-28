import type { Metadata } from "next";
import { MemoryEditor } from "@/components/memory-editor";
import { getCourses, requireProfile } from "@/lib/data/queries";
import { loadCalibration } from "@/lib/planner/estimates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Memory" };

export default async function MemoryPage() {
  const supabase = await createClient();
  const { profile } = await requireProfile(supabase);
  const [{ data: memories }, courses, cal] = await Promise.all([
    supabase.from("user_memory").select("id, content, source, created_at").order("created_at"),
    getCourses(supabase),
    loadCalibration(supabase),
  ]);
  const calibration = courses
    .filter((c) => cal.map.has(c.id))
    .map((c) => ({ course: c.code || c.name, ...cal.map.get(c.id)! }));
  return <MemoryEditor memories={memories ?? []} windows={(profile.no_work_windows as never) ?? []} calibration={calibration} />;
}
