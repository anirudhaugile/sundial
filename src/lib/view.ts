import type { Block, CalEvent, Course, Habit, WorkItem } from "@/lib/data/queries";

/** Serializable calendar entry passed from server components to client views. */
export type AgendaItem = {
  id: string;
  kind: "event" | "habit" | "work";
  title: string;
  subtitle: string | null;
  start: string; // UTC ISO
  end: string;
  tint: string;
  status: "scheduled" | "done" | "skipped" | "event";
  locked: boolean;
  editable: boolean;
  workItemId: string | null;
  reasoning: string | null;
  unavailable?: boolean;
};

export const COURSE_COLORS = ["sage", "sky", "clay", "plum", "sand", "rose", "slate", "moss"] as const;

export type Lookups = {
  courses: Map<string, Course>;
  habits: Map<string, Habit>;
  items: Map<string, WorkItem>;
};

export function lookups(courses: Course[], habits: Habit[], items: WorkItem[]): Lookups {
  return {
    courses: new Map(courses.map((c) => [c.id, c])),
    habits: new Map(habits.map((h) => [h.id, h])),
    items: new Map(items.map((w) => [w.id, w])),
  };
}

export function courseLabel(c: Course | undefined) {
  return c ? c.code || c.name : null;
}

export function eventToAgenda(e: CalEvent): AgendaItem {
  const unavailable = e.kind === "unavailable";
  return {
    id: e.id,
    kind: "event",
    title: e.title,
    subtitle: unavailable ? "Unavailable" : e.location || (e.source === "outlook" ? "Outlook" : null),
    start: e.starts_at,
    end: e.ends_at,
    tint: unavailable ? "rose" : "slate",
    status: "event",
    locked: true,
    editable: e.source === "manual",
    workItemId: null,
    reasoning: null,
    unavailable,
  };
}

export function blockToAgenda(b: Block, l: Lookups): AgendaItem {
  const item = b.work_item_id ? l.items.get(b.work_item_id) : undefined;
  const course = item?.course_id ? l.courses.get(item.course_id) : undefined;
  const habit = b.habit_id ? l.habits.get(b.habit_id) : undefined;
  return {
    id: b.id,
    kind: b.kind as "habit" | "work",
    title: b.title,
    subtitle: b.kind === "habit" ? "Habit" : courseLabel(course),
    start: b.starts_at,
    end: b.ends_at,
    tint: habit?.color ?? course?.color ?? "sand",
    status: b.status as AgendaItem["status"],
    locked: b.locked,
    editable: true,
    workItemId: b.work_item_id,
    reasoning: b.reasoning,
  };
}

/** Deadline marker for month/week views. */
export type DueMarker = {
  id: string;
  title: string;
  due: string;
  course: string | null;
  tint: string;
  done: boolean;
};

export function dueMarker(w: WorkItem, l: Lookups): DueMarker {
  const course = w.course_id ? l.courses.get(w.course_id) : undefined;
  return {
    id: w.id,
    title: w.title,
    due: w.due_at!,
    course: courseLabel(course),
    tint: course?.color ?? "sand",
    done: w.status === "done",
  };
}
