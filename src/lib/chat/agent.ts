import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import type { DB, Profile } from "@/lib/data/queries";
import { anthropic, MODEL } from "@/lib/llm/client";
import { formatDuration } from "@/lib/time";
import { runTool, toolDefinitions, ToolInputError, type ToolCtx } from "./tools";

// A manual tool-use loop: we own it so every tool call is validated, recorded as
// a visible card, and (for mutations) undoable before the model sees the result.

type Msg = Anthropic.Beta.BetaMessageParam;

export type ChatEvent =
  | { t: "text"; d: string }
  | { t: "tool_start"; id: string; name: string }
  | { t: "tool"; call: ToolCard }
  | { t: "error"; message: string }
  | { t: "done" };

export type ToolCard = { id: string; name: string; summary: string; status: "read" | "applied" | "proposed" | "undone" | "error"; undoable: boolean; link?: string };

/** One model turn: returns the final message and streams text deltas as they arrive. */
export type ModelCall = (params: { system: Anthropic.Beta.BetaTextBlockParam[]; messages: Msg[]; tools: Anthropic.Beta.BetaTool[] }, onText: (d: string) => void) => Promise<Anthropic.Beta.BetaMessage>;

export const claudeCall: ModelCall = async ({ system, messages, tools }, onText) => {
  const client = anthropic();
  if (!client) throw new Error("Chat needs an Anthropic API key (ANTHROPIC_API_KEY).");
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    system,
    tools,
    messages,
  });
  stream.on("text", (d) => onText(d));
  return stream.finalMessage();
};

const SYSTEM = `You are the planning assistant inside Sundial, a student's personal planner. You help them understand and adjust their schedule by talking.

How Sundial works: assignments come from Canvas and the calendar from Outlook. An AI estimates hours per assignment. A deterministic scheduler — not you — places work blocks around fixed events and protected habits (the gym first, then internship applications), back-scheduling from deadlines. Plans are proposals the student approves on the Plan page.

Rules:
- You can only change things through tools. Never say you moved, added, scheduled, or changed anything unless a tool call in this conversation did it successfully.
- You never place work blocks yourself. To re-plan, change the inputs (mark_unavailable, update_preferences, update_habit, add_habit, set_estimate, remember), then call rerun_scheduler, which drafts a proposal. Tell the student to review it on the Plan page.
- Use move_block only when the student asks to move a specific block. Moving locks it.
- "I'm sick Tuesday" means: mark_unavailable for Tuesday's day hours, then rerun_scheduler.
- "Plan my day": read today's schedule and walk through it in order, briefly. If today has no work blocks and assignments are coming due, offer to draft a plan.
- Save durable facts about how the student works with remember (pace in a course, energy patterns, recurring constraints). Don't save one-off events. If a fact is also a setting — "no work Friday nights" is a no-work window via update_preferences — do both.
- Look things up before acting. Use ids from read_schedule, list_assignments, or the context below; never invent ids.
- Tool times are the student's local time as YYYY-MM-DDTHH:mm.
- Keep replies short and warm: one to four sentences, or a compact list for a day plan. No headings, no tables.`;

function context(profile: Profile, habits: { id: string; name: string; target_min: number; window_start: string; window_end: string; retired_at: string | null }[], memories: string[]) {
  const now = DateTime.now().setZone(profile.timezone);
  const windows = (profile.no_work_windows as { days: number[]; start: string; end: string; label?: string }[]) ?? [];
  return [
    `Now: ${now.toFormat("cccc, LLLL d yyyy, h:mm a")} (${profile.timezone}). Today is ${now.toISODate()}.`,
    `Preferences: day ${profile.day_start.slice(0, 5)}–${profile.day_end.slice(0, 5)}; assignment work up to ${formatDuration(profile.daily_work_cap_min)}/day; sessions ${profile.min_block_min}–${profile.max_block_min} min; finish ${profile.due_buffer_hours}h before deadlines; plans ${profile.horizon_days} days ahead.`,
    windows.length ? `No-work windows: ${windows.map((w) => `${w.label ?? "window"} (days ${w.days.join(",")} ${w.start}–${w.end})`).join("; ")}.` : "No-work windows: none.",
    `Habits: ${habits.filter((h) => !h.retired_at).map((h) => `${h.name} [id ${h.id}] ${h.target_min} min, ${h.window_start.slice(0, 5)}–${h.window_end.slice(0, 5)}`).join("; ") || "none"}.`,
    memories.length ? `What you know about the student:\n${memories.map((m) => `- ${m}`).join("\n")}` : "Nothing remembered about the student yet.",
  ].join("\n");
}

