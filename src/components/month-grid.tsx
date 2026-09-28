"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { cx } from "@/components/ui";
import { formatDuration, formatTime } from "@/lib/time";
import type { DueMarker } from "@/lib/view";

export type MonthDay = {
  date: string;
  due: DueMarker[];
  work: { title: string; tint: string; minutes: number }[];
  habitMin: number;
  eventCount: number;
};

export function MonthGrid({ tz, month, days, todayISO }: { tz: string; month: number; days: MonthDay[]; todayISO: string }) {
  const [selected, setSelected] = useState<string>(days.find((d) => d.date === todayISO)?.date ?? days[7].date);
  const sel = days.find((d) => d.date === selected)!;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line">
          {weekdays.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-subtle md:text-left">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const dt = DateTime.fromISO(d.date, { zone: tz });
            const inMonth = dt.month === month;
            const isToday = d.date === todayISO;
            const workMin = d.work.reduce((m, w) => m + w.minutes, 0);
            return (
              <button
                key={d.date}
                onClick={() => setSelected(d.date)}
                className={cx(
                  "group relative flex min-h-16 flex-col border-line p-1.5 text-left transition-colors md:min-h-28 md:p-2",
                  i % 7 !== 0 && "border-l",
                  i >= 7 && "border-t",
                  !inMonth && "bg-surface-2/50",
                  selected === d.date ? "bg-accent-soft/60" : "hover:bg-surface-2/60",
                )}
              >
                <span
                  className={cx(
                    "grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums",
                    isToday ? "bg-accent font-semibold text-accent-fg" : inMonth ? "text-fg" : "text-subtle",
                  )}
                >
                  {dt.day}
                </span>
                {/* desktop: deadline chips */}
                <div className="mt-1 hidden min-w-0 flex-col gap-0.5 md:flex">
                  {d.due.slice(0, 3).map((m) => (
                    <span key={m.id} className={`tint-${m.tint} flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight ${m.done ? "text-subtle line-through" : "text-fg"}`} style={{ background: "var(--tint-bg)", boxShadow: "inset 2px 0 0 var(--tint)" }}>
                      <span className="truncate">{m.title}</span>
                    </span>
                  ))}
                  {d.due.length > 3 ? <span className="px-1 text-[11px] text-muted">+{d.due.length - 3} more</span> : null}
                </div>
                <div className="mt-auto flex items-center gap-1 pt-1">
                  {/* mobile: dots */}
                  {d.due.slice(0, 3).map((m) => (
                    <span key={m.id} className={`tint-${m.tint} h-1.5 w-1.5 rounded-full md:hidden`} style={{ background: "var(--tint)" }} />
                  ))}
                  {workMin ? <span className="hidden text-[11px] tabular-nums text-muted md:inline">{formatDuration(workMin)} work</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-12 lg:self-start">
        <p className="text-xs text-subtle">{DateTime.fromISO(sel.date, { zone: tz }).toFormat("cccc")}</p>
        <p className="text-lg font-semibold tracking-[-0.01em]">{DateTime.fromISO(sel.date, { zone: tz }).toFormat("LLLL d")}</p>

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">Due</p>
          {sel.due.length ? (
            <ul className="flex flex-col gap-1.5">
              {sel.due.map((m) => (
                <li key={m.id} className={`tint-${m.tint} flex items-start gap-2 text-sm`}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate", m.done && "text-subtle line-through")}>{m.title}</span>
                    <span className="block text-xs text-muted">
                      {[m.course, formatTime(DateTime.fromISO(m.due).setZone(tz))].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">Nothing due.</p>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">Planned work</p>
          {sel.work.length ? (
            <ul className="flex flex-col gap-1.5">
              {sel.work.map((w) => (
                <li key={w.title} className={`tint-${w.tint} flex items-center gap-2 text-sm`}>
                  <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <span className="text-xs tabular-nums text-muted">{formatDuration(w.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">No work blocks.</p>
          )}
          {sel.habitMin || sel.eventCount ? (
            <p className="mt-3 text-xs text-muted">
              {[sel.eventCount ? `${sel.eventCount} event${sel.eventCount > 1 ? "s" : ""}` : null, sel.habitMin ? `${formatDuration(sel.habitMin)} of habits` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <a href={`/week?d=${sel.date}`} className="mt-4 inline-block text-xs text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
            Open this week
          </a>
        </div>
      </aside>
    </div>
  );
}
