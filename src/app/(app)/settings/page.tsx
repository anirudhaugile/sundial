import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState title="Coming together">This view is being built.</EmptyState>
    </>
  );
}
