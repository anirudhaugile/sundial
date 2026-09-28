import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Month" };

export default function Page() {
  return (
    <>
      <PageHeader title="Month" />
      <EmptyState title="Coming together">This view is being built.</EmptyState>
    </>
  );
}
