"use client";

import { useState, useTransition } from "react";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { DateTime } from "luxon";
import { saveHabit, setHabitRetired, type HabitInput } from "@/app/(app)/settings/actions";
import { Dialog } from "@/components/dialog";
import { Button, cx, EmptyState, Field, Input, SectionLabel } from "@/components/ui";
import { formatDuration, formatTime } from "@/lib/time";
import { COURSE_COLORS } from "@/lib/view";

export type HabitRow = {
  id: string;
  name: string;
  priority: number;
  min_min: number;
  target_min: number;
  window_start: string;
  window_end: string;
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
  color: string;
  retired_at: string | null;
};

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function t(s: string) {
  return formatTime(DateTime.fromFormat(s.slice(0, 5), "HH:mm"));
}

function describeDays(days: number[]) {
  if (days.length === 7) return "Every day";
  if (days.join() === "1,2,3,4,5") return "Weekdays";
  if (days.join() === "6,7") return "Weekends";
  return days.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", ");
}

export function HabitsEditor({ habits, today }: { habits: HabitRow[]; today: string }) {
  const [editing, setEditing] = useState<HabitRow | "new" | null>(null);
  const [, start] = useTransition();
  const active = habits.filter((h) => !h.retired_at);
  const retired = habits.filter((h) => h.retired_at);

  return (
    <div>
      <p className="mb-6 text-sm leading-relaxed text-muted">
        Habits are placed before any assignment work, in order. If a habit can&apos;t fit on a day, the planner tells you instead of dropping it.
      </p>

      <SectionLabel action={<Button size="sm" onClick={() => setEditing("new")}><Plus size={14} /> Add habit</Button>}>Active</SectionLabel>
      {active.length ? (
        <ul className="flex flex-col gap-2">
          {active.map((h, i) => (
            <li key={h.id} className={`tint-${h.color} flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3.5`}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums" style={{ background: "var(--tint-bg)", color: "var(--tint)" }}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{h.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {describeDays(h.days_of_week)} · {formatDuration(h.target_min)}
                  {h.min_min < h.target_min ? ` (at least ${formatDuration(h.min_min)})` : ""} · {t(h.window_start)}–{t(h.window_end)}
                  {h.end_date ? ` · until ${DateTime.fromISO(h.end_date).toFormat("LLL d, yyyy")}` : " · no end date"}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}><Pencil size={14} /></Button>
              <Button variant="ghost" size="icon" aria-label={`Retire ${h.name}`} title="Retire" onClick={() => start(() => setHabitRetired(h.id, true).then(() => undefined))}>
                <Archive size={14} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No active habits" action={<Button onClick={() => setEditing("new")}><Plus size={14} /> Add a habit</Button>}>
          Add the things you want protected every day — the gym, reading, applications. The planner fits work around them.
        </EmptyState>
      )}

      {retired.length ? (
        <div className="mt-10">
          <SectionLabel>Retired</SectionLabel>
          <ul className="flex flex-col">
            {retired.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2 text-sm text-muted">
                <span className="flex-1">{h.name}</span>
                <Button variant="ghost" size="sm" onClick={() => start(() => setHabitRetired(h.id, false).then(() => undefined))}>
                  <RotateCcw size={13} /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <HabitDialog
        habit={editing === "new" ? null : editing}
        open={editing !== null}
        nextPriority={Math.max(0, ...active.map((h) => h.priority)) + 1}
        today={today}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function HabitDialog({ habit, open, onClose, nextPriority, today }: { habit: HabitRow | null; open: boolean; onClose: () => void; nextPriority: number; today: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>(habit?.days_of_week ?? [1, 2, 3, 4, 5, 6, 7]);
  const [color, setColor] = useState(habit?.color ?? "moss");
  const [key, setKey] = useState(habit?.id ?? "new");

  // reset local state when a different habit opens
  const k = habit?.id ?? "new";
  if (open && k !== key) {
    setKey(k);
    setDays(habit?.days_of_week ?? [1, 2, 3, 4, 5, 6, 7]);
    setColor(habit?.color ?? "moss");
    setError(null);
  }

  function submit(form: FormData) {
    const g = (n: string) => String(form.get(n) ?? "");
    const input: HabitInput = {
      name: g("name"),
      priority: g("priority"),
      min_min: g("min_min"),
      target_min: g("target_min"),
      window_start: g("window_start"),
      window_end: g("window_end"),
      days_of_week: [...days].sort(),
      start_date: g("start_date"),
      end_date: g("end_date") || null,
      color: color as HabitInput["color"],
    };
    start(async () => {
      const res = await saveHabit(habit?.id ?? null, input);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={habit ? `Edit ${habit.name}` : "New habit"}>
      <form action={submit} key={key} className="flex flex-col gap-3.5">
        <Field label="Name">
          <Input name="name" defaultValue={habit?.name ?? ""} required autoFocus placeholder="Read for fun" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target" hint="Minutes per day.">
            <Input name="target_min" type="number" min="5" max="600" step="5" defaultValue={habit?.target_min ?? 30} required />
          </Field>
          <Field label="At least" hint="Shrinks to this on busy days.">
            <Input name="min_min" type="number" min="5" max="600" step="5" defaultValue={habit?.min_min ?? 30} required />
          </Field>
          <Field label="Window from">
            <Input name="window_start" type="time" defaultValue={habit?.window_start.slice(0, 5) ?? "18:00"} required />
          </Field>
          <Field label="Window to">
            <Input name="window_end" type="time" defaultValue={habit?.window_end.slice(0, 5) ?? "22:00"} required />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Days</p>
          <div className="flex gap-1.5">
            {DAYS.map((d, i) => {
              const n = i + 1;
              const on = days.includes(n);
              return (
                <button
                  type="button"
                  key={n}
                  aria-pressed={on}
                  aria-label={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]}
                  onClick={() => setDays(on ? days.filter((x) => x !== n) : [...days, n])}
                  className={cx("h-8 w-8 rounded-full text-xs transition-colors", on ? "bg-accent text-accent-fg" : "border border-line-strong text-muted hover:text-fg")}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Starts">
            <Input name="start_date" type="date" defaultValue={habit?.start_date ?? today} required />
          </Field>
          <Field label="Ends">
            <Input name="end_date" type="date" defaultValue={habit?.end_date ?? ""} />
          </Field>
          <Field label="Order" hint="1 goes first.">
            <Input name="priority" type="number" min="1" max="99" defaultValue={habit?.priority ?? nextPriority} required />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Color</p>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COURSE_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cx(`tint-${c} h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow`, value === c && "ring-2 ring-[var(--tint)]")}
          style={{ background: "var(--tint)" }}
        />
      ))}
    </div>
  );
}
