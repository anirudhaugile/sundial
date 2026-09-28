"use client";

import { useState, useTransition } from "react";
import { Brain, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { addMemory, deleteMemory, removeNoWorkWindow } from "@/app/(app)/settings/memory/actions";
import { Button, Card, EmptyState, Input, SectionLabel } from "@/components/ui";

type Memory = { id: string; content: string; source: string; created_at: string };
type Window = { days: number[]; start: string; end: string; label?: string };
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MemoryEditor({ memories, windows, calibration }: { memories: Memory[]; windows: Window[]; calibration: { course: string; factor: number; samples: number }[] }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-10">
      <section>
        <p className="mb-5 text-sm leading-relaxed text-muted">
          Things you&apos;ve told the planner about how you work. They shape every AI estimate and every chat reply. Changing them refreshes AI estimates on the next plan.
        </p>
        <SectionLabel>What Sundial knows about you</SectionLabel>
        {memories.length ? (
          <Card className="divide-y divide-line">
            {memories.map((m) => (
              <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                <Brain size={14} className="mt-0.5 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{m.content}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {m.source === "chat" ? "From chat" : "Added by you"} · {DateTime.fromISO(m.created_at).toRelative()}
                  </p>
                </div>
                <button onClick={() => start(() => deleteMemory(m.id).then(() => undefined))} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-danger" aria-label="Forget this">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState icon={<Brain size={18} />} title="Nothing yet">
            Tell the planner things like “stats problem sets take me longer” in chat (press <span className="font-mono text-xs">/</span>), or add one here.
          </EmptyState>
        )}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addMemory(draft);
              if (r.ok) setDraft("");
              else setError(r.error ?? null);
            });
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. I focus best in the morning" aria-label="New memory" />
          <Button disabled={pending || draft.trim().length < 3}>Add</Button>
        </form>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </section>

      <section>
        <SectionLabel>No-work windows</SectionLabel>
        {windows.length ? (
          <Card className="divide-y divide-line">
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1">
                  {w.label ? <span className="font-medium">{w.label} · </span> : null}
                  {w.days.map((d) => DAY[d - 1]).join(", ")} {w.start === "00:00" && w.end === "00:00" ? "all day" : `${w.start}–${w.end === "00:00" ? "midnight" : w.end}`}
                </span>
                <button onClick={() => start(() => removeNoWorkWindow(i).then(() => undefined))} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-danger" aria-label="Remove window">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <p className="px-1 text-sm text-subtle">None. Say “no work Friday nights” in chat to add one — habits still happen, assignments stay out.</p>
        )}
      </section>

      <section>
        <SectionLabel>Estimate calibration</SectionLabel>
        {calibration.length ? (
          <Card className="divide-y divide-line">
            {calibration.map((c) => (
              <div key={c.course} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1">{c.course}</span>
                <span className="tabular-nums">×{c.factor.toFixed(2)}</span>
                <span className="w-44 text-right text-xs text-muted">from {c.samples} completed item{c.samples > 1 ? "s" : ""}</span>
              </div>
            ))}
          </Card>
        ) : (
          <p className="px-1 text-sm text-subtle">
            When you finish an assignment, Sundial compares how long it took with the estimate and adjusts future estimates for that course.
          </p>
        )}
      </section>
    </div>
  );
}
