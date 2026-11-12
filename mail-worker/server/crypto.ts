// The mailbox password nobody types, and Stalwart's webhook signature. Node's crypto only. From Xooteq Mail's dashboard
// (dashboard/server/crypto.ts), without its logins and its sealed AI keys: nobody brings a key here.
import crypto from "node:crypto";
import { config } from "./config.ts";

/** A password for a mailbox nobody types (the dashboard impersonates it). */
export function mailboxPassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Stalwart's webhook header: base64 HMAC-SHA256 of the raw body. */
export function verifyWebhook(body: Buffer, signature: string | undefined): boolean {
  if (!signature || !config.webhookSecret) return false;
  const expected = crypto.createHmac("sha256", config.webhookSecret).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
