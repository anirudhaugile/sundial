import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Assignments" };

export default function Page() {
  return (
    <>
      <PageHeader title="Assignments" />
      <EmptyState title="Coming together">This view is being built.</EmptyState>
    </>
  );
}
