import "server-only";
import { DateTime } from "luxon";
import type { DB } from "@/lib/data/queries";
import { contentHash } from "@/lib/hash";
import { createProposal } from "@/lib/planner/run";

// A believable semester for the public demo, generated relative to "today" so it
// always looks current. Reset nightly by the cron job.

export const DEMO_EMAIL = "demo@sundial.app";
const TZ = "America/Chicago";

type Course = { key: string; name: string; code: string; color: string };
const COURSES: Course[] = [
  { key: "stat", name: "Statistics and Probability I", code: "STAT 400", color: "sky" },
  { key: "cs", name: "Algorithms and Models of Computation", code: "CS 374", color: "sage" },
  { key: "econ", name: "Intermediate Microeconomics", code: "ECON 302", color: "sand" },
  { key: "rhet", name: "Writing and Research", code: "RHET 105", color: "rose" },
];

type Seed = { course: string; title: string; day: number; time?: string; points: number; hours: number; why: string; description: string };
const OPEN: Seed[] = [
  { course: "rhet", title: "Annotated bibliography", day: -1, points: 30, hours: 2, why: "Eight sources with 100-word annotations; mostly reading and summarizing.", description: "Find eight scholarly sources for your research question and write a 100-word annotation for each." },
  { course: "cs", title: "Lab 5: Graph search", day: 1, time: "17:00", points: 10, hours: 1.5, why: "Short guided lab; one BFS/DFS implementation with provided tests.", description: "Implement BFS and DFS on the provided adjacency-list class. Autograded." },
  { course: "stat", title: "Homework 4", day: 2, points: 20, hours: 4, why: "Eight problems on conditional probability; typical weekly set for this course.", description: "Problems 2.14, 2.19, 2.23, 2.31, 3.2, 3.5, 3.9, 3.12. Show all work." },
  { course: "econ", title: "Reading response: price discrimination", day: 2, time: "12:00", points: 5, hours: 1, why: "One chapter plus a 300-word response.", description: "Read Varian ch. 25 and write a 300-word response connecting it to a real pricing example." },
  { course: "cs", title: "Homework 3: Dynamic programming", day: 3, points: 100, hours: 7, why: "Five proof-heavy DP problems in an upper-level algorithms course.", description: "Five problems: edit distance variants, longest increasing subsequence proof, interval scheduling with weights, and two design problems. Solutions must include recurrences and proofs of correctness." },
  { course: "stat", title: "Quiz 3", day: 4, time: "10:00", points: 5, hours: 0.5, why: "Ten-question online quiz; review is the main cost.", description: "Online quiz on random variables, 20 minutes." },
  { course: "econ", title: "Problem set 3", day: 5, points: 25, hours: 3, why: "Six algebra-heavy consumer theory problems.", description: "Six problems on Slutsky decomposition and consumer surplus." },
  { course: "rhet", title: "Essay draft", day: 8, points: 100, hours: 6, why: "1,500-word argumentative draft with citations; roughly 4 pages plus revision.", description: "Write a 1,500-word argumentative draft using at least five of your annotated sources. MLA format." },
  { course: "stat", title: "Homework 5", day: 9, points: 20, hours: 4, why: "Weekly set on discrete distributions; similar to Homework 4.", description: "Problems 3.18, 3.22, 3.27, 3.33, 3.40, 4.1, 4.6." },
  { course: "cs", title: "Homework 4: Graph algorithms", day: 10, points: 100, hours: 7, why: "Shortest paths and reductions; comparable in scope to Homework 3.", description: "Four problems on shortest paths, MST exchange arguments, and one reduction." },
  { course: "rhet", title: "Peer review", day: 11, points: 20, hours: 1.5, why: "Read two drafts and fill in the rubric for each.", description: "Review two classmates' drafts using the posted rubric." },
  { course: "stat", title: "Midterm review sheet", day: 13, points: 0, hours: 3, why: "Self-made review sheet; exam prep scales with material covered.", description: "Prepare a one-page formula sheet and work the practice exam." },
  { course: "econ", title: "Case write-up: airline pricing", day: 16, points: 50, hours: 5, why: "Short analytical paper with a small spreadsheet model.", description: "Analyze the provided airline pricing case in 3 pages with a supporting spreadsheet." },
];

// completed earlier, with actual time recorded, so calibration has something to learn from
const DONE: (Seed & { actual: number })[] = [
  { course: "stat", title: "Homework 3", day: -5, points: 20, hours: 4, actual: 5.5, why: "Weekly set on axioms of probability.", description: "Problems from chapter 2." },
  { course: "cs", title: "Homework 2: Divide and conquer", day: -7, points: 100, hours: 7, actual: 6.5, why: "Four recurrence and D&C design problems.", description: "Four problems." },
  { course: "econ", title: "Problem set 2", day: -6, points: 25, hours: 3, actual: 3.25, why: "Utility maximization problems.", description: "Five problems." },
  { course: "stat", title: "Homework 2", day: -12, points: 20, hours: 3.5, actual: 5, why: "Counting and combinatorics.", description: "Problems from chapter 1." },
];

