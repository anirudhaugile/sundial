// Learn how far off estimates run for each course, from finished work.
//
//   raw factor = Σ actual / Σ estimated   (over the most recent completed items)
//   factor     = 1 + (raw − 1) · n / (n + PRIOR)
//
// The shrinkage keeps one odd assignment from swinging future plans; with more
// history the factor approaches the observed ratio. Clamped to a sane range.

export type CompletedSample = { courseId: string | null; estimatedMin: number; actualMin: number; completedAt: string };
export type Calibration = { factor: number; samples: number };

const PRIOR = 2;
const WINDOW = 10;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2.5;

export function courseCalibration(samples: CompletedSample[]): Map<string, Calibration> {
  const byCourse = new Map<string, CompletedSample[]>();
  for (const s of samples) {
    if (!s.courseId || s.estimatedMin <= 0 || s.actualMin <= 0) continue;
    const list = byCourse.get(s.courseId) ?? [];
    list.push(s);
    byCourse.set(s.courseId, list);
  }
  const out = new Map<string, Calibration>();
  for (const [courseId, list] of byCourse) {
    const recent = [...list].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, WINDOW);
    const n = recent.length;
    const raw = recent.reduce((m, s) => m + s.actualMin, 0) / recent.reduce((m, s) => m + s.estimatedMin, 0);
    const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, 1 + (raw - 1) * (n / (n + PRIOR))));
    out.set(courseId, { factor: Math.round(factor * 100) / 100, samples: n });
  }
  return out;
}

export function calibrationNote(c: Calibration | undefined) {
  if (!c || Math.abs(c.factor - 1) < 0.05) return c ? `Calibrated from ${c.samples} completed item${c.samples > 1 ? "s" : ""}; on target so far.` : null;
  const pct = Math.round((c.factor - 1) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% for this course · calibrated from ${c.samples} completed item${c.samples > 1 ? "s" : ""}.`;
}
