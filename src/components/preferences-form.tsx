"use client";

import { useState, useTransition } from "react";
import { updatePreferences } from "@/app/(app)/settings/actions";
import { Button, Field, Input, Select } from "@/components/ui";

type Prefs = {
  display_name: string | null;
  timezone: string;
  day_start: string;
  day_end: string;
  min_block_min: number;
  max_block_min: number;
  daily_work_cap_min: number;
  due_buffer_hours: number;
  horizon_days: number;
};

const ZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

function Group({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-7 first:pt-0 last:border-b-0 md:grid-cols-[12rem_1fr] md:gap-8">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function PreferencesForm({ prefs }: { prefs: Prefs }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = ZONES.includes(prefs.timezone) ? ZONES : [prefs.timezone, ...ZONES];

  function submit(form: FormData) {
    const g = (k: string) => String(form.get(k) ?? "");
    start(async () => {
      const res = await updatePreferences({
        display_name: g("display_name"),
        timezone: g("timezone"),
        day_start: g("day_start"),
        day_end: g("day_end"),
        min_block_min: g("min_block_min"),
        max_block_min: g("max_block_min"),
        daily_work_cap_min: Math.round(Number(g("daily_work_cap_h")) * 60),
        due_buffer_hours: g("due_buffer_hours"),
        horizon_days: g("horizon_days"),
      });
      setMsg(res.ok ? { ok: true, text: "Saved. The next plan will use these." } : { ok: false, text: res.error });
    });
  }

  return (
    <form action={submit}>
      <Group title="You" description="How Sundial greets you and which clock it plans on.">
        <Field label="Name">
          <Input name="display_name" defaultValue={prefs.display_name ?? ""} placeholder="Optional" />
        </Field>
        <Field label="Timezone">
          <Select name="timezone" defaultValue={prefs.timezone}>
            {zones.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
          </Select>
        </Field>
      </Group>

      <Group title="Your day" description="Nothing gets scheduled outside these hours.">
        <Field label="Day starts">
          <Input name="day_start" type="time" defaultValue={prefs.day_start.slice(0, 5)} required />
        </Field>
        <Field label="Day ends">
          <Input name="day_end" type="time" defaultValue={prefs.day_end.slice(0, 5)} required />
        </Field>
        <Field label="Assignment work per day" hint="Upper limit, in hours.">
          <Input name="daily_work_cap_h" type="number" min="0" max="24" step="0.5" defaultValue={prefs.daily_work_cap_min / 60} required />
        </Field>
      </Group>

      <Group title="Work blocks" description="How the planner slices assignments into sessions.">
        <Field label="Shortest block" hint="Minutes.">
          <Input name="min_block_min" type="number" min="15" max="240" step="15" defaultValue={prefs.min_block_min} required />
        </Field>
        <Field label="Longest block" hint="Minutes.">
          <Input name="max_block_min" type="number" min="15" max="480" step="15" defaultValue={prefs.max_block_min} required />
        </Field>
        <Field label="Finish early by" hint="Hours before the deadline.">
          <Input name="due_buffer_hours" type="number" min="0" max="168" defaultValue={prefs.due_buffer_hours} required />
        </Field>
        <Field label="Planning horizon" hint="Days ahead to sync and plan.">
          <Input name="horizon_days" type="number" min="7" max="60" defaultValue={prefs.horizon_days} required />
        </Field>
      </Group>

      <div className="sticky bottom-20 flex items-center justify-end gap-3 pt-2 md:bottom-4">
        {msg ? <p className={`text-sm ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.text}</p> : null}
        <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save preferences"}</Button>
      </div>
    </form>
  );
}
