/**
 * THE X0 WIDGET'S AI DIGEST (docs/widget-glance-v2.md section 4): when three or more things changed since the person last looked, one
 * short line that sums them up ("Cart fix shipped; Plan Ease needs your yes"), in place of the situation line (situation.ts).
 *
 * Off unless WIDGET_DIGEST is on (config.ts). When on:
 *
 *   - ONCE PER CHANGE. The changes have a signature (their ids and kinds); the line is written once for it and kept with the person's glance
 *     state (glanceStore.ts), and every glance until the next change reads it from there. A model that was down or answered too long is
 *     kept as "no line" for that change too: it is not asked again for it.
 *   - THE CHEAPEST MODEL, through the model gateway (code/work/model.ts askJson, the tiny tier, role widget_digest), held to
 *     x0.digest.maxPaise. Never the reason a glance is slow: the glance waits x0.digest.waitMs at most, then sends the situation line; the
 *     line still lands in the cache for the next fetch.
 *   - PRIVATE-SAFE. The model is told only what the widget could show on a locked phone: a bot's name and what kind of change it was, and
 *     words only for what is not private (never a private question's words, never a connected app's: changesOf in glance.ts gives them
 *     as null). What it writes is checked: one line, 60 characters at most, no secret; else no line.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { askJson, forModel, type CallFn } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { scanForSecrets } from "../code/policy.js";
import { oneLineOf } from "./botWords.js";
import type { GlanceChange } from "./glance.js";
import type { GlanceState } from "./glanceStore.js";
import { SUMMARY_MAX } from "./situation.js";

export const DigestReply = z.object({ line: z.string() }).strict();

/** The signature of a set of changes: the same changes are the same line. */
export function changeSig(changes: readonly GlanceChange[]): string {
  const ids = changes.map((c) => `${c.kind}:${c.id}`).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}

/** What the model is told: the language, and the changes as fenced data (no private words; nothing that can close the fence). */
export function digestUser(changes: readonly GlanceChange[], hg: boolean): string {
  const clean = (s: string) => forModel(oneLineOf(s)).replace(/<<<|>>>/g, " ").slice(0, 120);
  const lines = changes.slice(0, 12).map((c) => {
    const what = c.kind === "needs" ? "needs the person" : c.kind === "done" ? "finished" : c.kind === "failed" ? "stopped with a problem" : "started";
    return `- ${clean(c.botName)} ${what}${c.words ? `: ${clean(c.words)}` : ""}`;
  });
  return `Language: ${hg ? "hinglish" : "en"}\nChanges:\n<<<\n${lines.join("\n")}\n>>>`;
}

/** The model's line, if it is one the widget may show: one line, 60 at most, no secret (it was never given a private item's words). */
export function usableDigest(raw: unknown, max = SUMMARY_MAX): string | null {
  const line = oneLineOf(raw).replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!line || line.length > max) return null;
  if (scanForSecrets([{ path: "digest.txt", content: line }]).length) return null;
  return line;
}

export interface DigestDeps {
  call?: CallFn;
  gateway?: GatewayDeps;
  /** How long a glance waits for a line it does not have yet (ms). */
  waitMs: number;
  maxPaise: number;
  /** Where the line is kept: the person's glance state. */
  save: (digest: NonNullable<GlanceState["digest"]>) => Promise<unknown>;
  now: () => number;
}

/**
 * The digest line for these changes: the cached one when it is for the same changes; else asks once (or null while it is written, or when
 * the model gave nothing usable). Never throws.
 */
export async function digestFor(userId: string, changes: readonly GlanceChange[], hg: boolean, cached: GlanceState["digest"], d: DigestDeps): Promise<string | null> {
  if (changes.length === 0) return null;
  const sig = changeSig(changes);
  if (cached && cached.sig === sig) return cached.line;
  const asked = (async (): Promise<string | null> => {
    const r = await askJson({ ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId, budget: { maxPaise: d.maxPaise } }, {
      tier: "tiny", purpose: "widget.digest", role: "widget_digest", user: digestUser(changes, hg), schema: DigestReply, maxTokens: 60,
    });
    const line = r.ok ? usableDigest(r.value.line) : null;
    await d.save({ sig, line, at: d.now() }).catch(() => undefined);
    return line;
  })().catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), Math.max(0, d.waitMs)); timer.unref?.(); });
  try {
    return await Promise.race([asked, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
