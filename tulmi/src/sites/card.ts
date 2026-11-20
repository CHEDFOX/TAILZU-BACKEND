/**
 * THE SIGN-IN CARD, READ OFF THE PAGE (docs/sign-in.md, src/sites/panel.ts).
 *
 *   cardFor(elements)   the page's own boxes as a card, or null to show the page instead
 *
 * The card is the same shape the desktop's is (shared/types/api.ts AgentHandoverCard): boxes with a kind, and the
 * other ways in the page offers. The difference is where it comes from. The desktop's is written by the planner,
 * which is reading <screen> anyway in the middle of a run; a panel has no run and no model in its path, so this
 * reads the roles the page reader already assigned — `secret` is a password box, `field` is a box, `button` is a
 * button — and names them from their own labels. No model, nothing per site, and an answer in a millisecond.
 *
 * WHEN THERE IS NO CARD, THERE IS THE PAGE. That is the whole safety of this file, and docs/sign-in.md says it
 * first: the card is only ever an improvement on the page, so anything that does not look plainly like a sign-in
 * gets null and the person signs in on the real thing, which always works. A card drawn over a page it does not
 * match would type a password into the wrong box, so this refuses far more pages than it accepts.
 */
import type { AgentField, AgentFieldKind, AgentWayIn } from "../../../shared/types/api.js";
import type { VisitElement } from "../web/browser/types.js";

export interface SignInCard {
  /** In the order they are filled, 1-6 (AgentHandoverCard). */
  fields: AgentField[];
  /** Other ways in the page offers, 0-4. */
  also?: AgentWayIn[];
  /** The button that sends it, when the page has an obvious one. */
  submit?: AgentWayIn;
}

const FIELDS_MAX = 6;
const WAYS_MAX = 4;
/** More boxes than this and it is a form, not a sign-in: a card over one would be a guess wearing a label. */
const BOXES_MAX = 6;
const LABEL_MAX = 48;

const words = (e: VisitElement): string => `${e.label ?? ""}`.toLowerCase();

/** What a box is after, from what the page calls it. A password box says so by its role and is never guessed at. */
function kindOf(e: VisitElement): AgentFieldKind {
  if (e.role === "secret") return "secret";
  const w = words(e);
  if (/\b(otp|code|pin|verification)\b/.test(w)) return "code";
  if (/\b(e-?mail)\b/.test(w)) return "email";
  if (/\b(phone|mobile|number|whatsapp)\b/.test(w)) return "phone";
  return "text";
}

/** A name a person would recognise. The page's own label when it has one, else what the box is for. */
function labelOf(e: VisitElement, kind: AgentFieldKind): string {
  const own = (e.label ?? "").trim().slice(0, LABEL_MAX);
  if (own) return own;
  return kind === "secret" ? "Password" : kind === "code" ? "Code" : kind === "email" ? "Email" : kind === "phone" ? "Phone number" : "";
}

/** "Continue with Google", "Use email instead" — the two shapes a page offers another way in (docs/sign-in.md). */
const WAY_IN = /\b(continue|sign in|log ?in|connect)\b.*\b(with|using)\b|\b(google|apple|facebook|github|microsoft|truecaller)\b|\buse\b.*\b(instead|rather)\b/i;
const SEND = /^(continue|next|sign in|log ?in|submit|send otp|get otp|verify|proceed)\b/i;

/**
 * The page's boxes as a card, or null when it does not plainly look like a sign-in. Null is the common answer and
 * the safe one: the panel then draws the page, which is what it did before any of this existed.
 */
export function cardFor(elements: readonly VisitElement[]): SignInCard | null {
  const boxes = elements.filter((e) => e.role === "field" || e.role === "secret");
  // Nothing to fill, or so much to fill that this is a form of some other kind.
  if (!boxes.length || boxes.length > BOXES_MAX) return null;

  const fields: AgentField[] = [];
  for (const e of boxes.slice(0, FIELDS_MAX)) {
    const kind = kindOf(e);
    const label = labelOf(e, kind);
    // A box nobody named, in a page full of boxes, is a box this cannot honestly put a name on.
    if (!label) { if (boxes.length > 1) return null; continue; }
    fields.push({ id: e.id, kind, label });
  }
  if (!fields.length) return null;

  // One box with no password beside it is the ordinary first step of a sign-in (a phone or an email, then a code),
  // but it is also every search box and every newsletter sign-up ever drawn. So it has to look like a way in.
  const looksLikeSignIn = fields.some((f) => f.kind === "secret" || f.kind === "code")
    || (fields.length > 1)
    || elements.some((e) => e.role === "button" && SEND.test((e.label ?? "").trim()));
  if (!looksLikeSignIn) return null;

  const also: AgentWayIn[] = [];
  for (const e of elements) {
    if (also.length >= WAYS_MAX) break;
    if (e.role !== "button" && e.role !== "link") continue;
    const label = (e.label ?? "").trim().slice(0, LABEL_MAX);
    if (label && WAY_IN.test(label)) also.push({ id: e.id, label });
  }

  const sender = elements.find((e) => e.role === "button" && SEND.test((e.label ?? "").trim()));
  return {
    fields,
    ...(also.length ? { also } : {}),
    ...(sender ? { submit: { id: sender.id, label: (sender.label ?? "").trim().slice(0, LABEL_MAX) } } : {}),
  };
}