/** Drop leading rows until history starts with a real user message (not a dangling tool result). */
export function trimHistory(rows: { role: string; content: unknown }[]): Msg[] {
  let i = 0;
  const isToolResultOnly = (c: unknown) => Array.isArray(c) && c.length > 0 && c.every((b) => (b as { type?: string }).type === "tool_result");
  while (i < rows.length && (rows[i].role !== "user" || isToolResultOnly(rows[i].content))) i++;
  return rows.slice(i).map((r) => ({ role: r.role as "user" | "assistant", content: r.content as Msg["content"] }));
}

const MAX_STEPS = 8;

export async function runChat(opts: {
  db: DB;
  userId: string;
  profile: Profile;
  message: string;
  emit: (e: ChatEvent) => void;
  call?: ModelCall;
}) {
  const { db, userId, profile, message, emit } = opts;
  const call = opts.call ?? claudeCall;
  const ctx: ToolCtx = { db, userId, profile, tz: profile.timezone };

  const [{ data: rows }, { data: habits }, { data: mem }] = await Promise.all([
    db.from("chat_messages").select("role, content").eq("user_id", userId).order("created_at", { ascending: false }).limit(40),
    db.from("habits").select("id, name, target_min, window_start, window_end, retired_at").eq("user_id", userId),
    db.from("user_memory").select("content").eq("user_id", userId).order("created_at").limit(40),
  ]);
  const messages = trimHistory([...(rows ?? [])].reverse());
  const userMsg: Msg = { role: "user", content: message };
  messages.push(userMsg);
  await db.from("chat_messages").insert({ user_id: userId, role: "user", content: message });

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM },
    { type: "text", text: context(profile, habits ?? [], (mem ?? []).map((m) => m.content)) },
  ];
  const tools = toolDefinitions();

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await call({ system, messages, tools }, (d) => emit({ t: "text", d }));

    // keep the full content (thinking blocks included) so the next turn replays it unchanged
    messages.push({ role: "assistant", content: response.content as Msg["content"] });
    await db.from("chat_messages").insert({ user_id: userId, role: "assistant", content: response.content as never });

    if (response.stop_reason === "refusal") {
      emit({ t: "error", message: "I can't help with that one." });
      break;
    }
    if (response.stop_reason === "max_tokens") {
      emit({ t: "error", message: "That reply ran long and got cut off. Try asking a narrower question." });
      break;
    }
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) break;

    // run every tool call from this turn, then return all results in one user message
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      emit({ t: "tool_start", id: use.id, name: use.name });
      let card: ToolCard;
      try {
        const out = await runTool(use.name, use.input, ctx);
        const { data: rec } = await db
          .from("tool_calls")
          .insert({ user_id: userId, tool_use_id: use.id, name: use.name, input: use.input as never, result: out.result as never, summary: out.summary, status: out.status, undo: (out.undo ?? null) as never })
          .select("id")
          .single();
        card = { id: rec?.id ?? use.id, name: use.name, summary: out.summary, status: out.status, undoable: !!out.undo, link: out.link };
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.result) });
      } catch (e) {
        const msg = e instanceof ToolInputError ? e.message : "Something went wrong running that.";
        if (!(e instanceof ToolInputError)) console.error("tool failed", use.name, e);
        await db.from("tool_calls").insert({ user_id: userId, tool_use_id: use.id, name: use.name, input: use.input as never, summary: msg, status: "error" });
        card = { id: use.id, name: use.name, summary: msg, status: "error", undoable: false };
        results.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
      }
      emit({ t: "tool", call: card });
    }
    const toolMsg: Msg = { role: "user", content: results };
    messages.push(toolMsg);
    await db.from("chat_messages").insert({ user_id: userId, role: "user", content: results as never });
  }
  emit({ t: "done" });
}
