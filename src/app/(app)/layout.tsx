import { redirect } from "next/navigation";
import { KeyboardShortcuts, MobileTabs, Sidebar } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("is_demo").eq("id", user.id).single();

  return (
    <div className="flex min-h-dvh">
      <Sidebar email={user.email ?? ""} isDemo={!!profile?.is_demo} />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-5xl px-5 pt-8 md:px-10 md:pt-12">{children}</div>
      </main>
      <MobileTabs />
      <KeyboardShortcuts />
    </div>
  );
}
