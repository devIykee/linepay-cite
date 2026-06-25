/**
 * Symmetric encryption for secrets at rest (AES-256-GCM).
 *
 * Used to store third-party integration credentials (Ghost Content + Admin API
 * keys) so they are never persisted in plaintext. The Admin API key in
 * particular doubles as the webhook-signing secret and must never appear in
 * logs, client responses, or error messages — keep decrypt() server-side only.
 *
 * Key: INTEGRATION_ENC_KEY — a 32-byte key, supplied as 64 hex chars or base64.
 * Generate one with:  openssl rand -hex 32
 *
 * Wire format (a single string, safe for a TEXT column):
 *   v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
 * The "v1" prefix lets us rotate the scheme later without ambiguity.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96-bit nonce, the GCM standard
const PREFIX = "v1";

let _key: Buffer | null = null;

/** Parse INTEGRATION_ENC_KEY (hex or base64) into exactly 32 bytes, or throw. */
function key(): Buffer {
  if (_key) return _key;
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENC_KEY is not set. Generate one with `openssl rand -hex 32` " +
        "and add it to the environment before using integration credentials."
    );
  }
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    buf = Buffer.from(raw.trim(), "hex");
  } else {
    buf = Buffer.from(raw.trim(), "base64");
  }
  if (buf.length !== 32) {
    throw new Error(
      `INTEGRATION_ENC_KEY must decode to 32 bytes (got ${buf.length}). ` +
        "Use 64 hex chars or a 32-byte base64 value."
    );
  }
  _key = buf;
  return _key;
}

/** True when an encryption key is configured (lets callers fail gracefully). */
export function secretsEnabled(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a UTF-8 string. Returns the `v1:iv:tag:ciphertext` wire string. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a wire string produced by encryptSecret(). Throws on tamper/format errors. */
export function decryptSecret(wire: string): string {
  const parts = (wire ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Malformed encrypted secret.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
