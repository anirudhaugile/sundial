import "server-only";
import { isIP } from "node:net";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export class SourceError extends Error {}

/** webcal:// links are just https. */
export function normalizeFeedUrl(raw: string) {
  const s = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new SourceError("That isn't a valid URL.");
  }
  assertPublicHttps(url);
  return url.toString();
}

/** User-supplied URLs are fetched server-side, so refuse anything that points inward. */
export function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new SourceError("Only https:// links are supported.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    (isIP(host) &&
      (/^(10|127|0)\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^(::1|fc|fd|fe80)/i.test(host)));
  if (blocked) throw new SourceError("That address isn't reachable from Sundial.");
}

/** fetch with a timeout, size cap and friendly errors. */
export async function safeFetch(url: string, init: RequestInit = {}) {
  assertPublicHttps(new URL(url));
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    throw new SourceError(e instanceof Error && e.name === "TimeoutError" ? "The server took too long to respond." : "Couldn't reach that server.");
  }
  if (res.url) assertPublicHttps(new URL(res.url));
  if (res.status === 401 || res.status === 403) throw new SourceError("Access denied — check the token or link.");
  if (res.status === 404) throw new SourceError("Not found — the link may have been unpublished.");
  if (!res.ok) throw new SourceError(`The server answered ${res.status}.`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new SourceError("That feed is too large.");
  return res;
}

export async function fetchText(url: string, init?: RequestInit) {
  const res = await safeFetch(url, init);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new SourceError("That feed is too large.");
  return { text, res };
}
