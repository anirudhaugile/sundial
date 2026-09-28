"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, GraduationCap, Link2, RefreshCw, Rss } from "lucide-react";
import { DateTime } from "luxon";
import { connectSource, disconnectSource, syncNow } from "@/app/(app)/settings/sources/actions";
import { Button, Card, Field, Input } from "@/components/ui";

type Conn = {
  id: string;
  kind: "canvas_api" | "canvas_ical" | "outlook_ics";
  base_url: string | null;
  secret_hint: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

const META = {
  canvas_api: {
    title: "Canvas",
    icon: GraduationCap,
    blurb: "Assignments with due dates, points and descriptions. Submitted work is checked off automatically.",
    how: "In Canvas: Account → Settings → Approved Integrations → + New Access Token.",
    secretLabel: "Access token",
    placeholder: "7~AbCd…",
  },
  canvas_ical: {
    title: "Canvas calendar feed",
    icon: Rss,
    blurb: "Fallback if your school blocks tokens. Due dates only — no points or descriptions.",
    how: "In Canvas: Calendar → Calendar Feed (bottom right) → copy the link.",
    secretLabel: "Feed link",
    placeholder: "https://canvas.school.edu/feeds/calendars/user_….ics",
  },
  outlook_ics: {
    title: "Outlook calendar",
    icon: CalendarClock,
    blurb: "Meetings become fixed blocks the planner works around. Optional.",
    how: "Outlook on the web: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.",
    secretLabel: "Published ICS link",
    placeholder: "https://outlook.office365.com/owa/calendar/…/calendar.ics",
  },
} as const;

export function SourcesEditor({ conns, tz, isDemo }: { conns: Conn[]; tz: string; isDemo: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const any = conns.length > 0;

  return (
    <div>
      <p className="mb-6 text-sm leading-relaxed text-muted">
        Sundial reads from these every morning and whenever you press sync. Tokens and links are encrypted and never sent to your browser.
      </p>
      {isDemo ? (
        <p className="mb-6 rounded-xl bg-accent-soft px-4 py-3 text-sm">You&apos;re in the demo account, so connecting real sources is turned off. The demo data stands in for Canvas and Outlook.</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {(Object.keys(META) as Conn["kind"][]).map((k) => (
          <SourceCard key={k} kind={k} conn={conns.find((c) => c.kind === k) ?? null} tz={tz} disabled={isDemo} />
        ))}
      </div>
      {any ? (
        <div className="mt-6 flex items-center justify-end gap-3">
          {msg ? <p className="text-sm text-muted">{msg}</p> : null}
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await syncNow();
                if (r.ok && r.results) {
                  const failed = r.results.filter((x) => !x.ok).length;
                  const changed = r.results.reduce((m, x) => m + x.counts.inserted + x.counts.removed, 0);
                  setMsg(failed ? `${failed} source${failed > 1 ? "s" : ""} failed — see above.` : changed ? `Synced. ${changed} new or removed items.` : "Synced. Nothing new.");
                }
              })
            }
          >
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Syncing…" : "Sync all now"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ kind, conn, tz, disabled }: { kind: Conn["kind"]; conn: Conn | null; tz: string; disabled: boolean }) {
  const meta = META[kind];
  const Icon = meta.icon;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    start(async () => {
      setError(null);
      const r = await connectSource(kind, { baseUrl: String(form.get("base_url") ?? ""), secret: String(form.get("secret") ?? "") });
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{meta.title}</p>
            {conn ? (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${conn.last_error ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}>
                {conn.last_error ? "Needs attention" : <><Check size={10} /> Connected</>}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{meta.blurb}</p>
          {conn ? (
            <p className="mt-2 text-xs text-subtle">
              {conn.base_url ? `${conn.base_url.replace("https://", "")} · ` : ""}
              <Link2 size={11} className="inline" /> {conn.secret_hint}
              {" · "}
              {conn.last_synced_at ? `synced ${DateTime.fromISO(conn.last_synced_at).setZone(tz).toRelative()}` : "not synced yet"}
            </p>
          ) : null}
          {conn?.last_error ? <p className="mt-1.5 text-xs text-danger">{conn.last_error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {conn ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(() => disconnectSource(conn.id).then(() => undefined))}>
              Disconnect
            </Button>
          ) : null}
          <Button size="sm" disabled={disabled} onClick={() => setOpen(!open)}>
            {conn ? "Update" : "Connect"}
          </Button>
        </div>
      </div>

      {open ? (
        <form action={submit} className="mt-4 flex flex-col gap-3 border-t border-line pt-4 animate-rise">
          <p className="text-xs text-muted">{meta.how}</p>
          {kind === "canvas_api" ? (
            <Field label="Canvas address">
              <Input name="base_url" defaultValue={conn?.base_url ?? ""} placeholder="canvas.school.edu" required />
            </Field>
          ) : null}
          <Field label={meta.secretLabel}>
            <Input name="secret" type="password" autoComplete="off" placeholder={meta.placeholder} required />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={pending}>{pending ? "Connecting & syncing…" : "Save and sync"}</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
