import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

export const MODEL = "claude-opus-5";

let client: Anthropic | null = null;

/** Null when no key is configured: the app still works, with default estimates and no chat. */
export function anthropic() {
  const key = serverEnv.anthropicKey;
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key });
  return client;
}
