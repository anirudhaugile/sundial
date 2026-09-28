import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

// AES-256-GCM for source tokens and feed URLs at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

function key() {
  const k = Buffer.from(serverEnv.secretsKey, "base64");
  if (k.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string) {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function hint(secret: string) {
  return `…${secret.slice(-4)}`;
}
