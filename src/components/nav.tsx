"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { CalendarDays, CalendarRange, ListChecks, Settings, Sparkles, Sun } from "lucide-react";
import { cx, Kbd } from "@/components/ui";
import { Wordmark } from "@/components/logo";

export const NAV = [
  { href: "/today", label: "Today", icon: Sun, key: "t" },
  { href: "/week", label: "Week", icon: CalendarRange, key: "w" },
  { href: "/month", label: "Month", icon: CalendarDays, key: "m" },
  { href: "/plan", label: "Plan", icon: Sparkles, key: "p" },
  { href: "/assignments", label: "Assignments", icon: ListChecks, key: "a" },
] as const;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Global single-key shortcuts: t w m p a, "," for settings. "/" (chat) and "n" (new) live in their components. */
export function KeyboardShortcuts() {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("[data-modal-open]")) return;
      const item = NAV.find((n) => n.key === e.key);
      if (item) router.push(item.href);
      else if (e.key === ",") router.push("/settings");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}

export function Sidebar({ email, isDemo }: { email: string; isDemo: boolean }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line px-3 py-5 md:flex">
      <Link href="/today" className="mb-8 px-2"><Wordmark /></Link>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon, key }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "group flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors duration-150",
                active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
              )}
            >
              <Icon size={16} strokeWidth={1.8} className={active ? "text-accent" : ""} />
              <span className="flex-1">{label}</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100"><Kbd>{key}</Kbd></span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <Link
          href="/settings"
          className={cx(
            "flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors",
            path.startsWith("/settings") ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
          )}
        >
          <Settings size={16} strokeWidth={1.8} /> Settings
        </Link>
        <div className="mt-3 border-t border-line px-2 pt-3">
          {isDemo ? <p className="mb-1 text-xs font-medium text-accent">Demo account</p> : null}
          <p className="truncate text-xs text-subtle" title={email}>{email}</p>
          <form action="/auth/signout" method="post">
            <button className="mt-1 text-xs text-muted hover:text-fg">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export function MobileTabs() {
  const path = usePathname();
  const items = [...NAV.slice(0, 4), { href: "/settings", label: "Settings", icon: Settings, key: "," }];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <div className="mx-auto flex max-w-md">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-fg" : "text-subtle")}>
              <Icon size={19} strokeWidth={1.8} className={active ? "text-accent" : ""} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
