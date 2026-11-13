/**
 * A CALL'S LINK (src/rooms, docs/rooms.md): x0bot.com/m/abc-defg-hij. Its code is ten random letters from an alphabet with nothing that reads
 * as something else (no 0/o, 1/l/i), about 49 bits: a link cannot be guessed, and one found only lets its holder ask to come in.
 *
 *   newCode()           a fresh code, "abc-defg-hij"
 *   codeOf(raw)         a code as a person may paste it (any case, with or without dashes, or the whole link) -> "abc-defg-hij", or ""
 *   hashOf(code)        what the row is found by
 *   linkOf(code)        the link to share
 *   sealer(key)         seal(code) / open(sealed): the row keeps the code sealed (AES-256-GCM), so the host can share the link again
 */
import { createHash, createHmac, randomInt } from "node:crypto";
import { getConfig } from "../config.js";
import { decrypt, encrypt, tokenKey } from "../connectors/crypto.js";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = [3, 4, 3] as const;
const LETTERS = GROUPS.reduce((a, b) => a + b, 0);
const SHAPE = new RegExp(`^[${ALPHABET}]{${LETTERS}}$`);

export function newCode(): string {
  let s = "";
  for (let i = 0; i < LETTERS; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

/** A code from what a person or a link gives: the last part of a link, any case, the dashes optional. "" when it cannot be one. */
export function codeOf(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 300) return "";
  const tail = (raw.trim().split(/[?#]/)[0] ?? "").split("/").filter(Boolean).pop() ?? "";
  const flat = tail.toLowerCase().replace(/-/g, "");
  if (!SHAPE.test(flat)) return "";
  return `${flat.slice(0, 3)}-${flat.slice(3, 7)}-${flat.slice(7)}`;
}

export const hashOf = (code: string): string => createHash("sha256").update(`x0-room:${code}`).digest("hex");

export function linkOf(code: string, origin: string = getConfig().ROOM_LINK_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/m/${code}`;
}

export interface Sealer { seal(code: string): string; open(sealed: string): string }

/** Seals codes under a key made for this use only from CONNECTOR_TOKEN_KEY (the way Plan Ease's calendar links are sealed). */
export function sealer(key?: Buffer): Sealer {
  let made: Buffer | null = key ?? null;
  const k = (): Buffer => (made ??= createHmac("sha256", tokenKey()).update("x0:rooms:link:v1").digest());
  return { seal: (code) => encrypt(code, k()), open: (sealed) => decrypt(sealed, k()) };
}
