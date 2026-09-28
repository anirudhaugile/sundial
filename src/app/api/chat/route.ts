import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runChat, type ChatEvent } from "@/lib/chat/agent";
import { requireProfile } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const body = z.object({ message: z.string().trim().min(1).max(2000) });

/** Streams newline-delimited JSON events: text deltas, tool cards, done. */
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say something first." }, { status: 400 });

  const supabase = await createClient();
  const { user, profile } = await requireProfile(supabase);

  // keep the public demo (and runaway loops) from burning through the API
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase.from("chat_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", since);
  const limit = profile.is_demo ? 60 : 300; // counts tool-result turns too
  if ((count ?? 0) >= limit) return NextResponse.json({ error: "That's a lot of planning for one hour. Take a break and try again soon." }, { status: 429 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runChat({ db: supabase, userId: user.id, profile, message: parsed.data.message, emit });
      } catch (e) {
        console.error("chat failed", e);
        emit({ t: "error", message: e instanceof Error && /API key/.test(e.message) ? e.message : "The planner couldn't answer just now. Try again in a moment." });
        emit({ t: "done" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
