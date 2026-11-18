/**
 * THE ABOUT YOU CARD: the person's name and gender, then a name for the assistant, asked on Home from the 3rd visit, never in the
 * first run (App Review 4: nothing comes between sign-in and Home).
 *
 * The same card as the microphone and keyboard one (the bot on a stage, one black pill), the same width, and like it over Home
 * (a BotCard overlay, Home blurred behind it), where a build draws the living card; the phone app lifts it over the keyboard while
 * the name is typed. Due by the server (GET /v1/bots/first-run/about: onboarded, a few visits in, an answer still owed).
 *
 *   the name     filled in from the sign-in (what Google or Apple shared), else the account's own, else a guess from the email;
 *                theirs to change. Signed in with Apple it is never required (App Review 4: what Apple shares is not asked again):
 *                the field is there, filled, only when Apple gave a name, and Save needs only the gender
 *   the gender   Male, Female or Other, so bots write to them right in gendered languages
 *   Save         PUT /v1/profile { full_name, gender } (the profile's own write), and on to the next step. NOTHING IS REQUIRED:
 *                Save works with no name and no gender, and the route writes only what was given (App Review 5.1.1(v): an app may
 *                not require personal information to work; 5.1.1(x): a name request must be optional)
 *   its name     the second step, as the microphone and keyboard card goes on from one ask to the next: X0 is the assistant's
 *                name, and a name of their own for it is optional (filled with the one it has). Save name: PUT /v1/personality
 *                { assistantName }, the write of Keylessbord's "What you call it"; with no name, X0 stays its name and the step
 *                simply finishes
 *   Not now      a quiet way out of EITHER step. It records the skip (PUT /v1/bots/first-run/about { skip: true }) and the card
 *                goes for good: it never blocks Home, and it never comes back. Finishing the card records the same skip, so an
 *                answer left out does not bring it back either. THE CARD CAN NEVER LOCK THE APP.
 */
import type { ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { ASSISTANT_NAME } from "../../../assistantName.js";
import { type BotsCtx, botCard, canMove, call, col, C, icon, labelled, row, seq, text, when } from "../../kit.js";
import { type About, CARD_BOT, GENDERS, line, nameField, permitStep, setState, toast } from "./parts.js";

/** The card's read. */
export const ABOUT_PATH = "/v1/bots/first-run/about";

const NAME = "aboutName", GENDER = "aboutGender", SAVED = "aboutSaved", CLOSED = "aboutClosed", BOT = "aboutBotName", NAMED = "aboutBotDone";
/** The microphone and keyboard card's width (arrivalCard.ts), so the two look like one family. The plain card (no living tiles) is sized to it. */
const WIDTH = { phone: 330, desktop: 360 };

/** What Home starts with while the card is due. */
export function aboutState(about: About | undefined): Record<string, unknown> {
  const gender = GENDERS.some((g) => g.value === about?.gender) ? about!.gender! : "";
  // Their name and gender already saved (the gender, and the name unless Apple signed them in): straight to the assistant's name.
  const saved = !!gender && (about?.source === "saved" || about?.via === "apple");
  return { [NAME]: about?.name ?? "", [GENDER]: gender, [SAVED]: saved, [CLOSED]: false, [BOT]: about?.botName ?? "", [NAMED]: false };
}

/** The three choices as chips: picked is ink with a tick. `path`: where the pick is kept (the Oracle's card keeps its own). */
export function genderChips(desk: boolean, path: string = GENDER): Node {
  return row(GENDERS.map((g) => {
    const on: Condition = { eq: [path, g.value] };
    const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
    return labelled(row([
      when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
      text(g.label, { size: 14, weight: 500, lineHeight: 18, style: { color: c(C.paper, C.ink) } }),
    ], {
      gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: "center",
      borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper), flexGrow: desk ? 0 : 1, flexBasis: desk ? "auto" : 0,
    }, setState(path, g.value)), g.label);
  }), { gap: 8 });
}

