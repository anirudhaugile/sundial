"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, CircleAlert, Lock, RefreshCw, Sparkles, X } from "lucide-react";
import { DateTime } from "luxon";
import { approvePlan, discardPlan, removeProposedBlock, runPlanner, setEstimateAndReplan } from "@/app/(app)/plan/actions";
import { openEditor } from "@/components/item-editor";
import { Button, Card, cx, SectionLabel } from "@/components/ui";
import { formatDue, formatDuration, formatTime } from "@/lib/time";
import type { AgendaItem } from "@/lib/view";

export type PlanItemRow = {
  id: string;
  title: string;
  course: string | null;
  tint: string;
  dueAt: string;
  hours: number;
  origin: "user" | "llm" | "default";
  reasoning: string;
  remainingMin: number;
  placedMin: number;
  startBy: string | null;
  status: string;
  calibration?: string | null;
};

export type ConflictRow = { id: string; severity: "warning" | "error"; message: string };
export type RemovedRow = { id: string; title: string; start: string; end: string; tint: string };

type Props = {
  tz: string;
  nowISO: string;
  runId: string;
  createdAt: string;
  blocks: (AgendaItem & { unchanged: boolean })[];
  removed: RemovedRow[];
  conflicts: ConflictRow[];
  items: PlanItemRow[];
  stats: { workMin: number; habitMin: number; days: number };
};

const ORIGIN_LABEL = { user: "yours", llm: "AI", default: "default" } as const;

