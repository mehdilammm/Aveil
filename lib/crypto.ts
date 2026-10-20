import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Stored format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64");
  return buf;
}

// aad binds the ciphertext to one store, so values cannot be swapped between rows.
export function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(stored: string, aad: string): string {
  const [version, iv, tag, ct] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unknown credential format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
