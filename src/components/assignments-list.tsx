"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ExternalLink, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { clearEstimate, deleteWorkItem, setActualMinutes, setEstimate, setWorkItemDone } from "@/app/(app)/actions";
import { Checkbox } from "@/components/today-view";
import { cx, EmptyState, SectionLabel } from "@/components/ui";
import { formatDue, formatDuration } from "@/lib/time";

export type AssignmentRow = {
  id: string;
  title: string;
  course: string | null;
  tint: string;
  dueAt: string | null;
  done: boolean;
  source: string;
  url: string | null;
  hours: number;
  origin: "user" | "llm" | "default";
  reasoning: string;
  plannedMin: number;
  doneMin: number;
  estimatedMin?: number | null;
  calibration: string | null;
};

export function AssignmentsList({ tz, nowISO, rows }: { tz: string; nowISO: string; rows: AssignmentRow[] }) {
  const now = DateTime.fromISO(nowISO).setZone(tz);
  const [, start] = useTransition();
  const [flipped, flip] = useOptimistic<Set<string>, string>(new Set(), (s, id) => new Set(s).add(id));
  const isDone = (r: AssignmentRow) => (flipped.has(r.id) ? !r.done : r.done);

  const overdue = rows.filter((r) => !isDone(r) && r.dueAt && DateTime.fromISO(r.dueAt) < now);
  const upcoming = rows.filter((r) => !isDone(r) && (!r.dueAt || DateTime.fromISO(r.dueAt) >= now));
  const finished = rows.filter(isDone);

  const toggle = (r: AssignmentRow) =>
    start(async () => {
      flip(r.id);
      await setWorkItemDone(r.id, !r.done);
    });

  if (!rows.length) {
    return (
      <EmptyState title="No assignments yet">
        Connect Canvas in Settings to import them, or press <span className="font-mono text-xs">n</span> to add one by hand.
      </EmptyState>
    );
  }

  const section = (title: string, list: AssignmentRow[]) =>
    list.length ? (
      <section className="mb-10">
        <SectionLabel>{title}</SectionLabel>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {list.map((r) => <Row key={r.id} r={r} tz={tz} now={now} done={isDone(r)} onToggle={() => toggle(r)} />)}
        </ul>
      </section>
    ) : null;

  return (
    <>
      {section("Overdue", overdue)}
      {section("Upcoming", upcoming)}
      {section("Done", finished)}
    </>
  );
}

function Row({ r, tz, now, done, onToggle }: { r: AssignmentRow; tz: string; now: DateTime; done: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(r.hours));
  const [pending, start] = useTransition();
  const due = r.dueAt ? DateTime.fromISO(r.dueAt).setZone(tz) : null;
  const late = !done && due && due < now;

  return (
    <li className={cx(`tint-${r.tint} flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line px-4 py-3.5 last:border-b-0`, done && "opacity-60")}>
      <div className="pt-0.5"><Checkbox checked={done} onChange={onToggle} label={`Mark ${r.title} ${done ? "not done" : "done"}`} /></div>
      <div className="min-w-0 flex-1 basis-56">
        <p className={cx("flex items-center gap-1.5 text-sm font-medium", done && "line-through")}>
          <span className="truncate">{r.title}</span>
          {r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0 text-subtle hover:text-fg" aria-label="Open in Canvas">
              <ExternalLink size={12} />
            </a>
          ) : null}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tint)" }} />
          {[r.course ?? "No course", due ? `due ${formatDue(due, now)}` : "no due date"].join(" · ")}
          {late ? <span className="text-warn">· late</span> : null}
        </p>
        {!done && r.origin !== "user" ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            {r.origin === "llm" ? <Sparkles size={12} className="mt-0.5 shrink-0 text-accent" /> : null}
            <span>
              {r.reasoning}
              {r.calibration ? <span className="text-subtle"> {r.calibration}</span> : null}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {!done ? (
          editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
                const h = Number(value);
                if (h > 0 && h !== r.hours) start(() => setEstimate(r.id, h).then(() => undefined));
              }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                type="number"
                step="0.25"
                min="0.25"
                max="80"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setEditing(false)}
                className="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums focus:border-accent focus:outline-none"
                aria-label={`Hours for ${r.title}`}
              />
              <span className="text-xs text-muted">h</span>
            </form>
          ) : (
            <button disabled={pending} onClick={() => setEditing(true)} className="w-24 rounded-md px-2 py-1 text-right hover:bg-surface-2" title="Change estimate">
              <span className="block text-sm font-medium tabular-nums">{formatDuration(r.hours * 60)}</span>
              <span className="block text-[11px] text-subtle">
                {r.origin === "user" ? "your estimate" : r.origin === "llm" ? "AI estimate" : "default"}
              </span>
            </button>
          )
        ) : null}
        <div className="w-28 text-right text-xs text-muted">
          {done ? (
            <ActualTime r={r} />
          ) : r.plannedMin ? (
            `${formatDuration(r.plannedMin)} planned`
          ) : (
            <span className="text-subtle">not planned</span>
          )}
        </div>
        <div className="flex w-14 justify-end gap-0.5">
        {r.origin === "user" && !done ? (
          <button onClick={() => start(() => clearEstimate(r.id).then(() => undefined))} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" title="Use the AI estimate again" aria-label="Reset estimate">
            <RotateCcw size={13} />
          </button>
        ) : null}
        {r.source === "manual" ? (
          <button onClick={() => start(() => deleteWorkItem(r.id).then(() => undefined))} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-danger" aria-label={`Delete ${r.title}`}>
            <Trash2 size={13} />
          </button>
        ) : null}
        </div>
      </div>
    </li>
  );
}

/** Finished items: how long it actually took (editable), against what was estimated. */
function ActualTime({ r }: { r: AssignmentRow }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.doneMin ? String(Math.round((r.doneMin / 60) * 4) / 4) : "");
  const [, start] = useTransition();
  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          const h = value.trim() === "" ? null : Number(value);
          start(() => setActualMinutes(r.id, h == null ? null : h * 60).then(() => undefined));
        }}
        className="flex items-center justify-end gap-1"
      >
        <input
          autoFocus
          type="number"
          step="0.25"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          className="h-7 w-14 rounded-md border border-line-strong bg-surface px-1.5 text-right text-xs tabular-nums focus:border-accent focus:outline-none"
          aria-label={`Hours actually spent on ${r.title}`}
        />
        h
      </form>
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="rounded px-1 py-0.5 hover:bg-surface-2 hover:text-fg" title="How long did it actually take?">
      {r.doneMin ? `${formatDuration(r.doneMin)} spent` : "log time"}
      {r.estimatedMin ? <span className="block text-[11px] text-subtle">est. {formatDuration(r.estimatedMin)}</span> : null}
    </button>
  );
}
