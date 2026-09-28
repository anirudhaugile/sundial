import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser, localDbAvailable } from "@/test/local-db";
import type { Estimator } from "./estimate";

const available = await localDbAvailable();
const { sanitizeEstimates } = await import("./estimate");

describe("sanitizeEstimates", () => {
  const items = [{ id: "a" }, { id: "b" }].map((x) => ({ ...x, title: "t", course: null, points: null, dueAt: null, description: null }));
  it("drops unknown and duplicate ids, clamps hours, rounds to quarters", () => {
    const out = sanitizeEstimates(items, [
      { id: "a", hours: 2.1, reasoning: "  ok  " },
      { id: "a", hours: 9, reasoning: "dupe" },
      { id: "zzz", hours: 1, reasoning: "not asked" },
      { id: "b", hours: 500, reasoning: "" },
    ]);
    expect(out).toEqual([
      { id: "a", hours: 2, reasoning: "ok" },
      { id: "b", hours: 40, reasoning: "Estimated from the assignment details." },
    ]);
  });
  it("rejects non-finite hours", () => {
    expect(sanitizeEstimates(items, [{ id: "a", hours: NaN, reasoning: "x" }])).toEqual([]);
  });
});

describe.skipIf(!available)("ensureEstimates (integration)", () => {
  let db: ReturnType<typeof adminDb>;
  let userId: string;
  let ensureEstimates: typeof import("./estimate").ensureEstimates;
  const fake = vi.fn<Estimator>(async (items) => items.map((i) => ({ id: i.id, hours: 3, reasoning: `Guess for ${i.title}` })));

  beforeAll(async () => {
    db = adminDb();
    userId = await createTestUser(db);
    ({ ensureEstimates } = await import("./estimate"));
    await db.from("work_items").insert([
      { user_id: userId, title: "PS1", kind: "assignment", due_at: new Date(Date.now() + 86400e3).toISOString(), content_hash: "h1" },
      { user_id: userId, title: "PS2", kind: "assignment", due_at: new Date(Date.now() + 2 * 86400e3).toISOString(), content_hash: "h2" },
      { user_id: userId, title: "Todo", kind: "task", planned_for: "2026-09-28", content_hash: "h3" },
    ]);
  });
  afterAll(async () => {
    if (userId) await db.auth.admin.deleteUser(userId);
  });

  it("estimates once, caches by content hash, and respects your overrides", async () => {
    const first = await ensureEstimates(db, userId, { estimator: fake });
    expect(first).toMatchObject({ requested: 2, saved: 2 });
    expect(fake).toHaveBeenCalledTimes(1);

    // unchanged → no call
    const second = await ensureEstimates(db, userId, { estimator: fake });
    expect(second.requested).toBe(0);
    expect(fake).toHaveBeenCalledTimes(1);

    // content changed → only that item is re-estimated
    await db.from("work_items").update({ content_hash: "h1-edited" }).eq("user_id", userId).eq("title", "PS1");
    const third = await ensureEstimates(db, userId, { estimator: fake });
    expect(third.requested).toBe(1);
    expect(fake.mock.calls[1][0].map((i) => i.title)).toEqual(["PS1"]);

    // your estimate wins; the item is never sent again even if content changes
    const { data: ps2 } = await db.from("work_items").select("id").eq("user_id", userId).eq("title", "PS2").single();
    await db.from("effort_estimates").insert({ user_id: userId, work_item_id: ps2!.id, origin: "user", content_hash: "", hours: 1 });
    await db.from("work_items").update({ content_hash: "h2-edited" }).eq("id", ps2!.id);
    const fourth = await ensureEstimates(db, userId, { estimator: fake });
    expect(fourth.requested).toBe(0);
  });

  it("survives an estimator that returns garbage", async () => {
    await db.from("work_items").insert({ user_id: userId, title: "PS9", kind: "assignment", due_at: new Date().toISOString(), content_hash: "h9" });
    const bad = vi.fn<Estimator>(async () => [{ id: "not-a-real-id", hours: 2, reasoning: "?" }]);
    const res = await ensureEstimates(db, userId, { estimator: bad });
    expect(res).toMatchObject({ requested: 1, saved: 0 });
  });
});
