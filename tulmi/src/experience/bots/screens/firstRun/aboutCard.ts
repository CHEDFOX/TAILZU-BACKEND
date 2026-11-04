/**
 * THE ABOUT YOU CARD: the person's name and gender, asked on Home after a few visits, never in the first run.
 *
 * The same card as the microphone and keyboard one (the bot on a stage, one black pill, a quiet "Not now"), and about
 * its size (the same width, a shorter stage, no labels, a compact field and chips), but at the top of Home rather than over it, so the
 * keyboard never covers it while the name is typed. Due by the server
 * (GET /v1/bots/first-run/about: onboarded, a few visits in, the answer still owed, not put off for now).
 *
 *   the name     filled in from what Google shared, else the account's own, else a guess from the email; theirs to change.
 *                Signed in with Apple there is NO name field (App Review 4: nothing Apple shares is asked again): the name
 *                Apple gave is kept as it is, and only the gender is asked
 *   the gender   Male, Female or Other: the one thing needed to save, so bots write to them right in gendered languages
 *   Save         PUT /v1/profile { full_name, gender } (the profile's own write), the bot's happy moment, and it goes
 *   Not now      PUT /v1/bots/first-run/about: it comes again a few visits later, a few times at most
 */
import type { ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, canMove, call, col, C, icon, labelled, row, seq, text, when } from "../../kit.js";
import { type About, CARD_BOT, GENDERS, line, nameField, permitStep, setState, toast } from "./parts.js";

/** The card's read and its "Not now". */
export const ABOUT_PATH = "/v1/bots/first-run/about";

const NAME = "aboutName", GENDER = "aboutGender", SAVED = "aboutSaved", CLOSED = "aboutClosed";
/** The microphone and keyboard card's width (arrivalCard.ts), so the two look like one family. */
const WIDTH = { phone: 330, desktop: 360 };

/** What Home starts with while the card is due. */
export function aboutState(about: About | undefined): Record<string, unknown> {
  const gender = GENDERS.some((g) => g.value === about?.gender) ? about!.gender! : "";
  return { [NAME]: about?.name ?? "", [GENDER]: gender, [SAVED]: false, [CLOSED]: false };
}

/** The three choices as chips: picked is ink with a tick. */
function genderChips(desk: boolean): Node {
  return row(GENDERS.map((g) => {
    const on: Condition = { eq: [GENDER, g.value] };
    const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
    return labelled(row([
      when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
      text(g.label, { size: 14, weight: 500, lineHeight: 18, style: { color: c(C.paper, C.ink) } }),
    ], {
      gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: "center",
      borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper), flexGrow: desk ? 0 : 1, flexBasis: desk ? "auto" : 0,
    }, setState(GENDER, g.value)), g.label);
  }), { gap: 8 });
}

/** The card, while it is due; nothing otherwise. */
export function aboutCard(ctx: BotsCtx, about: About | undefined): Node[] {
  if (!about?.due) return [];
  const desk = ctx.client === "desktop";
  const apple = about.via === "apple";
  const save: ActionSpec = {
    kind: "condition", if: apple ? { truthy: GENDER } : { all: [{ truthy: NAME }, { truthy: GENDER }] },
    // Signed in with Apple: the name Apple gave goes in as it is (never typed, never asked), or none.
    then: call("PUT", "/v1/profile", apple ? { ...(about.source === "provider" && about.name?.trim() ? { full_name: about.name.trim() } : {}), gender: `$state.${GENDER}` } : { full_name: `$state.${NAME}`, gender: `$state.${GENDER}` }, {
      ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(SAVED, true)),
      fail: toast("Couldn't save that. Try again."),
    }),
    else: toast(apple ? "Pick one to save." : "Add your name and pick one."),
  } as ActionSpec;
  const later = seq(setState(CLOSED, true), call("PUT", ABOUT_PATH, {}, {}));
  // The keyboard's Done only puts the keyboard away: the pick may still be owed.
  const typed = { kind: "haptic", style: "selection" } as ActionSpec;
  const ask = permitStep({
    when: { falsy: SAVED },
    title: "Tell your bots about you",
    lines: [line("So your bots know how to address you.")],
    extra: [
      ...(apple ? [] : [nameField(NAME, "Your name", typed, desk, { capitalize: true, label: "your name", height: 44 })]),
      genderChips(desk),
    ],
    cta: { label: "Save", onPress: save },
    quiet: { label: "Not now", onPress: later },
  });
  const thanks = when({ truthy: SAVED }, row([text("Got it. Thanks!", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
  const sized = (card: Node): Node => col([card], { width: WIDTH[ctx.client === "desktop" ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center" });
  if (canMove(ctx)) {
    return [sized(botCard([ask, thanks], {
      // A shorter stage than the microphone card's, so with the field and the chips the card is about its height.
      ...CARD_BOT, stageHeight: 72, kind: "custom", label: "About you",
      doneWhen: { truthy: SAVED }, doneDelayMs: 1800, onComplete: setState(CLOSED, true), closeWhen: { truthy: CLOSED },
    }))];
  }
  // A build without the living tiles: the same card, plain, gone once saved or put off.
  return [when({ all: [{ falsy: CLOSED }, { falsy: SAVED }] }, sized(col([ask], { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 })))];
}
