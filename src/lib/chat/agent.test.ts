import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, localDbAvailable, userSession } from "@/test/local-db";
import type { ChatEvent, ModelCall } from "./agent";

const available = await localDbAvailable();
const { trimHistory } = await import("./agent");

describe("trimHistory", () => {
  it("starts at a real user message, never a dangling tool result", () => {
    const rows = [
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "{}" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "plan my day" },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
    ];
    expect(trimHistory(rows).map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

/** A scripted stand-in for Claude: returns the next canned turn and records what it was sent. */
function scripted(turns: { content: unknown[]; stop_reason: string }[]) {
  const seen: { messages: unknown[]; toolNames: string[] }[] = [];
  const call: ModelCall = async ({ messages, tools }, onText) => {
    seen.push({ messages: structuredClone(messages), toolNames: tools.map((t) => t.name) });
    const turn = turns.shift()!;
    for (const b of turn.content as { type: string; text?: string }[]) if (b.type === "text") onText(b.text!);
    return { id: "msg", type: "message", role: "assistant", model: "fake", content: turn.content, stop_reason: turn.stop_reason, usage: {} } as never;
  };
  return { call, seen };
}

describe.skipIf(!available)("runChat (integration, fake model)", () => {
  const admin = adminDb();
  let db: Awaited<ReturnType<typeof userSession>>["client"];
  let userId: string;
  let runChat: typeof import("./agent").runChat;
  let undoTool: typeof import("./tools").undoTool;

  beforeAll(async () => {
    ({ client: db, userId } = await userSession(admin));
    ({ runChat } = await import("./agent"));
    ({ undoTool } = await import("./tools"));
    await db.from("work_items").insert({ user_id: userId, title: "PS 1", kind: "assignment", due_at: DateTime.now().plus({ days: 3 }).toUTC().toISO(), content_hash: "c1" });
  });
  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  const profile = async () => (await db.from("profiles").select("*").eq("id", userId).single()).data!;

  it("'sick Tuesday': blocks the day, re-plans as a proposal, records every step, and can undo", async () => {
    const tz = "America/Chicago";
    const tue = DateTime.now().setZone(tz).plus({ weeks: 1 }).set({ weekday: 2 }).toISODate();
    const { call, seen } = scripted([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Sorry you're sick. Clearing Tuesday." },
          { type: "tool_use", id: "tu1", name: "mark_unavailable", input: { start: `${tue}T08:00`, end: `${tue}T23:30`, reason: "Sick" } },
        ],
      },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu2", name: "rerun_scheduler", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done — review the new plan on the Plan page." }] },
    ]);
    const events: ChatEvent[] = [];
    await runChat({ db, userId, profile: await profile(), message: "I'm sick Tuesday, reshuffle", emit: (e) => events.push(e), call });

    // what the UI saw
    const cards = events.filter((e) => e.t === "tool").map((e) => (e as Extract<ChatEvent, { t: "tool" }>).call);
    expect(cards.map((c) => [c.name, c.status, c.undoable])).toEqual([
      ["mark_unavailable", "applied", true],
      ["rerun_scheduler", "proposed", false],
    ]);
    expect(events.at(-1)).toEqual({ t: "done" });

    // what actually changed: an unavailable event, and a proposal (not a committed calendar)
    const { data: ev } = await db.from("events").select("kind, title").eq("user_id", userId);
    expect(ev).toEqual([{ kind: "unavailable", title: "Sick" }]);
    const { data: runs } = await db.from("plan_runs").select("status, trigger").eq("user_id", userId);
    expect(runs).toEqual([{ status: "proposed", trigger: "chat" }]);
    const { count: scheduled } = await db.from("blocks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "scheduled");
    expect(scheduled).toBe(0);

    // the model got tool results back, and the conversation was stored
    expect(seen[1].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu1" }] });
    expect(seen[0].toolNames).toContain("rerun_scheduler");
    const { count: stored } = await db.from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", userId);
    expect(stored).toBe(6); // user, assistant, tool results, assistant, tool results, assistant

    // undo the mark_unavailable
    const { data: rec } = await db.from("tool_calls").select("name, undo").eq("user_id", userId).eq("name", "mark_unavailable").single();
    await undoTool(rec!.name, rec!.undo as Record<string, unknown>, { db, userId, profile: await profile(), tz });
    const { count: left } = await db.from("events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    expect(left).toBe(0);
  });

  it("feeds invalid tool input back to the model as an error instead of running it", async () => {
    const { call, seen } = scripted([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "bad", name: "move_block", input: { block_id: "not-a-uuid", start: "tomorrow" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Which block did you mean?" }] },
    ]);
    const events: ChatEvent[] = [];
    await runChat({ db, userId, profile: await profile(), message: "move it", emit: (e) => events.push(e), call });
    expect(seen[1].messages.at(-1)).toMatchObject({ content: [{ type: "tool_result", is_error: true }] });
    expect(events.find((e) => e.t === "tool")).toMatchObject({ call: { status: "error" } });
  });

  it("remember + no-work window: saves the fact, updates the setting, clears stale AI estimates", async () => {
    const { data: item } = await db.from("work_items").select("id").eq("user_id", userId).single();
    await db.from("effort_estimates").insert({ user_id: userId, work_item_id: item!.id, origin: "llm", content_hash: "c1", hours: 2 });
    const { call } = scripted([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "r1", name: "remember", input: { fact: "Doesn't do schoolwork on Friday nights." } },
          { type: "tool_use", id: "p1", name: "update_preferences", input: { no_work_windows: [{ days: [5], start: "18:00", end: "00:00", label: "Friday nights" }] } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Got it." }] },
    ]);
    await runChat({ db, userId, profile: await profile(), message: "No work on Friday nights", emit: () => {}, call });
    const { data: mem } = await db.from("user_memory").select("content").eq("user_id", userId);
    expect(mem!.map((m) => m.content)).toEqual(["Doesn't do schoolwork on Friday nights."]);
    expect((await profile()).no_work_windows).toEqual([{ days: [5], start: "18:00", end: "00:00", label: "Friday nights" }]);
    const { count } = await db.from("effort_estimates").select("id", { count: "exact", head: true }).eq("work_item_id", item!.id).eq("origin", "llm");
    expect(count).toBe(0);
  });
});
