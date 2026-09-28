"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Lock, Trash2, Unlock } from "lucide-react";
import { DateTime } from "luxon";
import { deleteBlock, deleteEvent, setBlockLocked, setBlockStatus, updateBlockTime, updateEventTime } from "@/app/(app)/actions";
import { Dialog } from "@/components/dialog";
import { Button, Field, Input } from "@/components/ui";
import { formatRange } from "@/lib/time";
import type { AgendaItem } from "@/lib/view";

const EDIT_EVENT = "sundial:edit";

export function openEditor(item: AgendaItem) {
  window.dispatchEvent(new CustomEvent<AgendaItem>(EDIT_EVENT, { detail: item }));
}

/** Click any block or event to open this. Changing a block's time locks it in place. */
export function ItemEditor({ tz }: { tz: string }) {
  const [item, setItem] = useState<AgendaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onOpen = (e: Event) => {
      setItem((e as CustomEvent<AgendaItem>).detail);
      setError(null);
    };
    window.addEventListener(EDIT_EVENT, onOpen);
    return () => window.removeEventListener(EDIT_EVENT, onOpen);
  }, []);

  if (!item) return <Dialog open={false} onClose={() => {}} title="">{null}</Dialog>;

  const s = DateTime.fromISO(item.start).setZone(tz);
  const e = DateTime.fromISO(item.end).setZone(tz);
  const local = (d: DateTime) => d.toFormat("yyyy-LL-dd'T'HH:mm");
  const close = () => setItem(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) close();
      else setError(res.error ?? "Something went wrong");
    });

  const isBlock = item.kind !== "event";
  const readOnly = !item.editable;

  return (
    <Dialog open onClose={close} title={item.title}>
      <div className={`tint-${item.tint} mb-4 flex items-center gap-2 text-sm text-muted`}>
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--tint)" }} />
        <span>{s.toFormat("cccc, LLL d")} · {formatRange(s, e)}</span>
        {item.locked && isBlock ? <Lock size={12} className="text-subtle" aria-label="Locked" /> : null}
      </div>

      {item.reasoning ? (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-muted">{item.reasoning}</p>
      ) : null}

      {readOnly ? (
        <p className="text-sm text-muted">
          This event comes from {item.subtitle ?? "a synced calendar"}. Edit it there — Sundial will pick up the change on the next sync.
        </p>
      ) : (
        <form
          action={(form) => {
            const startV = String(form.get("start"));
            const endV = String(form.get("end"));
            run(() => (isBlock ? updateBlockTime(item.id, startV, endV) : updateEventTime(item.id, startV, endV, String(form.get("title") ?? ""))));
          }}
          className="flex flex-col gap-3.5"
        >
          {!isBlock ? (
            <Field label="Title">
              <Input name="title" defaultValue={item.title} />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <Input name="start" type="datetime-local" defaultValue={local(s)} required />
            </Field>
            <Field label="Ends">
              <Input name="end" type="datetime-local" defaultValue={local(e)} required />
            </Field>
          </div>
          {isBlock ? (
            <p className="text-xs text-muted">Saving a new time locks this block so re-planning won&apos;t move it.</p>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => run(() => (isBlock ? deleteBlock(item.id) : deleteEvent(item.id)))}
              >
                <Trash2 size={14} /> Delete
              </Button>
              {isBlock && item.locked ? (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setBlockLocked(item.id, false))}>
                  <Unlock size={14} /> Unlock
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              {isBlock && item.status !== "done" ? (
                <Button type="button" size="sm" disabled={pending} onClick={() => run(() => setBlockStatus(item.id, "done"))}>
                  <Check size={14} /> Done
                </Button>
              ) : null}
              <Button variant="primary" size="sm" disabled={pending}>Save</Button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
