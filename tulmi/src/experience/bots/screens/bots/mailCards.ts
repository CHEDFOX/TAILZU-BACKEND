/**
 * THE MAIL BOT'S SET-UP (docs/mail.md section 9): asked as the Oracle's cards ask (oracleCards.ts), one card over the mail bot's page with its
 * stage on top, one step after the other, each kept as soon as it is answered, so leaving halfway loses nothing:
 *
 *   1. the business   its name and its domain: POST /v1/mail/businesses. The domain and its mailbox (hello@) are made on our mail server, and
 *                     the page comes back with the business, for the rest. Also "Add a business" in its settings (params add=1)
 *   2. the records    what to add at the domain's DNS (MX, SPF, DKIM, DMARC), each with Copy and its live check; "Check again" reads them
 *                     again. Mail arrives once the MX is in: it can take a while, so Next never waits on it
 *   3. how it answers Drafts for you (the start: every reply waits for a person to send) or Sends by itself (after a short wait; money, legal
 *                     matters, complaints and anything unsure still wait): PUT each address's mode
 *   4. what it knows  "Fill from my website" drafts it from the business's own pages (a model call), and the person reads it and keeps it: PUT
 *                     the brief. "Skip for now" keeps the careful defaults. Kept: the business is set up (`ready`)
 *   then              "All set.", the bot's happy moment, and the page
 *
 * Steps 2 to 4 are due while the business shown is not set up, or when its settings ask (params setup=1). A build without the living card
 * gets the same steps in a plain card at the top.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, box, C, call, canMove, col, FACE, icon, labelled, row, SCREENS, seq, statusMark, text, when } from "../../kit.js";
import { line, permitStep, setState, toast } from "../firstRun/parts.js";
import { copyAction } from "./keysDesk.js";
import { type BriefView, type DnsView, MAIL, MAIL_SLUG, type MailData, type MailBusinessView, MODE_WORDS, shownBusiness } from "./mailParts.js";

/** The state the cards keep. */
export const MC = {
  name: "mc_name", domain: "mc_domain", made: "mc_made",
  dns: "mc_dns", mode: "mc_mode", brief: "mc_brief", busy: "mc_busy", draft: "mc_draft", closed: "mc_closed",
} as const;
const WIDTH = { phone: 340, desktop: 380 };

/** The first step is due: no business yet, or another asked for. */
export const needsBusiness = (ctx: BotsCtx, d: MailData): boolean => !d.down && (!!d.overview && (!d.overview.businesses.length || ctx.params.add === "1"));
/** The other steps are due: the business shown is not set up yet, or its settings asked for them again. */
export const needsSetup = (ctx: BotsCtx, d: MailData): boolean => {
  const b = shownBusiness(ctx, d.overview);
  return !!b && !needsBusiness(ctx, d) && (!b.ready || ctx.params.setup === "1");
};
export const mailCardsDue = (ctx: BotsCtx, d: MailData): boolean => needsBusiness(ctx, d) || needsSetup(ctx, d);

/** What the page starts with while the cards are due. */
export function mailCardsState(d: MailData): Record<string, unknown> {
  const p: Partial<BriefView> = d.brief?.profile ?? {};
  return {
    [MC.name]: "", [MC.domain]: "", [MC.made]: false,
    [MC.dns]: false, [MC.mode]: false, [MC.brief]: false, [MC.busy]: false, [MC.closed]: false,
    // The brief's fields, as "Fill from my website" answers them ({ draft, pages }), so its answer lands in the same places.
    [MC.draft]: { draft: { about: p.about ?? "", knowledge: p.knowledge ?? "", voice: p.voice ?? "", policies: p.policies ?? "" } },
  };
}

/** The mail bot's page again, as it is now (the business made, or the set-up done). */
const again = (business?: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, ...(business ? { b: business } : {}) }, replace: true });
/** Opens the cards again for a business (its settings' "Set-up again"), or for a new one ("Add a business"). */
export const openSetup = (business: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b: business, setup: "1" } });
export const addBusiness = (): ActionSpec => ({ kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, add: "1" } });

