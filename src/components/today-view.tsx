"use client";

import { useOptimistic, useTransition } from "react";
import { ArrowRight, Check, CornerDownRight, Lock } from "lucide-react";
import { DateTime } from "luxon";
import { moveTaskToToday, setBlockStatus, setWorkItemDone } from "@/app/(app)/actions";
import { openEditor } from "@/components/item-editor";
import { cx, SectionLabel } from "@/components/ui";
import { formatDue, formatDuration, formatTime } from "@/lib/time";
import type { AgendaItem } from "@/lib/view";

export type TodoRow = { id: string; title: string; meta: string | null; tint: string; carried: boolean };
export type OverdueRow = { id: string; kind: "item" | "block"; title: string; meta: string; tint: string };
export type DueRow = { id: string; title: string; course: string | null; due: string; tint: string; plannedMin: number };

type Props = {
  tz: string;
  nowISO: string;
  agenda: AgendaItem[];
  todos: TodoRow[];
  overdue: OverdueRow[];
  upcoming: DueRow[];
};

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cx(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-all duration-200",
        checked ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-accent",
      )}
    >
      {checked ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  );
}

export function TodayView({ tz, nowISO, agenda, todos, overdue, upcoming }: Props) {
  const now = DateTime.fromISO(nowISO).setZone(tz);
  const [, start] = useTransition();
  const [hidden, hide] = useOptimistic<Set<string>, string>(new Set(), (s, id) => new Set(s).add(id));
  const today = now.toISODate()!;

  const act = (id: string, fn: () => Promise<unknown>) =>
    start(async () => {
      hide(id);
      await fn();
    });

  const visibleAgenda = agenda.filter((a) => !hidden.has(a.id) && a.status !== "done" && a.status !== "skipped");
  const visibleTodos = todos.filter((t) => !hidden.has(t.id));
  const visibleOverdue = overdue.filter((o) => !hidden.has(o.id));

  return (
    <div className="flex flex-col gap-10">
      {visibleOverdue.length ? (
        <section className="animate-rise">
          <SectionLabel>Carried forward</SectionLabel>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {visibleOverdue.map((o) => (
              <li key={o.id} className={`tint-${o.tint} flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0`}>
                <Checkbox
                  checked={false}
                  label={`Mark ${o.title} done`}
                  onChange={() => act(o.id, () => (o.kind === "item" ? setWorkItemDone(o.id, true) : setBlockStatus(o.id, "done")))}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{o.title}</p>
                  <p className="text-xs text-warn">{o.meta}</p>
                </div>
                {o.kind === "block" ? (
                  <button onClick={() => act(o.id, () => setBlockStatus(o.id, "skipped"))} className="text-xs text-muted hover:text-fg">
                    Skip
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionLabel>Schedule</SectionLabel>
        {visibleAgenda.length ? (
          <ul className="relative flex flex-col">
            {visibleAgenda.map((a) => {
              const s = DateTime.fromISO(a.start).setZone(tz);
              const e = DateTime.fromISO(a.end).setZone(tz);
              const past = e < now;
              const current = s <= now && now < e;
              const minutes = e.diff(s, "minutes").minutes;
              const startsBeforeToday = s.toISODate() !== today;
              return (
                <li key={a.id} className={`tint-${a.tint} group`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor(a)}
                    onKeyDown={(k) => k.key === "Enter" && openEditor(a)}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-surface",
                      past && "opacity-55",
                      current && "bg-surface ring-1 ring-line",
                    )}
                  >
                    <div className="pt-px">
                      {a.kind === "event" ? (
                        <span className="grid h-[18px] w-[18px] place-items-center">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tint)" }} />
                        </span>
                      ) : (
                        <Checkbox checked={false} label={`Mark ${a.title} done`} onChange={() => act(a.id, () => setBlockStatus(a.id, "done"))} />
                      )}
                    </div>
                    <div className="w-[4.75rem] shrink-0 pt-px text-[13px] tabular-nums text-muted">
                      {startsBeforeToday ? "all day" : formatTime(s)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm leading-5 text-fg">
                        <span className="truncate">{a.title}</span>
                        {a.locked && a.kind !== "event" ? <Lock size={11} className="shrink-0 text-subtle" /> : null}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        {a.kind !== "event" ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tint)" }} /> : null}
                        {[a.subtitle, formatDuration(minutes)].filter(Boolean).join(" · ")}
                        {current ? <span className="ml-1 font-medium text-accent">now</span> : null}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
            Nothing on the calendar today.{" "}
            <a href="/plan" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-accent">
              Run the planner
            </a>{" "}
            to fill in work blocks, or press <span className="font-mono text-xs">n</span> to add something.
          </p>
        )}
      </section>

      <section>
        <SectionLabel>To-dos</SectionLabel>
        {visibleTodos.length ? (
          <ul className="flex flex-col">
            {visibleTodos.map((t) => (
              <li key={t.id} className={`tint-${t.tint} flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface`}>
                <Checkbox checked={false} label={`Mark ${t.title} done`} onChange={() => act(t.id, () => setWorkItemDone(t.id, true))} />
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                {t.carried ? (
                  <button
                    onClick={() => start(() => moveTaskToToday(t.id, today).then(() => undefined))}
                    className="inline-flex items-center gap-1 text-xs text-warn hover:text-fg"
                    title="Move to today"
                  >
                    <CornerDownRight size={12} /> {t.meta}
                  </button>
                ) : t.meta ? (
                  <span className="text-xs text-muted">{t.meta}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 text-sm text-subtle">No to-dos. Press <span className="font-mono text-xs">n</span> to jot one down.</p>
        )}
      </section>

      {upcoming.length ? (
        <section>
          <SectionLabel action={<a href="/month" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">Month <ArrowRight size={12} /></a>}>
            Coming up
          </SectionLabel>
          <ul className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((d) => (
              <li key={d.id} className={`tint-${d.tint} rounded-xl border border-line bg-surface px-4 py-3`}>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tint)" }} />
                  <span className="truncate">{d.course ?? "No course"}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{formatDue(DateTime.fromISO(d.due).setZone(tz), now)}</span>
                </div>
                <p className="mt-1.5 truncate text-sm">{d.title}</p>
                <p className="mt-0.5 text-xs text-subtle">
                  {d.plannedMin ? `${formatDuration(d.plannedMin)} planned` : "Not planned yet"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