/** The card, while it is due; nothing otherwise. */
export function aboutCard(ctx: BotsCtx, about: About | undefined): Node[] {
  if (!about?.due) return [];
  const desk = ctx.client === "desktop";
  const apple = about.via === "apple";
  // Signed in with Apple: the name field only when Apple gave one, and never required (App Review 4).
  const nameShown = !apple || (about.source === "provider" && !!about.name?.trim());
  const saved = { ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(SAVED, true)), fail: toast("Couldn't save that. Try again.") };
  // The skip: the card is answered and never comes back (the server's `due` reads it). Recorded by Not now on either step AND by
  // finishing the card, so an answer left out can never bring it back. A failed write only means it is asked once more.
  const skip = call("PUT", ABOUT_PATH, { skip: true });
  // Not now: the card closes at once, both steps with it (CLOSED is what closes it either way: botCard's closeWhen, and the plain
  // card's own when). Never NAMED, so the bot does not cheer at someone who said no.
  const notNow = seq({ kind: "haptic", style: "selection" } as ActionSpec, setState(CLOSED, true), skip);
  // Save writes whatever they gave. The route keeps a name only when it is not empty and a gender only when it is one of the three
  // (routes/account/profile.ts), so sending both with either empty is exactly "save what there is".
  const save = call("PUT", "/v1/profile", { full_name: `$state.${NAME}`, gender: `$state.${GENDER}` }, saved);
  // The keyboard's Done only puts the keyboard away: there may be nothing to save at all, which is fine.
  const typed = { kind: "haptic", style: "selection" } as ActionSpec;
  const ask = permitStep({
    when: { falsy: SAVED },
    title: "Tell your bots about you",
    lines: [line("So your bots know how to address you. Both are up to you.")],
    extra: [
      ...(nameShown ? [nameField(NAME, "Your name", typed, desk, { capitalize: true, label: "your name", height: 44 })] : []),
      genderChips(desk),
    ],
    cta: { label: "Save", onPress: save },
    quiet: { label: "Not now", onPress: notNow },
  });
  // The second step: a name for the assistant, worded so it can never be read as asking theirs. Optional: X0 stays its name.
  const named = seq({ kind: "haptic", style: "success" } as ActionSpec, setState(NAMED, true));
  const saveName: ActionSpec = {
    kind: "condition", if: { truthy: BOT },
    then: call("PUT", "/v1/personality", { assistantName: `$state.${BOT}` }, { ok: seq(named, skip), fail: toast("A name is letters, spaces, ' and -, up to 24 characters.") }),
    // Nothing typed: nothing to save, and the card is done.
    else: seq(named, skip),
  } as ActionSpec;
  const nameIt = permitStep({
    when: { all: [{ truthy: SAVED }, { falsy: NAMED }] },
    title: `Give ${ASSISTANT_NAME} a name of its own`,
    lines: [line(`${ASSISTANT_NAME} always works. Call it by your own name for it too: “Zara, make it formal.”`)],
    extra: [nameField(BOT, `A name for ${ASSISTANT_NAME}`, typed, desk, { capitalize: true, label: `a name for ${ASSISTANT_NAME}`, height: 44 })],
    cta: { label: "Save name", onPress: saveName },
    quiet: { label: "Not now", onPress: notNow },
  });
  const thanks = when({ truthy: NAMED }, row([text("Got it. Thanks!", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
  const sized = (card: Node): Node => col([card], { width: WIDTH[ctx.client === "desktop" ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center" });
  if (canMove(ctx)) {
    return [botCard([ask, nameIt, thanks], {
      // Over Home like the microphone card. A shorter stage than its, so with the field and the chips the card is about its height.
      ...CARD_BOT, stageHeight: 72, kind: "custom", overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: "About you",
      doneWhen: { truthy: NAMED }, doneDelayMs: 1800, onComplete: setState(CLOSED, true), closeWhen: { truthy: CLOSED },
    })];
  }
  // A build without the living tiles: the same card, plain, its two steps, gone once both are saved.
  return [when({ all: [{ falsy: CLOSED }, { falsy: NAMED }] }, sized(col([ask, nameIt], { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 })))];
}