export function PlanReview({ tz, nowISO, runId, createdAt, blocks, removed, conflicts, items, stats }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = DateTime.fromISO(nowISO).setZone(tz);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
    });

  // group proposal + removals by day
  const days = new Map<string, { added: typeof blocks; removed: RemovedRow[] }>();
  const dayKey = (iso: string) => DateTime.fromISO(iso).setZone(tz).toISODate()!;
  for (const b of blocks) {
    const k = dayKey(b.start);
    if (!days.has(k)) days.set(k, { added: [], removed: [] });
    days.get(k)!.added.push(b);
  }
  for (const r of removed) {
    const k = dayKey(r.start);
    if (!days.has(k)) days.set(k, { added: [], removed: [] });
    days.get(k)!.removed.push(r);
  }
  const isRoutine = (b: (typeof blocks)[number]) => b.kind === "habit" && !/Shortened|Moved/.test(b.reasoning ?? "");
  const sortedDays = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  // consecutive days that only hold routine habits collapse into one line
  type Group = { kind: "day"; day: string; added: typeof blocks; removed: RemovedRow[] } | { kind: "routine"; from: string; to: string; names: string[] };
  const groups: Group[] = [];
  for (const [day, g] of sortedDays) {
    const quiet = !g.removed.length && g.added.every(isRoutine);
    const last = groups[groups.length - 1];
    if (quiet) {
      const names = [...new Set(g.added.map((b) => b.title))];
      if (last?.kind === "routine") {
        last.to = day;
        for (const n of names) if (!last.names.includes(n)) last.names.push(n);
      } else groups.push({ kind: "routine", from: day, to: day, names });
    } else groups.push({ kind: "day", day, ...g });
  }

  function renderDay(day: string, added: typeof blocks, gone: RemovedRow[]) {
    return (
      <div>
                <p className="mb-2 px-1 text-sm font-medium">
                  {DateTime.fromISO(day, { zone: tz }).toFormat("cccc")}{" "}
                  <span className="font-normal text-muted">{DateTime.fromISO(day, { zone: tz }).toFormat("LLL d")}</span>
                </p>
                {(() => {
                  const routine = added.filter((b) => b.kind === "habit" && !/Shortened|Moved/.test(b.reasoning ?? "")).sort((a, b) => a.start.localeCompare(b.start));
                  return routine.length ? (
                    <p className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-3 text-xs text-muted">
                      {routine.map((b) => (
                        <button key={b.id} onClick={() => openEditor(b)} className={`tint-${b.tint} inline-flex items-center gap-1.5 hover:text-fg`}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tint)" }} />
                          {b.title} {formatTime(DateTime.fromISO(b.start).setZone(tz))}
                        </button>
                      ))}
                    </p>
                  ) : null;
                })()}
                <ul className="flex flex-col gap-1">
                  {added
                    .filter((b) => !(b.kind === "habit" && !/Shortened|Moved/.test(b.reasoning ?? "")))
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((b) => (
                      <li key={b.id} className={`tint-${b.tint} group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface`}>
                        <span className="mt-1 h-4 w-1 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
                        <button onClick={() => openEditor(b)} className="hidden w-32 shrink-0 text-left text-[13px] tabular-nums text-muted hover:text-fg sm:block">
                          {formatTime(DateTime.fromISO(b.start).setZone(tz))} – {formatTime(DateTime.fromISO(b.end).setZone(tz))}
                        </button>
                        <div className="min-w-0 flex-1">
                          <button onClick={() => openEditor(b)} className="mb-0.5 text-xs tabular-nums text-muted sm:hidden">
                            {formatTime(DateTime.fromISO(b.start).setZone(tz))} – {formatTime(DateTime.fromISO(b.end).setZone(tz))}
                          </button>
                          <p className="flex items-center gap-1.5 text-sm">
                            <span className="truncate">{b.title}</span>
                            {b.locked ? <Lock size={11} className="text-subtle" /> : null}
                            {b.unchanged ? (
                              <span className="text-[11px] text-subtle">unchanged</span>
                            ) : (
                              <span className="rounded bg-accent-soft px-1 text-[10px] font-medium uppercase tracking-wide text-accent">new</span>
                            )}
                          </p>
                          {b.reasoning ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{b.reasoning}</p> : null}
                        </div>
                        <button
                          onClick={() => run(() => removeProposedBlock(b.id))}
                          className="rounded p-1 text-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100 max-md:opacity-100"
                          aria-label={`Remove ${b.title} from proposal`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  {gone.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-subtle">
                      <span className="h-4 w-1 shrink-0" />
                      <span className="w-32 shrink-0 text-[13px] tabular-nums line-through">
                        {formatTime(DateTime.fromISO(r.start).setZone(tz))} – {formatTime(DateTime.fromISO(r.end).setZone(tz))}
                      </span>
                      <span className="truncate text-sm line-through">{r.title}</span>
                      <span className="text-[11px]">removed</span>
                    </li>
                  ))}
                </ul>
      </div>
    );
  }

  const errors = conflicts.filter((c) => c.severity === "error");
  const warnings = conflicts.filter((c) => c.severity === "warning");
  const changed = blocks.filter((b) => !b.unchanged).length + removed.length;
  const workSessions = blocks.filter((b) => b.kind === "work").length;

  return (
    <div className="pb-28">
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Focused work" value={formatDuration(stats.workMin)} sub={`${workSessions} sessions`} />
        <Stat label="Habits" value={formatDuration(stats.habitMin)} sub="protected" />
        <Stat label="Assignments" value={String(items.filter((i) => i.remainingMin > 0).length)} sub={`next ${stats.days} days`} />
        <Stat label="Changes" value={String(changed)} sub="vs. your calendar" tone={errors.length ? "danger" : undefined} />
      </div>

      {errors.length || warnings.length ? (
        <section className="mb-10">
          <SectionLabel>Needs your attention</SectionLabel>
          <ul className="flex flex-col gap-2">
            {errors.map((c) => (
              <li key={c.id} className="flex gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-fg">
                <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
                {c.message}
              </li>
            ))}
            {warnings.map((c) => (
              <li key={c.id} className="flex gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-fg">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
                {c.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-10">
        <SectionLabel>Estimates</SectionLabel>
        <Card className="divide-y divide-line">
          {items.length ? (
            items.map((it) => <EstimateRow key={it.id} it={it} tz={tz} now={now} disabled={pending} onSet={(h) => run(() => setEstimateAndReplan(it.id, h))} />)
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted">No assignments due in the planning window.</p>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>Proposed schedule</SectionLabel>
        {sortedDays.length ? (
          <div className="flex flex-col gap-6">
            {groups.map((g) =>
              g.kind === "routine" ? (
                <p key={g.from} className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">
                  <span className="font-medium text-fg">
                    {DateTime.fromISO(g.from, { zone: tz }).toFormat("ccc LLL d")}
                    {g.to !== g.from ? ` – ${DateTime.fromISO(g.to, { zone: tz }).toFormat("ccc LLL d")}` : ""}
                  </span>
                  {" · "}
                  {g.names.join(" and ")} at the usual times. No assignment work needed.
                </p>
              ) : (
              <div key={g.day}>{renderDay(g.day, g.added, g.removed)}</div>
              ),
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
            The planner didn&apos;t need to place anything. Add habits or assignments and re-plan.
          </p>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-bg/90 backdrop-blur-md md:bottom-0 md:left-56">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-10">
          <p className="text-xs text-muted">
            Proposed {DateTime.fromISO(createdAt).setZone(tz).toRelative()}. Nothing changes until you approve.
            {error ? <span className="ml-2 text-danger">{error}</span> : null}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => discardPlan(runId))}>Discard</Button>
            <Button size="sm" disabled={pending} onClick={() => run(runPlanner)}>
              <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> Re-plan
            </Button>
            <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => approvePlan(runId))}>
              <Check size={14} /> Approve plan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-subtle">{label}</p>
      <p className={cx("mt-0.5 text-xl font-semibold tabular-nums tracking-[-0.02em]", tone === "danger" && "text-danger")}>{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

function EstimateRow({ it, tz, now, disabled, onSet }: { it: PlanItemRow; tz: string; now: DateTime; disabled: boolean; onSet: (h: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(it.hours));
  const due = DateTime.fromISO(it.dueAt).setZone(tz);
  const startBy = it.startBy ? DateTime.fromISO(it.startBy).setZone(tz) : null;
  const statusText =
    it.status === "complete"
      ? "Already covered"
      : it.status === "overdue"
        ? "Overdue"
        : it.status === "unplaced"
          ? "Couldn't place"
          : it.status === "partial"
            ? `${formatDuration(it.placedMin)} of ${formatDuration(it.remainingMin)} placed`
            : startBy
              ? `Start ${startBy.hasSame(now, "day") ? "today" : startBy.toFormat("ccc")}`
              : "Planned";
  return (
    <div className={`tint-${it.tint} flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5`}>
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
      <div className="min-w-0 flex-1 basis-60">
        <p className="truncate text-sm font-medium">{it.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {[it.course, `due ${formatDue(due, now)}`].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          {it.origin === "llm" ? <Sparkles size={12} className="mt-0.5 shrink-0 text-accent" /> : null}
          <span>{it.reasoning}{it.calibration ? <span className="text-subtle"> {it.calibration}</span> : null}</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              const h = Number(value);
              if (h > 0 && h !== it.hours) onSet(h);
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
              aria-label={`Hours for ${it.title}`}
            />
            <span className="text-xs text-muted">h</span>
          </form>
        ) : (
          <button
            disabled={disabled}
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1 text-right hover:bg-surface-2"
            title="Change estimate"
          >
            <span className="text-sm font-medium tabular-nums">{formatDuration(it.hours * 60)}</span>
            <span className="ml-1.5 text-[11px] text-subtle">{ORIGIN_LABEL[it.origin]}</span>
          </button>
        )}
        <span className={cx("w-32 text-right text-xs", it.status === "unplaced" || it.status === "partial" ? "text-danger" : it.status === "overdue" ? "text-warn" : "text-muted")}>
          {statusText}
        </span>
      </div>
    </div>
  );
}

export function PlanEmpty({ hasApproved, lastApproved, horizon }: { hasApproved: boolean; lastApproved: string | null; horizon: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="px-6 py-10 text-center md:px-12">
      <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
        <Sparkles size={18} />
      </div>
      <h2 className="text-lg font-semibold tracking-[-0.01em]">Plan the next {horizon} days</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        Sundial estimates each assignment, protects your habits, and back-schedules work from each deadline into your free time.
        You&apos;ll review the proposal before anything touches your calendar.
      </p>
      <Button
        variant="primary"
        className="mt-6"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runPlanner();
            if (!r.ok) setError(r.error);
          })
        }
      >
        {pending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} {pending ? "Planning…" : "Make a plan"}
      </Button>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {hasApproved && lastApproved ? <p className="mt-4 text-xs text-subtle">Last plan approved {lastApproved}.</p> : null}
    </Card>
  );
}
