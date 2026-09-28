// Scheduler contract. Everything here is plain data: no database, no network, no LLM.
// Times are ISO strings (UTC or with offset); wall-clock times are "HH:mm" in `tz`.

export type SchedulerPrefs = {
  dayStart: string; // "08:00" — work is only placed inside the day
  dayEnd: string; // "23:30"
  minBlockMin: number; // shortest work session
  maxBlockMin: number; // longest work session
  dailyWorkCapMin: number; // assignment work per day, across all items
  dueBufferHours: number; // aim to finish this long before the deadline
  noWorkWindows?: NoWorkWindow[]; // recurring times with no assignment work (habits still allowed)
};

export type NoWorkWindow = { days: number[]; start: string; end: string; label?: string };

export type SchedulerEvent = {
  id: string;
  start: string;
  end: string;
  busy: boolean;
};

/** Blocks the scheduler must not move: locked, done, or already in the past. */
export type FixedBlock = {
  id: string;
  kind: "habit" | "work";
  habitId?: string | null;
  workItemId?: string | null;
  start: string;
  end: string;
  status: "scheduled" | "done";
  locked: boolean;
};

export type SchedulerHabit = {
  id: string;
  name: string;
  priority: number; // lower first
  minMin: number;
  targetMin: number;
  windowStart: string; // "18:00"
  windowEnd: string; // "23:30"
  daysOfWeek: number[]; // ISO 1 = Monday
  startDate: string; // yyyy-mm-dd
  endDate: string | null;
};

export type SchedulerWork = {
  id: string;
  title: string;
  dueAt: string;
  estimateMin: number; // total effort
  doneMin?: number; // effort already spent (from done blocks)
};

export type SchedulerInput = {
  now: string;
  tz: string;
  horizonDays: number;
  prefs: SchedulerPrefs;
  events: SchedulerEvent[];
  fixedBlocks: FixedBlock[];
  habits: SchedulerHabit[];
  work: SchedulerWork[];
};

export type ProposedBlock = {
  kind: "habit" | "work";
  habitId?: string;
  workItemId?: string;
  title: string;
  start: string;
  end: string;
  reasoning: string;
};

export type Conflict = {
  kind: "habit" | "work";
  habitId?: string;
  workItemId?: string;
  day?: string; // yyyy-mm-dd
  shortfallMin: number;
  severity: "warning" | "error";
  message: string;
};

export type ItemPlan = {
  workItemId: string;
  title: string;
  remainingMin: number;
  placedMin: number;
  startBy: string | null; // first new block
  status: "planned" | "partial" | "unplaced" | "complete" | "overdue";
};

export type SchedulerOutput = {
  blocks: ProposedBlock[];
  conflicts: Conflict[];
  items: ItemPlan[];
  stats: { workMin: number; habitMin: number; days: number };
};
