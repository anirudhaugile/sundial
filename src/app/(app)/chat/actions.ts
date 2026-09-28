"use server";

import { revalidatePath } from "next/cache";
import { undoTool } from "@/lib/chat/tools";
import { requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export async function undoToolCall(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);
  const { data: call } = await supabase.from("tool_calls").select("*").eq("id", id).single();
  if (!call || call.status !== "applied" || !call.undo) return { ok: false, error: "Nothing to undo" };
  const res = await undoTool(call.name, call.undo as Record<string, unknown>, { db: supabase, userId: user.id, profile, tz: profile.timezone });
  if (res && "error" in res && res.error) return { ok: false, error: res.error.message };
  await supabase.from("tool_calls").update({ status: "undone" }).eq("id", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearChat(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  await supabase.from("chat_messages").delete().eq("user_id", user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; card: { id: string; name: string; summary: string; status: string; undoable: boolean; link?: string } };

/** Rebuild the visible conversation from stored messages and tool-call records. */
export async function loadChat(): Promise<ChatItem[]> {
  const supabase = await createClient();
  const { user } = await requireProfile(supabase);
  const [{ data: rows }, { data: calls }] = await Promise.all([
    supabase.from("chat_messages").select("role, content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(60),
    supabase.from("tool_calls").select("id, tool_use_id, name, summary, status, undo").eq("user_id", user.id).order("created_at", { ascending: false }).limit(120),
  ]);
  const byUse = new Map((calls ?? []).map((c) => [c.tool_use_id, c]));
  const items: ChatItem[] = [];
  for (const r of [...(rows ?? [])].reverse()) {
    if (r.role === "user") {
      if (typeof r.content === "string") items.push({ kind: "user", text: r.content });
      continue;
    }
    for (const b of (r.content as { type: string; text?: string; id?: string; name?: string }[]) ?? []) {
      if (b.type === "text" && b.text?.trim()) items.push({ kind: "text", text: b.text });
      if (b.type === "tool_use") {
        const c = byUse.get(b.id!);
        items.push({
          kind: "tool",
          card: {
            id: c?.id ?? b.id!,
            name: b.name!,
            summary: c?.summary ?? b.name!,
            status: c?.status ?? "error",
            undoable: c?.status === "applied" && !!c?.undo,
            link: b.name === "rerun_scheduler" ? "/plan" : undefined,
          },
        });
      }
    }
  }
  return items;
}
