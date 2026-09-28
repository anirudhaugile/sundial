import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Week" };

export default function Page() {
  return (
    <>
      <PageHeader title="Week" />
      <EmptyState title="Coming together">This view is being built.</EmptyState>
    </>
  );
}
