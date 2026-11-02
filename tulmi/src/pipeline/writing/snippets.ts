/**
 * The person's snippets: a short trigger said, its text written, with {date}-style variables filled in.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";

// --- Snippets (text expansion) ---------------------------------------------
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse "trigger = expansion" lines into pairs (first '=' splits the line).
 * Bounded: each one is a regex compiled and run over every completion, and a
 * personality can arrive whole in a request body.
 */
const MAX_SNIPPETS = 500;
function parseSnippets(text: string): Array<{ trigger: string; expansion: string }> {
  const out: Array<{ trigger: string; expansion: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const trigger = line.slice(0, i).trim();
    if (trigger && trigger.length <= 100) out.push({ trigger, expansion: line.slice(i + 1).trim() });
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

/** Context values available for interpolation inside a snippet expansion. */
export interface SnippetContext {
  name?: string;
  email?: string;
  phone?: string;
  targetApp?: string;
  recipient?: string;
  /** Injected in tests so time-based variables are deterministic. */
  now?: Date;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Resolve a single `{var}` placeholder. Unknown variables leave the literal
 * `{var}` in place — the user probably typed a stray brace and we shouldn't
 * silently eat it. Empty strings ARE emitted for known-but-missing variables
 * (so `sig = — {name}` becomes `— ` when we don't know the user's name).
 */
function resolveVariable(name: string, ctx: SnippetContext): string | null {
  const now = ctx.now ?? new Date();
  switch (name) {
    case "date":
      // ISO calendar date. Locale-aware formatting is a future upgrade.
      return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
    case "time":
      return `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
    case "day":
      return WEEKDAYS[now.getUTCDay()] ?? "";
    case "name":
      return ctx.name ?? "";
    case "email":
      return ctx.email ?? "";
    case "phone":
      return ctx.phone ?? "";
    case "targetApp":
      return ctx.targetApp ?? "";
    case "recipient":
      return ctx.recipient ?? "";
    default:
      return null;
  }
}

/** Interpolate `{var}` tokens inside a snippet expansion. */
function interpolate(expansion: string, ctx: SnippetContext): string {
  return expansion.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
    const v = resolveVariable(name, ctx);
    return v == null ? whole : v;
  });
}

/**
 * Expand the user's snippet triggers (whole-word, case-insensitive).
 * When `ctx` is provided, `{date}`, `{time}`, `{day}`, `{name}`, `{email}`,
 * `{phone}`,
 * `{targetApp}` and `{recipient}` inside an expansion are interpolated from
 * the caller's context — everything else is left literal (a stray `{foo}` is
 * more likely a real brace than a variable typo).
 */
export function expandSnippets(
  text: string,
  snippets?: string,
  ctx?: SnippetContext,
): string {
  if (typeof snippets !== "string" || !snippets.trim() || !text) return text;
  const context = ctx ?? {};
  let out = text;
  for (const { trigger, expansion } of parseSnippets(snippets)) {
    const re = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, "gi");
    out = out.replace(re, () => interpolate(expansion, context));
  }
  return out;
}

/** Build a snippet context from CleanupOptions + an optional recipient. */
export function ctxFromOpts(opts: CleanupOptions, recipient?: string): SnippetContext {
  return {
    name: opts.variables?.name,
    email: opts.variables?.email,
    phone: opts.variables?.phone,
    targetApp: opts.targetApp,
    recipient,
  };
}
