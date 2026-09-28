"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { DateTime } from "luxon";
import { createEntry } from "@/app/(app)/actions";
import { Dialog } from "@/components/dialog";
import { Button, cx, Field, Input, Kbd, Select, Textarea } from "@/components/ui";

type EntryType = "task" | "assignment" | "event";
type Detail = { type?: EntryType; date?: string };

const OPEN_EVENT = "sundial:new";

export function openQuickAdd(detail: Detail = {}) {
  window.dispatchEvent(new CustomEvent<Detail>(OPEN_EVENT, { detail }));
}

export function NewButton({ type, date, label = "New" }: { type?: EntryType; date?: string; label?: string }) {
  return (
    <Button size="sm" onClick={() => openQuickAdd({ type, date })}>
      <Plus size={14} /> {label}
      <span className="ml-1 hidden sm:inline"><Kbd>n</Kbd></span>
    </Button>
  );
}

const TYPES: { value: EntryType; label: string; hint: string }[] = [
  { value: "task", label: "To-do", hint: "A small thing for a specific day." },
  { value: "assignment", label: "Assignment", hint: "Has a deadline. The planner finds time for it." },
  { value: "event", label: "Event", hint: "Fixed time. Everything else plans around it." },
];

export function QuickAdd({ tz, courses }: { tz: string; courses: { id: string; name: string; code: string | null }[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EntryType>("task");
  const [date, setDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<Detail>).detail ?? {};
      setType(d.type ?? "task");
      setDate(d.date ?? DateTime.now().setZone(tz).toISODate()!);
      setError(null);
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (document.querySelector("[data-modal-open]")) return;
      e.preventDefault();
      onOpen(new CustomEvent(OPEN_EVENT, { detail: {} }));
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [tz]);

  const day = date || DateTime.now().setZone(tz).toISODate()!;
  const nextHour = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf("hour");
  const eventStart = DateTime.fromISO(day, { zone: tz }).set({ hour: nextHour.hour }).toFormat("yyyy-LL-dd'T'HH:mm");
  const eventEnd = DateTime.fromISO(eventStart, { zone: tz }).plus({ hours: 1 }).toFormat("yyyy-LL-dd'T'HH:mm");

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "");
    const input =
      type === "task"
        ? { type, title: get("title"), planned_for: get("planned_for") }
        : type === "assignment"
          ? {
              type,
              title: get("title"),
              due: get("due"),
              course_id: get("course_id"),
              description: get("description"),
              points: get("points"),
              estimate_hours: get("estimate_hours"),
            }
          : { type, title: get("title"), start: get("start"), end: get("end"), location: get("location"), busy: true };
    start(async () => {
      const res = await createEntry(input);
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Add to Sundial">
      <div role="tablist" className="mb-1 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={type === t.value}
            onClick={() => setType(t.value)}
            className={cx(
              "h-7 rounded-md text-[13px] transition-colors duration-150",
              type === t.value ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-4 px-1 text-xs text-muted">{TYPES.find((t) => t.value === type)!.hint}</p>

      <form action={submit} key={type} className="flex flex-col gap-3.5">
        <Field label="Title">
          <Input name="title" required autoFocus placeholder={type === "event" ? "Office hours" : type === "task" ? "Email advisor" : "Problem set 4"} />
        </Field>

        {type === "task" ? (
          <Field label="Day">
            <Input name="planned_for" type="date" defaultValue={day} required />
          </Field>
        ) : null}

        {type === "assignment" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due">
                <Input name="due" type="datetime-local" defaultValue={`${day}T23:59`} required />
              </Field>
              <Field label="Course">
                <Select name="course_id" defaultValue="">
                  <option value="">None</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.code || c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your estimate" hint="Hours. Leave blank to let Sundial estimate.">
                <Input name="estimate_hours" type="number" min="0.25" max="80" step="0.25" placeholder="—" />
              </Field>
              <Field label="Points">
                <Input name="points" type="number" min="0" step="any" placeholder="—" />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea name="description" placeholder="Anything that affects how long it takes" />
            </Field>
          </>
        ) : null}

        {type === "event" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <Input name="start" type="datetime-local" defaultValue={eventStart} required />
              </Field>
              <Field label="Ends">
                <Input name="end" type="datetime-local" defaultValue={eventEnd} required />
              </Field>
            </div>
            <Field label="Location">
              <Input name="location" placeholder="Optional" />
            </Field>
          </>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
