/**
 * THE E2E HARNESS'S ENVIRONMENT. Import this FIRST in every entry point: config.ts reads process.env when it is first used, and ES imports are hoisted,
 * so the placeholders must be in place before anything that loads it.
 *
 * `realKey` is the OpenRouter key the person set, or "": the placeholder below exists only so config.ts will load; no code path may treat it as a key.
 * Nothing here reads or writes a secret.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TULMI_DIR = path.dirname(E2E_DIR);

// A .env beside the source is the person's; load it for the key, but never let it override what the shell set.
const envFile = path.join(TULMI_DIR, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*(OPENROUTER_API_KEY|CODE_USD_INR)\s*=\s*"?([^"\n#]*)"?/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
  }
}

export const realKey: string = (process.env.OPENROUTER_API_KEY ?? "").trim();
if (!realKey) process.env.OPENROUTER_API_KEY = "e2e-offline-placeholder";
process.env.GROQ_API_KEY ??= "e2e-offline-placeholder";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY ??= Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
// The brain's own run ledger needs a database; the harness keeps its own in memory.
process.env.AGENT_RUN_LEDGER = "false";