type Weekly = { title: string; location: string; days: number[]; start: string; end: string };
const WEEKLY: Weekly[] = [
  { title: "STAT 400 lecture", location: "Altgeld 141", days: [1, 3, 5], start: "10:00", end: "10:50" },
  { title: "CS 374 lecture", location: "Siebel 1404", days: [2, 4], start: "11:00", end: "12:15" },
  { title: "RHET 105 seminar", location: "English 108", days: [1, 3], start: "13:00", end: "13:50" },
  { title: "ECON 302 lecture", location: "David Kinley 114", days: [2, 4], start: "14:00", end: "15:20" },
  { title: "Library shift", location: "Grainger Library", days: [5], start: "14:00", end: "18:00" },
  { title: "Research 1:1 with Prof. Chen", location: "Zoom", days: [3], start: "16:00", end: "16:30" },
  { title: "CS 374 office hours", location: "Siebel 0216", days: [1], start: "17:00", end: "18:00" },
];

export async function ensureDemoUser(db: DB, password: string) {
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) {
    await db.auth.admin.updateUserById(existing.id, { password });
    return existing.id;
  }
  const { data, error } = await db.auth.admin.createUser({ email: DEMO_EMAIL, password, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? "Couldn't create demo user");
  return data.user.id;
}

/** Wipe and regenerate the demo account's data. Service-role client only. */
export async function seedDemo(db: DB, password: string) {
  const userId = await ensureDemoUser(db, password);
  const now = DateTime.now().setZone(TZ);
  const today = now.startOf("day");
  const at = (day: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return today.plus({ days: day }).set({ hour: h, minute: m }).toUTC().toISO()!;
  };

  // clean slate (children cascade from these)
  for (const t of ["plan_runs", "blocks", "events", "work_items", "courses", "habits", "source_connections", "chat_messages", "tool_calls", "user_memory"] as const) {
    await db.from(t).delete().eq("user_id", userId);
  }
  await db
    .from("profiles")
    .update({
      is_demo: true,
      display_name: "Alex",
      timezone: TZ,
      day_start: "08:00",
      day_end: "23:30",
      min_block_min: 30,
      max_block_min: 120,
      daily_work_cap_min: 360,
      due_buffer_hours: 24,
      horizon_days: 21,
    })
    .eq("id", userId);

  const { data: courses } = await db
    .from("courses")
    .insert(COURSES.map((c) => ({ user_id: userId, source: "canvas", external_id: `demo-${c.key}`, name: c.name, code: c.code, color: c.color })))
    .select("id, external_id, code");
  const courseId = (key: string) => courses!.find((c) => c.external_id === `demo-${key}`)!.id;
  const courseCode = (key: string) => COURSES.find((c) => c.key === key)!.code;

  const { data: habits } = await db
    .from("habits")
    .insert([
      { user_id: userId, name: "Gym", priority: 1, min_min: 30, target_min: 45, window_start: "18:00", window_end: "23:30", start_date: today.minus({ days: 60 }).toISODate()!, color: "clay" },
      { user_id: userId, name: "Internship applications", priority: 2, min_min: 60, target_min: 60, window_start: "18:00", window_end: "23:30", start_date: today.minus({ days: 60 }).toISODate()!, end_date: "2027-01-31", color: "plum" },
    ])
    .select("id, name");
  const gymId = habits!.find((h) => h.name === "Gym")!.id;
  const appsId = habits!.find((h) => h.name === "Internship applications")!.id;

  // assignments + their (pre-baked) AI estimates, so the demo never needs an API call
  let ext = 1000;
  const rows = [...OPEN, ...DONE].map((s) => {
    const hash = contentHash({ title: s.title, description: s.description, points: s.points, courseName: courseCode(s.course) });
    const done = "actual" in s;
    return {
      seed: s,
      row: {
        user_id: userId,
        source: "canvas",
        external_id: `demo-${ext++}`,
        kind: "assignment",
        title: s.title,
        description: s.description,
        points: s.points,
        due_at: at(s.day, s.time ?? "23:59"),
        course_id: courseId(s.course),
        content_hash: hash,
        url: null,
        status: done ? "done" : "open",
        completed_at: done ? at(s.day, "20:00") : null,
        estimated_minutes: done ? s.hours * 60 : null,
        actual_minutes: done ? (s as { actual: number }).actual * 60 : null,
      },
    };
  });
  const { data: items } = await db.from("work_items").insert(rows.map((r) => r.row)).select("id, title, content_hash");
  const itemId = (title: string) => items!.find((i) => i.title === title)!.id;

  await db.from("effort_estimates").insert(
    rows.map(({ seed, row }) => ({
      user_id: userId,
      work_item_id: itemId(seed.title),
      content_hash: row.content_hash,
      origin: "llm",
      hours: seed.hours,
      reasoning: seed.why,
      model: "claude-opus-5",
    })),
  );

  // actual time on finished work, as done blocks in the evenings before each due date
  const doneBlocks = DONE.flatMap((s) => {
    const sessions = Math.ceil(s.actual / 2);
    const per = (s.actual * 60) / sessions;
    return Array.from({ length: sessions }, (_, k) => {
      const start = DateTime.fromISO(at(s.day - 1 - k, "19:00"));
      return {
        user_id: userId,
        kind: "work",
        work_item_id: itemId(s.title),
        title: s.title,
        starts_at: start.toUTC().toISO()!,
        ends_at: start.plus({ minutes: per }).toUTC().toISO()!,
        status: "done",
        completed_at: start.plus({ minutes: per }).toUTC().toISO()!,
      };
    });
  });
  // a few days of habit history
  const habitHistory = [-3, -2, -1].flatMap((d) => [
    { user_id: userId, kind: "habit", habit_id: gymId, title: "Gym", starts_at: at(d, "18:00"), ends_at: at(d, "18:45"), status: d === -2 ? "skipped" : "done" },
    { user_id: userId, kind: "habit", habit_id: appsId, title: "Internship applications", starts_at: at(d, "21:00"), ends_at: at(d, "22:00"), status: "done" },
  ]);
  await db.from("blocks").insert([...doneBlocks, ...habitHistory]);

  // recurring calendar, as if synced from Outlook
  const events = [];
  for (let d = -14; d < 22; d++) {
    const day = today.plus({ days: d });
    for (const w of WEEKLY) {
      if (!w.days.includes(day.weekday)) continue;
      events.push({
        user_id: userId,
        source: "outlook",
        external_uid: `demo-${w.title}`,
        instance_start: at(d, w.start),
        title: w.title,
        location: w.location,
        starts_at: at(d, w.start),
        ends_at: at(d, w.end),
        busy: true,
      });
    }
  }
  events.push({
    user_id: userId,
    source: "outlook",
    external_uid: "demo-career-fair",
    instance_start: at(6, "12:00"),
    title: "Engineering career fair",
    location: "ARC",
    starts_at: at(6, "12:00"),
    ends_at: at(6, "16:00"),
    busy: true,
  });
  await db.from("events").insert(events);

  // plan with the real scheduler, approve it, then leave a fresh "morning" proposal to review
  const first = await createProposal(db, userId, "manual");
  await db.from("blocks").update({ status: "scheduled" }).eq("plan_run_id", first.runId).eq("status", "proposed");
  await db.from("plan_runs").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", first.runId);

  // something new arrived overnight, so the morning plan has a real diff to show
  const surprise = {
    user_id: userId,
    source: "canvas",
    external_id: `demo-${ext++}`,
    kind: "assignment",
    title: "Extra credit: Monte Carlo simulation",
    description: "Simulate the birthday problem for n = 2..60 in any language and plot the curve.",
    points: 10,
    due_at: at(4, "23:59"),
    course_id: courseId("stat"),
    content_hash: contentHash({ title: "Extra credit: Monte Carlo simulation", description: "Simulate the birthday problem for n = 2..60 in any language and plot the curve.", points: 10, courseName: "STAT 400" }),
  };
  const { data: s } = await db.from("work_items").insert(surprise).select("id").single();
  await db.from("effort_estimates").insert({
    user_id: userId,
    work_item_id: s!.id,
    content_hash: surprise.content_hash,
    origin: "llm",
    hours: 2,
    reasoning: "Small simulation plus one plot; quick if you've used NumPy before.",
    model: "claude-opus-5",
  });
  await createProposal(db, userId, "cron");

  // an example exchange so the chat panel isn't empty; the memory it created is real
  const fact = "Statistics problem sets take Alex longer than average.";
  await db.from("user_memory").insert({ user_id: userId, content: fact, source: "chat", created_at: at(-2, "21:10") });
  await db.from("tool_calls").insert({
    user_id: userId,
    tool_use_id: "demo_tu_1",
    name: "remember",
    input: { fact },
    result: { saved: true },
    summary: `Remembered: “${fact}”`,
    status: "applied",
    undo: null,
    created_at: at(-2, "21:10"),
  });
  const tick = (n: number) => DateTime.fromISO(at(-2, "21:09")).plus({ seconds: n * 7 }).toUTC().toISO()!;
  await db.from("chat_messages").insert([
    { user_id: userId, role: "user", content: "stats psets always take me longer than you think", created_at: tick(1) },
    {
      user_id: userId,
      role: "assistant",
      content: [
        { type: "text", text: "Noted — I'll keep that in mind for every STAT 400 estimate." },
        { type: "tool_use", id: "demo_tu_1", name: "remember", input: { fact } },
      ],
      created_at: tick(2),
    },
    { user_id: userId, role: "user", content: [{ type: "tool_result", tool_use_id: "demo_tu_1", content: '{"saved":true}' }], created_at: tick(3) },
    {
      user_id: userId,
      role: "assistant",
      content: [{ type: "text", text: "Saved. Your last two problem sets ran about 40% over, so calibration already nudges STAT 400 estimates up; this makes the AI lean the same way." }],
      created_at: tick(4),
    },
  ]);

  return userId;
}