/** A one-line field in the cards' look (oracleCards.ts cardField's), or a taller one for the brief. */
export function mailField(path: string, placeholder: string, desk: boolean, o: { label: string; onSubmit?: ActionRef; multiline?: boolean; minHeight?: number; keyboard?: "email" | "text"; capitalize?: boolean }): Node {
  const tall = o.multiline ? (o.minHeight ?? 110) : 0;
  const input: Node = {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: tall || 44, color: C.ink, autoCorrect: !!o.multiline, returnKeyType: o.multiline ? "default" : "done",
      ...(o.multiline ? { multiline: true } : {}), ...(o.capitalize ? { autoCapitalize: "words" } : { autoCapitalize: o.multiline ? "sentences" : "none" }),
      ...(o.keyboard === "email" ? { keyboardType: "url" } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: tall || 44, paddingHorizontal: 0, paddingVertical: o.multiline ? 10 : 0,
      fontFamily: FACE.medium, fontSize: o.multiline ? 15 : 17, lineHeight: o.multiline ? 21 : undefined, color: C.ink, borderWidth: 0,
      backgroundColor: "transparent", outlineStyle: "none", ...(o.multiline ? { textAlignVertical: "top" } : {}),
    },
  };
  return row([
    input,
    ...(o.multiline ? [] : [labelled(box([icon("close", { size: 18, color: C.meta })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
      setState(path, "")), `Clear ${o.label}`)]),
  ], {
    ...(o.multiline ? { minHeight: tall + 2, alignItems: "flex-start" } : { height: desk ? 54 : 56 }),
    borderWidth: 1.5, borderColor: C.ink, borderRadius: desk ? 14 : 16, paddingLeft: 16, paddingRight: o.multiline ? 12 : desk ? 6 : 4,
  });
}

/** One DNS record to add: what kind, under what name, whether it is there yet, and its value with Copy. */
export function recordRow(ctx: BotsCtx, r: DnsView["records"][number]): Node {
  const ok = r.status === "ok";
  const value = r.type === "MX" && r.priority !== undefined ? `${r.value}  (priority ${r.priority})` : r.value;
  return col([
    row([
      ok ? icon("check", { size: 14, color: C.ink, label: "Found" }) : labelled(box([statusMark("waiting", { size: 9 })], { width: 14, alignItems: "center" }), "Not yet"),
      text(r.type === "TXT" ? `${r.kind} (TXT)` : r.type, { size: 13, weight: 600, lineHeight: 18, style: { flexShrink: 0 } }),
      text(`Name: ${r.host}`, { size: 12, color: C.grey70, lineHeight: 16, lines: 1, style: { flexShrink: 1 } }),
      { type: "Stack", style: { flexGrow: 1 } },
      text(ok ? "Found" : r.status === "differs" ? "Change it" : "Not yet", { size: 12, color: ok ? C.ink : C.meta, lineHeight: 16, style: { flexShrink: 0 } }),
    ], { gap: 8, alignItems: "center" }),
    row([
      // A DKIM key has no spaces: without minWidth 0 it would push Copy off the card.
      text(value, { size: 12, mono: true, color: C.ink, lineHeight: 17, lines: 2, style: { flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 } }),
      labelled(row([text("Copy", { size: 12, weight: 500, lineHeight: 16 })], { minHeight: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: C.outline, alignItems: "center", flexShrink: 0 },
        copyAction(ctx, r.value)), `Copy the ${r.kind} value`),
    ], { gap: 10, alignItems: "center" }),
    ...(r.note ? [text(r.note, { size: 12, color: C.meta, lineHeight: 16 })] : []),
  ], { gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: C.line });
}

/** "Drafts for you" or "Sends by itself" as a card one taps to choose (and go on). */
function modeChoice(title: string, line1: string, onPress: ActionRef, recommended = false): Node {
  return labelled(col([
    row([text(title, { size: 16, weight: 600, lineHeight: 21 }), ...(recommended ? [text("To start", { size: 11, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15 })] : [])], { gap: 8, alignItems: "center", justifyContent: "space-between" }),
    text(line1, { size: 13, color: C.grey70, lineHeight: 18 }),
  ], { gap: 4, padding: 14, borderRadius: 16, borderWidth: recommended ? 1.5 : 1, borderColor: recommended ? C.ink : C.line }, onPress), title);
}

/**
 * The cards, while they are due; nothing otherwise. `look`: the bot's colour.
 */
export function mailCards(ctx: BotsCtx, d: MailData, look: { color: string }): Node[] {
  if (!mailCardsDue(ctx, d)) return [];
  const desk = ctx.client === "desktop";
  const living = canMove(ctx);
  const first = needsBusiness(ctx, d);
  const b: MailBusinessView | undefined = first ? undefined : shownBusiness(ctx, d.overview);

  // 1. The business: made, then the page again with it (the rest of the set-up is built from it).
  if (first) {
    const make: ActionSpec = {
      kind: "condition", if: { all: [{ truthy: MC.name }, { truthy: MC.domain }] },
      then: seq(setState(MC.busy, true), call("POST", `${MAIL}/businesses`, { name: `$state.${MC.name}`, domain: `$state.${MC.domain}` }, {
        // The living card cheers, then goes back to the page (frame's onComplete); the plain one goes at once.
        ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(MC.busy, false), setState(MC.made, true), ...(living ? [] : [again()])),
        fail: seq(setState(MC.busy, false), toast("Couldn't set that up. Check the domain (like leafandco.in) and try again.")),
      })),
      else: toast("Add the business's name and its domain."),
    } as ActionSpec;
    const step = permitStep({
      when: { falsy: MC.made },
      title: d.overview?.businesses.length ? "Another business" : "Your business's email",
      lines: [line("Its name, and the domain its email is on. We make its mailbox on our mail server; the AI that answers is ours too. Nothing to bring.")],
      extra: [
        mailField(MC.name, "Business name, like Leaf & Co", desk, { label: "the name", capitalize: true }),
        mailField(MC.domain, "Domain, like leafandco.in", desk, { label: "the domain", keyboard: "email", onSubmit: make }),
        when({ truthy: MC.busy }, line("Making its mailbox…")),
      ],
      cta: { label: "Next", onPress: make },
      ...(ctx.params.add === "1" ? { quiet: { label: "Cancel", onPress: again() } } : {}),
    });
    return frame([step], { living, desk, color: look.color, done: { truthy: MC.made } });
  }

  const id = b!.id;
  const allKept: Condition = { all: [{ truthy: MC.dns }, { truthy: MC.mode }, { truthy: MC.brief }] };
  // The living card ends with its happy moment, then the page again; the plain one goes back to the page as the last step is kept.
  const kept = (flag: string): ActionRef => seq(
    { kind: "haptic", style: "success" } as ActionSpec, setState(flag, true),
    ...(living ? [] : [{ kind: "condition", if: allKept, then: again(id) } as ActionSpec]),
  );

  // 2. The records.
  const records = (d.dns?.records ?? []).filter((r) => r.required);
  const dnsStep = permitStep({
    when: { falsy: MC.dns },
    title: `Point ${b!.domain} here`,
    lines: [line(`Add these where ${b!.domain} was bought (GoDaddy, Cloudflare…). Mail arrives once the MX is in: minutes to a few hours.`)],
    extra: records.length
      ? [col(records.map((r) => recordRow(ctx, r)), { gap: 0 })]
      : [line("The records couldn't be read just now. They are in the business's settings, under Domain records.")],
    cta: { label: "Next", onPress: kept(MC.dns) },
    quiet: { label: "Check again", onPress: { kind: "refresh" } as ActionSpec },
  });

  // 3. How it answers: every address of the business, the same way.
  // One address after the other, and the step is kept only once every one of them took it.
  const setMode = (mode: "draft" | "send"): ActionRef => b!.addresses.reduceRight<ActionRef>(
    (next, a) => call("PUT", `${MAIL}/businesses/${id}/addresses/${a.id}`, { aiMode: mode }, { ok: next, fail: toast("Couldn't save that. Try again.") }),
    kept(MC.mode),
  );
  const modeStep = permitStep({
    when: { all: [{ truthy: MC.dns }, { falsy: MC.mode }] },
    title: "How should it answer?",
    lines: [line("You can change it any time, for each address.")],
    extra: [
      modeChoice(MODE_WORDS.draft!, "Every reply waits in Drafts for you to read, change and send.", setMode("draft"), true),
      modeChoice(MODE_WORDS.send!, "Replies go after a few minutes unless you stop them. Money, legal matters, complaints and anything it is unsure of still wait for you.", setMode("send")),
    ],
    quiet: { label: "Back", onPress: setState(MC.dns, false) },
  });

  // 4. What it knows: drafted from the website, read, kept.
  const fill = seq(setState(MC.busy, true), call("POST", `${MAIL}/businesses/${id}/brief/draft`, {}, {
    assignTo: MC.draft,
    ok: setState(MC.busy, false),
    fail: seq(setState(MC.busy, false), toast(`Couldn't read ${b!.domain}. Write it yourself, or try again later.`)),
  }));
  const keep = call("PUT", `${MAIL}/businesses/${id}/brief`, {
    about: `$state.${MC.draft}.draft.about`, knowledge: `$state.${MC.draft}.draft.knowledge`,
    voice: `$state.${MC.draft}.draft.voice`, policies: `$state.${MC.draft}.draft.policies`,
  }, { ok: kept(MC.brief), fail: toast("Couldn't save that. Try again.") });
  const skip = call("PUT", `${MAIL}/businesses/${id}/brief`, {}, { ok: kept(MC.brief), fail: toast("Couldn't save that. Try again.") });
  const briefStep = permitStep({
    when: { all: [{ truthy: MC.dns }, { truthy: MC.mode }, { falsy: MC.brief }] },
    title: "What should it know?",
    lines: [line(`What ${b!.name} does, and the facts a reply may use: prices, hours, delivery, returns. It answers only from these, and asks you when they don't say.`)],
    extra: [
      labelled(row([icon("spark", { size: 16, color: C.ink }), text(`Fill from ${b!.domain}`, { size: 14, weight: 500, lineHeight: 18 })],
        { gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.outline, alignSelf: "flex-start", alignItems: "center" }, fill), `Fill from ${b!.domain}`),
      when({ truthy: MC.busy }, line(`Reading ${b!.domain}…`)),
      mailField(`${MC.draft}.draft.about`, `What ${b!.name} does, and for whom`, desk, { label: "about", multiline: true, minHeight: 80 }),
      mailField(`${MC.draft}.draft.knowledge`, "Facts: prices, hours, delivery, returns, links", desk, { label: "the facts", multiline: true, minHeight: 120 }),
    ],
    cta: { label: "Keep", onPress: keep },
    quiet: { label: "Skip for now", onPress: skip },
  });

  return frame([dnsStep, modeStep, briefStep], { living, desk, color: look.color, done: allKept, business: id });
}

/** The living card over the page (the page blurred behind it), or the plain one at the top for a build without it. */
function frame(steps: Node[], o: { living: boolean; desk: boolean; color: string; done: Condition; business?: string }): Node[] {
  const doneLine = when(o.done, row([text(o.business ? "All set." : "Made.", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
  if (o.living) {
    return [botCard([...steps, doneLine], {
      kind: "custom", color: o.color, stageHeight: 96, overlay: true, width: WIDTH[o.desk ? "desktop" : "phone"], label: "The mail bot",
      doneWhen: o.done, doneDelayMs: 1600, onComplete: seq(setState(MC.closed, true), again(o.business)), closeWhen: { truthy: MC.closed },
    })];
  }
  return [when({ all: [{ falsy: MC.closed }, { not: o.done }] }, col(steps, {
    width: WIDTH[o.desk ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center",
    borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6,
  }))];
}
