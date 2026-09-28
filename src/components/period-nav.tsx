import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PeriodNav({ base, prev, next, today, isCurrent }: { base: string; prev: string; next: string; today: string; isCurrent: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={`${base}?d=${prev}`} className={buttonClass("ghost", "icon")} aria-label="Previous">
        <ChevronLeft size={16} />
      </Link>
      <Link href={`${base}?d=${today}`} className={buttonClass(isCurrent ? "ghost" : "secondary", "sm")}>Today</Link>
      <Link href={`${base}?d=${next}`} className={buttonClass("ghost", "icon")} aria-label="Next">
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
