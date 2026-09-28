"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { deleteCourse, saveCourse } from "@/app/(app)/settings/actions";
import { ColorPicker } from "@/components/habits-editor";
import { Button, EmptyState, Input } from "@/components/ui";

type CourseRow = { id: string; name: string; code: string | null; color: string; source: string };

export function CoursesEditor({ courses }: { courses: CourseRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <p className="mb-6 text-sm leading-relaxed text-muted">
        Each course gets a soft color used across your calendar. Canvas courses appear here automatically after a sync.
      </p>
      {courses.length || adding ? (
        <ul className="flex flex-col gap-2">
          {courses.map((c) => <CourseItem key={c.id} course={c} />)}
          {adding ? <CourseItem course={null} onDone={() => setAdding(false)} /> : null}
        </ul>
      ) : (
        <EmptyState title="No courses yet" action={<Button onClick={() => setAdding(true)}><Plus size={14} /> Add a course</Button>}>
          Connect Canvas to import them, or add one by hand.
        </EmptyState>
      )}
      {courses.length && !adding ? (
        <Button className="mt-4" size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add course</Button>
      ) : null}
    </div>
  );
}

function CourseItem({ course, onDone }: { course: CourseRow | null; onDone?: () => void }) {
  const [color, setColor] = useState(course?.color ?? "sage");
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = !course || color !== course.color || name !== course.name || code !== (course.code ?? "");
  const synced = course?.source === "canvas";

  const save = () =>
    start(async () => {
      const res = await saveCourse(course?.id ?? null, { name, code, color: color as "sage" });
      if (!res.ok) setError(res.error);
      else onDone?.();
    });

  return (
    <li className={`tint-${color} rounded-xl border border-line bg-surface p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-8 w-1 rounded-full" style={{ background: "var(--tint)" }} />
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-28" aria-label="Course code" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" className="min-w-40 flex-1" aria-label="Course name" disabled={synced} />
        {synced ? <span className="text-xs text-subtle">Canvas</span> : null}
        {course && !synced ? (
          <Button variant="ghost" size="icon" aria-label="Delete course" onClick={() => start(() => deleteCourse(course.id).then(() => undefined))}>
            <Trash2 size={14} />
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 pl-3">
        <ColorPicker value={color} onChange={setColor} />
        <div className="flex gap-2">
          {!course ? <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button> : null}
          {dirty ? <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={save}>Save</Button> : null}
        </div>
      </div>
      {error ? <p className="mt-2 pl-3 text-sm text-danger">{error}</p> : null}
    </li>
  );
}
