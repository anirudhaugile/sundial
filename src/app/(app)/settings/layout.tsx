import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";

const TABS = [
  { href: "/settings", label: "Preferences" },
  { href: "/settings/habits", label: "Habits" },
  { href: "/settings/courses", label: "Courses" },
];

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle="How Sundial plans around you." />
      <SettingsTabs tabs={TABS} />
      {children}
    </div>
  );
}
