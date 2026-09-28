import { createHash } from "node:crypto";

/**
 * Hash of the fields that affect effort. Due date is deliberately excluded:
 * moving a deadline doesn't change how long the work takes.
 */
export function contentHash(item: { title: string; description?: string | null; points?: number | null; courseName?: string | null }) {
  const normalized = [
    item.title.trim(),
    (item.description ?? "").replace(/\s+/g, " ").trim(),
    item.points ?? "",
    item.courseName ?? "",
  ].join("␟");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}
