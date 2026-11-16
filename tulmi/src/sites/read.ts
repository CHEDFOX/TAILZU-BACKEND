/**
 * A PAGE, READ, AND NOTHING ELSE (docs/sites.md).
 *
 * The browser opens the page as them (web/browser/engine.ts `visit`), and a small model turns what it says into a
 * card. That is the whole loop. There is no clicking, no typing and no spending anywhere in this file, which is why
 * it is the half that can be trusted: the worst a strange page can do here is be misread, and a misread card is
 * wrong rather than expensive.
 *
 * EVERYTHING THE PAGE SAYS IS DATA. It is fenced before the model sees it, like every other outside text in this
 * codebase, because a page can carry words meant for the reader rather than the person — including words nobody can
 * see, since text faded to nothing is still text. The model is told to report what the page shows and is given
 * nothing it could act on even if it were talked into wanting to.
 */
import { z } from "zod";
import { askJson } from "../code/work/model.js";
import { fenced } from "../agent/prompt.js";
import type { SiteCard, SiteStage } from "../../../shared/types/api.js";
import type { VisitedPage } from "../web/browser/types.js";

/** Caps, so one long page cannot become one long card. */
const TITLE_MAX = 80, LINE_MAX = 120, DETAIL_MAX = 160, OWED_MAX = 80, STAGE_MAX = 40, STAGES_MAX = 8;
/** What the model is shown of the page: enough for a status, far short of a novel. */
const PAGE_CHARS = 6000;

export const CardReply = z.object({
  title: z.string(),
  line: z.string(),
  stages: z.array(z.object({ name: z.string(), when: z.string().optional(), done: z.boolean() })).optional(),
  detail: z.string().optional(),
  done: z.boolean().optional(),
  owed: z.string().optional(),
  /** The page is not showing this thing at all any more (an order that has fallen off a list). */
  missing: z.boolean().optional(),
}).strict();

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/**
 * What the model is told. The page is fenced data; the label is the person's own word for the thing, which is the
 * only way to pick it out of a list of five orders.
 */
export function readUser(label: string, page: Pick<VisitedPage, "title" | "text" | "finalUrl">): string {
  return [
    `The thing they are asking about: ${fenced(label) || "the newest one"}`,
    `The page: ${fenced(page.title)} (${fenced(new URL(page.finalUrl).host)})`,
    "<page>",
    fenced(page.text.slice(0, PAGE_CHARS)),
    "</page>",
  ].join("\n");
}

/** A stage list worth drawing: in order, named as the site names them, capped. */
function stagesOf(raw: z.infer<typeof CardReply>["stages"]): SiteStage[] {
  if (!Array.isArray(raw)) return [];
  const out: SiteStage[] = [];
  for (const s of raw.slice(0, STAGES_MAX)) {
    const name = clip(s?.name, STAGE_MAX);
    if (!name) continue;
    const when = clip(s?.when, STAGE_MAX);
    out.push({ name, done: s?.done === true, ...(when ? { when } : {}) });
  }
  return out;
}

/**
 * The card, or null when the read gave nothing worth showing. Null matters: the watch keeps the card it had, because
 * a blank card reads as "nothing is happening", which is a lie about a parcel that is simply on a page we misread.
 */
export function cardOf(reply: z.infer<typeof CardReply>): SiteCard | null {
  if (reply.missing === true) return null;
  const title = clip(reply.title, TITLE_MAX);
  const line = clip(reply.line, LINE_MAX);
  const stages = stagesOf(reply.stages);
  if (!title || (!line && stages.length === 0)) return null;
  const detail = clip(reply.detail, DETAIL_MAX);
  const owed = clip(reply.owed, OWED_MAX);
  return {
    title, line, stages,
    ...(detail ? { detail } : {}),
    ...(owed ? { owed } : {}),
    ...(reply.done === true ? { done: true } : {}),
  };
}

export interface ReadDeps {
  call?: Parameters<typeof askJson>[0]["call"];
  gateway?: Parameters<typeof askJson>[0]["gateway"];
  maxPaise: number;
}

/** Ask the model for the card. Never throws: a read that fails leaves the watch as it was. */
export async function readCard(userId: string, label: string, page: VisitedPage, d: ReadDeps): Promise<SiteCard | null> {
  try {
    const r = await askJson({
      ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      userId, budget: { maxPaise: d.maxPaise },
    }, {
      tier: "tiny", purpose: "site.read", role: "site_read",
      user: readUser(label, page), schema: CardReply, maxTokens: 400,
    });
    return r.ok ? cardOf(r.value) : null;
  } catch {
    return null;
  }
}

/**
 * THE SITE NO LONGER BELIEVES THE SLIP. Judged on what came back rather than on a status code, because a site that
 * has signed you out usually answers 200 with its sign-in page on it.
 */
export function looksSignedOut(page: VisitedPage): boolean {
  const where = `${page.finalUrl} ${page.title}`.toLowerCase();
  if (/\b(sign[\s-]?in|signin|log[\s-]?in|login|auth|account\/access)\b/.test(where)) return true;
  // A password box on the page we were sent to is the plainest sign there is.
  return page.elements.some((e) => e.role === "secret");
}
