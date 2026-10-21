/**
 * TOKENS AT REST: AES-256-GCM under CONNECTOR_TOKEN_KEY.
 *
 * A connector's token lets Tailzu act as the person in another app, so it is
 * never stored in the clear and never stored at all without a key: with no key
 * (or one that is not 32 bytes) `encrypt` refuses, and the connect flow fails
 * loudly instead of quietly keeping a secret in a table.
 *
 * Format: "v1." + base64url(iv[12] | tag[16] | ciphertext). A fresh random IV
 * every time. The key is also what the OAuth `state` is signed with (through a
 * labelled HMAC, so the two uses never share a raw key), which is why one key
 * is the whole of the setup.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";

export class NoTokenKey extends Error {
  readonly code = "no_key";
  constructor(why = "CONNECTOR_TOKEN_KEY is not set") {
    super(`Connected apps are not set up on this server (${why}).`);
  }
}

/** The key as 32 bytes. Throws NoTokenKey when missing or the wrong size. */
export function tokenKey(b64: string | undefined = getConfig().CONNECTOR_TOKEN_KEY): Buffer {
  if (!b64) throw new NoTokenKey();
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new NoTokenKey("CONNECTOR_TOKEN_KEY must be 32 bytes, base64");
  return key;
}

export function encrypt(plain: string, key: Buffer = tokenKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

/** The text back, or throws when the blob was altered or the key is not the one it was written with. */
export function decrypt(blob: string, key: Buffer = tokenKey()): string {
  if (!blob.startsWith("v1.")) throw new Error("unreadable token");
  const raw = Buffer.from(blob.slice(3), "base64url");
  if (raw.length < 29) throw new Error("unreadable token");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** The HS256 key for signing OAuth state, derived from the token key. */
export function stateKey(key: Buffer = tokenKey()): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update("tailzu-connector-state-v1").digest());
}
