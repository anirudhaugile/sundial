"use client";

import { useMemo, useState } from "react";
import { Check, Lock } from "lucide-react";
import { DateTime } from "luxon";
import { openEditor } from "@/components/item-editor";
import { cx } from "@/components/ui";
import { formatTime } from "@/lib/time";
import type { AgendaItem, DueMarker } from "@/lib/view";

const HOUR_PX = 52;

type Positioned = AgendaItem & { top: number; height: number; lane: number; lanes: number };

/** Assign overlapping items to side-by-side lanes (greedy interval partitioning per cluster). */
function layoutDay(items: AgendaItem[], dayStartMs: number, fromMin: number): Positioned[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out: Positioned[] = [];
  let cluster: Positioned[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length;
    for (const p of cluster) p.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    const s = Date.parse(it.start);
    const e = Date.parse(it.end);
    if (s >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    clusterEnd = Math.max(clusterEnd, e);
    const startMin = (s - dayStartMs) / 60000 - fromMin;
    const durMin = (e - s) / 60000;
    cluster.push({ ...it, top: (startMin / 60) * HOUR_PX, height: Math.max((durMin / 60) * HOUR_PX, 18), lane, lanes: 1 });
  }
  flush();
  return out;
}

export function WeekGrid({
  tz,
  days,
  items,
  due,
  fromMin,
  toMin,
  nowISO,
}: {
  tz: string;
  days: string[];
  items: AgendaItem[];
  due: DueMarker[];
  fromMin: number;
  toMin: number;
  nowISO: string;
}) {
  const now = DateTime.fromISO(nowISO).setZone(tz);
  const today = now.toISODate()!;
  const [mobileDay, setMobileDay] = useState(days.includes(today) ? today : days[0]);
  const hours = Array.from({ length: Math.ceil((toMin - fromMin) / 60) }, (_, i) => fromMin / 60 + i);
  const height = ((toMin - fromMin) / 60) * HOUR_PX;

  const perDay = useMemo(() => {
    const map = new Map<string, { items: Positioned[]; due: DueMarker[] }>();
    for (const d of days) {
      const dayStart = DateTime.fromISO(d, { zone: tz }).startOf("day");
      const dayEnd = dayStart.plus({ days: 1 });
      const inDay = items
        .filter((i) => Date.parse(i.start) < dayEnd.toMillis() && Date.parse(i.end) > dayStart.toMillis())
        .map((i) => ({
          ...i,
          // clip multi-day items to this day and to the visible range
          start: new Date(Math.max(Date.parse(i.start), dayStart.plus({ minutes: fromMin }).toMillis())).toISOString(),
          end: new Date(Math.min(Date.parse(i.end), dayStart.plus({ minutes: toMin }).toMillis())).toISOString(),
        }))
        .filter((i) => i.end > i.start);
      map.set(d, {
        items: layoutDay(inDay, dayStart.toMillis(), fromMin),
        due: due.filter((m) => DateTime.fromISO(m.due).setZone(tz).toISODate() === d),
      });
    }
    return map;
  }, [days, items, due, tz, fromMin, toMin]);

  const nowTop = ((now.hour * 60 + now.minute - fromMin) / 60) * HOUR_PX;

  return (
    <div>
      {/* mobile day strip */}
      <div className="mb-4 grid grid-cols-7 gap-1 md:hidden">
        {days.map((d) => {
          const dt = DateTime.fromISO(d, { zone: tz });
          const active = d === mobileDay;
          const count = perDay.get(d)!.items.length + perDay.get(d)!.due.length;
          return (
            <button
              key={d}
              onClick={() => setMobileDay(d)}
              className={cx(
                "flex flex-col items-center rounded-xl py-2 transition-colors",
                active ? "bg-surface ring-1 ring-line" : "text-muted",
              )}
            >
              <span className="text-[11px] uppercase tracking-wide">{dt.toFormat("ccc")}</span>
              <span className={cx("mt-0.5 text-base tabular-nums", d === today && "font-semibold text-accent")}>{dt.day}</span>
              <span className={cx("mt-1 h-1 w-1 rounded-full", count ? "bg-subtle" : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {/* header row */}
        <div className="hidden border-b border-line md:grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => {
            const dt = DateTime.fromISO(d, { zone: tz });
            const isToday = d === today;
            return (
              <div key={d} className="border-l border-line px-2 py-2.5">
                <p className={cx("text-xs", isToday ? "text-accent" : "text-subtle")}>{dt.toFormat("ccc")}</p>
                <p className={cx("text-lg leading-tight tabular-nums", isToday ? "font-semibold text-fg" : "text-fg")}>{dt.day}</p>
              </div>
            );
          })}
        </div>

        {/* deadlines row */}
        {due.length ? (
          <div className="hidden border-b border-line md:grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-subtle">Due</div>
            {days.map((d) => (
              <div key={d} className="flex min-w-0 flex-col gap-1 border-l border-line p-1">
                {perDay.get(d)!.due.map((m) => <DueChip key={m.id} m={m} tz={tz} />)}
              </div>
            ))}
          </div>
        ) : null}

        {/* mobile deadlines for the selected day */}
        {perDay.get(mobileDay)!.due.length ? (
          <div className="flex flex-col gap-1 border-b border-line p-2 md:hidden">
            {perDay.get(mobileDay)!.due.map((m) => <DueChip key={m.id} m={m} tz={tz} />)}
          </div>
        ) : null}

        <div className="relative grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* hour labels */}
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-subtle" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : formatTime(DateTime.fromObject({ hour: h % 24 }))}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const isToday = d === today;
            return (
              <div
                key={d}
                className={cx("relative border-l border-line", d !== mobileDay && "hidden md:block", "max-md:col-span-7")}
                style={{ height }}
              >
                {hours.map((h, i) => (
                  <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                ))}
                {isToday && nowTop > 0 && nowTop < height ? (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowTop }}>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-accent" />
                    <span className="h-px flex-1 bg-accent" />
                  </div>
                ) : null}
                {perDay.get(d)!.items.map((it) => <GridBlock key={it.id + d} it={it} tz={tz} now={now} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GridBlock({ it, tz, now }: { it: Positioned; tz: string; now: DateTime }) {
  const s = DateTime.fromISO(it.start).setZone(tz);
  const e = DateTime.fromISO(it.end).setZone(tz);
  const isEvent = it.kind === "event";
  const done = it.status === "done";
  const past = e < now;
  const width = 100 / it.lanes;
  return (
    <button
      onClick={() => openEditor(it)}
      className={cx(
        `tint-${it.tint} absolute z-10 overflow-hidden rounded-lg border px-2 py-1 text-left transition-[transform,opacity] duration-150 hover:z-30 hover:-translate-y-px`,
        isEvent ? "border-line-strong bg-surface-2" : "border-transparent",
        (past || done) && "opacity-55",
        it.status === "skipped" && "line-through opacity-40",
      )}
      style={{
        top: it.top + 1,
        height: it.height - 2,
        left: `calc(${it.lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        background: isEvent ? undefined : "var(--tint-bg)",
        boxShadow: isEvent ? undefined : "inset 2px 0 0 var(--tint)",
      }}
    >
      <p className="flex items-center gap-1 truncate text-xs font-medium leading-4 text-fg">
        {done ? <Check size={11} className="shrink-0" /> : null}
        <span className="truncate">{it.title}</span>
        {it.locked && !isEvent ? <Lock size={9} className="shrink-0 text-subtle" /> : null}
      </p>
      {it.height > 34 ? (
        <p className="truncate text-[11px] leading-4 text-muted">
          {formatTime(s)} – {formatTime(e)}
          {it.subtitle ? ` · ${it.subtitle}` : ""}
        </p>
      ) : null}
    </button>
  );
}

function DueChip({ m, tz }: { m: DueMarker; tz: string }) {
  return (
    <a
      href="/assignments"
      className={`tint-${m.tint} flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-tight hover:bg-surface-2 ${m.done ? "text-subtle line-through" : "text-fg"}`}
      title={`${m.title} — due ${formatTime(DateTime.fromISO(m.due).setZone(tz))}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--tint)" }} />
      <span className="truncate">{m.title}</span>
    </a>
  );
}
