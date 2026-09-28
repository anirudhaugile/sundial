"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, CalendarCheck, CircleAlert, Eye, MessageCircle, RotateCcw, Sparkles, Undo2, X } from "lucide-react";
import { clearChat, loadChat, undoToolCall, type ChatItem } from "@/app/(app)/chat/actions";
import { cx, Kbd } from "@/components/ui";

const SUGGESTIONS = ["Plan my day", "I'm sick Tuesday, reshuffle", "Stats psets take me longer than you think", "No work on Friday nights"];

const TOOL_LABEL: Record<string, string> = {
  read_schedule: "Reading your calendar",
  find_free_time: "Finding free time",
  list_assignments: "Looking at assignments",
  move_block: "Moving a block",
  mark_unavailable: "Blocking off time",
  rerun_scheduler: "Asking the scheduler for a new plan",
  update_preferences: "Updating preferences",
  update_habit: "Updating a habit",
  add_habit: "Adding a habit",
  set_estimate: "Saving your estimate",
  remember: "Remembering that",
};

type Card = Extract<ChatItem, { kind: "tool" }>["card"];

export function ChatPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const show = useCallback(() => {
    setOpen(true);
    setTimeout(() => input.current?.focus(), 50);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector("[data-modal-open]")) {
        e.preventDefault();
        show();
      } else if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show]);

  useEffect(() => {
    if (open && !loaded) loadChat().then((h) => (setItems(h), setLoaded(true)));
  }, [open, loaded]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setItems((xs) => [...xs, { kind: "user", text: message }]);
    let changed = false;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "The planner couldn't answer just now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let textOpen = false; // whether the last item is the streaming assistant text
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "text") {
            setItems((xs) => {
              const last = xs[xs.length - 1];
              if (textOpen && last?.kind === "text") return [...xs.slice(0, -1), { kind: "text", text: last.text + ev.d }];
              return [...xs, { kind: "text", text: ev.d }];
            });
            textOpen = true;
          } else if (ev.t === "tool_start") {
            textOpen = false;
            setPending(TOOL_LABEL[ev.name] ?? ev.name);
          } else if (ev.t === "tool") {
            setPending(null);
            if (ev.call.status === "applied" || ev.call.status === "proposed") changed = true;
            setItems((xs) => [...xs, { kind: "tool", card: ev.call }]);
          } else if (ev.t === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setPending(null);
      if (changed) startTransition(() => router.refresh());
    }
  }

  function undo(card: Card) {
    startTransition(async () => {
      const r = await undoToolCall(card.id);
      if (r.ok) {
        setItems((xs) => xs.map((x) => (x.kind === "tool" && x.card.id === card.id ? { ...x, card: { ...x.card, status: "undone", undoable: false } } : x)));
        router.refresh();
      } else setError(r.error ?? "Couldn't undo");
    });
  }

  return (
    <>
      <button
        onClick={show}
        className={cx(
          "fixed right-4 bottom-20 z-30 flex h-11 items-center gap-2 rounded-full border border-line bg-surface pr-4 pl-3.5 text-sm shadow-[0_6px_24px_-12px_rgb(0_0_0/0.35)] transition-[opacity,transform] duration-200 hover:-translate-y-0.5 md:right-6 md:bottom-6",
          open && "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-label="Open chat"
      >
        <MessageCircle size={16} className="text-accent" />
        Ask Sundial
        <span className="hidden md:inline"><Kbd>/</Kbd></span>
      </button>

      <aside
        aria-label="Chat with the planner"
        aria-hidden={!open}
        className={cx(
          "fixed inset-0 z-40 flex flex-col bg-bg transition-[transform,opacity] duration-300 ease-[var(--ease-out-soft)] md:inset-y-0 md:right-0 md:left-auto md:w-[26rem] md:border-l md:border-line md:bg-surface",
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0",
        )}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Sparkles size={15} className="text-accent" />
          <p className="flex-1 text-sm font-medium">Planner</p>
          {items.length ? (
            <button onClick={() => startTransition(async () => { await clearChat(); setItems([]); })} className="rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-fg" title="Clear conversation" aria-label="Clear conversation">
              <RotateCcw size={14} />
            </button>
          ) : null}
          <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close chat">
            <X size={16} />
          </button>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5">
          {!items.length ? (
            <div className="animate-rise pt-6">
              <p className="text-[15px] font-medium">Talk to your planner.</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Ask about your day, tell it when you can&apos;t work, or teach it how you work. Every change shows up here as a step you can undo — and new plans still go to the Plan page for your approval.
              </p>
              {!aiEnabled ? <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg">Chat needs an Anthropic API key on the server.</p> : null}
              <div className="mt-5 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy || !aiEnabled} className="rounded-xl border border-line px-3.5 py-2.5 text-left text-sm text-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((it, i) =>
                it.kind === "user" ? (
                  <li key={i} className="ml-10 self-end rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                    {it.text}
                  </li>
                ) : it.kind === "text" ? (
                  <li key={i} className="mr-6 text-sm leading-relaxed whitespace-pre-wrap text-fg">{it.text}</li>
                ) : (
                  <li key={i}><ToolCardView card={it.card} onUndo={() => undo(it.card)} onNavigate={() => setOpen(false)} /></li>
                ),
              )}
              {pending ? (
                <li className="flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> {pending}…
                </li>
              ) : busy && items[items.length - 1]?.kind === "user" ? (
                <li className="flex gap-1 py-1">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-subtle" style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </li>
              ) : null}
            </ul>
          )}
          {error ? (
            <p className="mt-4 flex items-start gap-2 text-sm text-danger">
              <CircleAlert size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2 focus-within:border-accent">
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              placeholder={aiEnabled ? "Ask or tell the planner…" : "Chat is off on this server"}
              disabled={!aiEnabled}
              className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-subtle"
              aria-label="Message"
            />
            <button disabled={busy || !draft.trim()} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-30" aria-label="Send">
              <ArrowUp size={15} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function ToolCardView({ card, onUndo, onNavigate }: { card: Card; onUndo: () => void; onNavigate: () => void }) {
  const read = card.status === "read";
  const Icon = card.status === "error" ? CircleAlert : read ? Eye : CalendarCheck;
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]",
        card.status === "error" ? "border-danger/20 bg-danger-soft" : read ? "border-transparent text-muted" : "border-line bg-surface-2/60",
        card.status === "undone" && "opacity-60",
      )}
    >
      <Icon size={14} className={cx("shrink-0", card.status === "error" ? "text-danger" : read ? "text-subtle" : "text-accent")} />
      <span className={cx("min-w-0 flex-1", card.status === "undone" && "line-through")}>{card.summary}</span>
      {card.undoable ? (
        <button onClick={onUndo} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface hover:text-fg">
          <Undo2 size={12} /> Undo
        </button>
      ) : card.status === "undone" ? (
        <span className="text-xs text-subtle">undone</span>
      ) : card.link ? (
        <a href={card.link} onClick={onNavigate} className="shrink-0 text-xs font-medium text-accent hover:underline">
          Review →
        </a>
      ) : null}
    </div>
  );
}
