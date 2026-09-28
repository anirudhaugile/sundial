import type { Metadata } from "next";
import { CoursesEditor } from "@/components/courses-editor";
import { getCourses } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage() {
  const supabase = await createClient();
  return <CoursesEditor courses={await getCourses(supabase)} />;
}
