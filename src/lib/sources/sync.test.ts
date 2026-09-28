import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser, localDbAvailable } from "@/test/local-db";

const available = await localDbAvailable();
const tz = "America/Chicago";
const inDays = (d: number, h = 23, m = 59) => DateTime.now().setZone(tz).startOf("day").plus({ days: d }).set({ hour: h, minute: m }).toUTC().toISO()!;

// fake upstreams ---------------------------------------------------------
let assignments: Record<string, unknown>[] = [];
let ics = "";
const realFetch = globalThis.fetch;
function fakeFetch(url: string | URL | Request, init?: RequestInit) {
  const u = url instanceof Request ? url.url : String(url);
  if (u.startsWith("http://127.0.0.1")) return realFetch(url, init); // local Supabase
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  if (u.includes("/api/v1/courses?")) return json([{ id: 11, name: "Data Structures", course_code: "CS 225" }]);
  if (u.includes("/api/v1/courses/11/assignments") && !u.includes("page=2")) {
    return json(assignments.slice(0, 2), { link: `<https://canvas.test.edu/api/v1/courses/11/assignments?page=2>; rel="next"` });
  }
  if (u.includes("page=2")) return json(assignments.slice(2));
  if (u.startsWith("https://outlook.test.com/")) return new Response(ics, { status: 200 });
  return new Response("nope", { status: 404 });
}

describe.skipIf(!available)("syncUser (integration, local Supabase)", () => {
  let db: ReturnType<typeof adminDb>;
  let userId: string;
  let syncUser: typeof import("./sync").syncUser;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    db = adminDb();
    userId = await createTestUser(db);
    ({ syncUser } = await import("./sync"));
    const { encryptSecret } = await import("@/lib/crypto");
    const { data: c1 } = await db.from("source_connections").insert({ user_id: userId, kind: "canvas_api", base_url: "https://canvas.test.edu" }).select("id").single();
    const { data: c2 } = await db.from("source_connections").insert({ user_id: userId, kind: "outlook_ics" }).select("id").single();
    await db.from("source_secrets").insert([
      { connection_id: c1!.id, user_id: userId, ciphertext: encryptSecret("token-abcdefghijklmnopqrstuvwxyz") },
      { connection_id: c2!.id, user_id: userId, ciphertext: encryptSecret("https://outlook.test.com/calendar.ics") },
    ]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (userId) await db.auth.admin.deleteUser(userId);
  });

  it("imports, re-syncs without duplicates, soft-removes, and checks off submissions", async () => {
    assignments = [
      { id: 1, name: "MP1", description: "<p>Implement a <b>list</b></p>", due_at: inDays(3), points_possible: 50, html_url: "https://canvas.test.edu/a/1" },
      { id: 2, name: "MP2", description: null, due_at: inDays(8), points_possible: 100, html_url: "https://canvas.test.edu/a/2" },
      { id: 3, name: "Quiz", description: null, due_at: inDays(5), points_possible: 10, html_url: "https://canvas.test.edu/a/3" },
      { id: 4, name: "No due date", description: null, due_at: null, points_possible: 5, html_url: "x" },
      { id: 5, name: "Way later", description: null, due_at: inDays(90), points_possible: 5, html_url: "x" },
    ];
    const start = DateTime.now().setZone(tz).startOf("day").plus({ days: 1 }).set({ hour: 10 });
    const stamp = (d: DateTime) => d.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
    ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:meet-1",
      "SUMMARY:1:1",
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(start.plus({ minutes: 30 }))}`,
      "RRULE:FREQ=DAILY;COUNT=3",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const first = await syncUser(db, userId);
    expect(first.every((r) => r.ok)).toBe(true);
    expect(first.find((r) => r.kind === "canvas_api")!.counts).toMatchObject({ inserted: 3, updated: 0 });

    const second = await syncUser(db, userId);
    expect(second.find((r) => r.kind === "canvas_api")!.counts).toMatchObject({ inserted: 0, updated: 3, removed: 0 });
    expect(second.find((r) => r.kind === "outlook_ics")!.counts).toMatchObject({ inserted: 0, updated: 3 });

    const { data: items } = await db.from("work_items").select("external_id, title, description, course_id").eq("user_id", userId).order("external_id");
    expect(items!.map((i) => i.external_id)).toEqual(["1", "2", "3"]);
    expect(items![0].description).toBe("Implement a list");
    expect(items!.every((i) => i.course_id)).toBe(true);
    const { count: eventCount } = await db.from("events").select("*", { count: "exact", head: true }).eq("user_id", userId);
    expect(eventCount).toBe(3);

    // quiz deleted upstream, MP1 submitted
    assignments = assignments.filter((a) => a.id !== 3).map((a) => (a.id === 1 ? { ...a, submission: { workflow_state: "submitted", submitted_at: new Date().toISOString() } } : a));
    const third = await syncUser(db, userId);
    expect(third.find((r) => r.kind === "canvas_api")!.counts.removed).toBe(1);
    const { data: after } = await db.from("work_items").select("external_id, status, removed_at").eq("user_id", userId).order("external_id");
    expect(after!.map((i) => [i.external_id, i.status, !!i.removed_at])).toEqual([
      ["1", "done", false],
      ["2", "open", false],
      ["3", "open", true],
    ]);

    // coming back un-removes it
    assignments.push({ id: 3, name: "Quiz", description: null, due_at: inDays(5), points_possible: 10, html_url: "x" });
    await syncUser(db, userId);
    const { data: back } = await db.from("work_items").select("removed_at").eq("user_id", userId).eq("external_id", "3").single();
    expect(back!.removed_at).toBeNull();
  });

  it("records a friendly error when a source fails", async () => {
    const { encryptSecret } = await import("@/lib/crypto");
    const { data: c } = await db.from("source_connections").select("id").eq("user_id", userId).eq("kind", "outlook_ics").single();
    await db.from("source_secrets").update({ ciphertext: encryptSecret("https://outlook.test.com/missing.ics") }).eq("connection_id", c!.id);
    ics = "not a calendar";
    const res = await syncUser(db, userId, c!.id);
    expect(res[0]).toMatchObject({ ok: false });
    expect(res[0].error).toMatch(/calendar/);
    const { data: conn } = await db.from("source_connections").select("last_error").eq("id", c!.id).single();
    expect(conn!.last_error).toBeTruthy();
  });
});
