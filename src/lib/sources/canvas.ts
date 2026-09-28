import "server-only";
import { fetchText, SourceError } from "./fetch";

export type CanvasCourse = { id: number; name: string; course_code: string };
export type CanvasAssignment = {
  id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  course_id: number;
  submission?: { workflow_state: string; submitted_at: string | null } | null;
  locked_for_user?: boolean;
  omit_from_final_grade?: boolean;
};

export function normalizeCanvasBase(raw: string) {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  return `https://${url.host}`;
}

/** GET a Canvas collection, following Link: rel="next" pagination. */
async function getAll<T>(base: string, token: string, path: string, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${base}${path}`;
  for (let page = 0; url && page < maxPages; page++) {
    const { text, res } = await fetchText(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SourceError("Canvas returned something unexpected. Is the base URL right?");
    }
    if (!Array.isArray(data)) throw new SourceError("Canvas returned something unexpected.");
    out.push(...(data as T[]));
    const link: string = res.headers.get("link") ?? "";
    const next: string | undefined = link.split(",").find((p) => p.includes('rel="next"'));
    url = next ? (next.match(/<([^>]+)>/)?.[1] ?? null) : null;
    if (url && !url.startsWith(base)) url = null; // never follow pagination off-domain
  }
  return out;
}

export async function fetchCanvas(baseRaw: string, token: string) {
  const base = normalizeCanvasBase(baseRaw);
  const courses = await getAll<CanvasCourse>(base, token, "/api/v1/courses?enrollment_state=active&per_page=100");
  const assignments: CanvasAssignment[] = [];
  for (const c of courses) {
    try {
      const list = await getAll<CanvasAssignment>(
        base,
        token,
        `/api/v1/courses/${c.id}/assignments?per_page=100&order_by=due_at&include[]=submission`,
      );
      assignments.push(...list.map((a) => ({ ...a, course_id: c.id })));
    } catch (e) {
      // one course without assignment access shouldn't sink the whole sync
      if (!(e instanceof SourceError && /denied/i.test(e.message))) throw e;
    }
  }
  return { base, courses, assignments };
}

/** Strip Canvas HTML to plain text for estimates. */
export function htmlToText(html: string | null | undefined, max = 4000) {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text ? text.slice(0, max) : null;
}
