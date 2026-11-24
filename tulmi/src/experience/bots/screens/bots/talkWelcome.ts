/**
 * TALK'S WELCOME, AND ITS LINE OF THE DAY: the bot at the top of an empty thread (docs/talk-door.md section 1a).
 *
 * Talk is the screen the app opens on, so the welcome Home used to play lives here now. It is ONE bot in ONE place:
 *
 *   first visit   he waves with his hello ("Hi Aanya, I'm X0"), alone on the screen. He does not walk off: the dashed
 *                 box draws in around him where he stands, he turns to listening, and his words change to what Talk says.
 *                 The head and the bar fade in with it (fadeInWithBox), the things to say come in under the box, and the
 *                 microphone and keyboard card (with its own bot) a beat after.
 *   back          the same, after a long time away or on a newer Talk: "Welcome back, Aanya".
 *   every visit   the box and the bot as they are, with a short line for the hour under him: "Morning, Aanya",
 *   after         "Moonlit chat?". One line a part of the day, the next one tomorrow.
 *
 * The welcome is due when Home's was (GET /v1/bots/first-run/arrival): Talk reads it with Home's own code (homeNotices),
 * so it plays once and closing the card ends it on both. A build that cannot move draws the hello still, in the box.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, RADIUS, blip, canMove, card, col, seq, text, when } from "../../kit.js";
import { firstName } from "../shell/parts.js";
import { dayPart, type DayPart } from "../../../touches.js";
import { ASSISTANT_NAME } from "../../../assistantName.js";

/** What Talk says under the bot once the welcome is over, and on any empty thread after. */
export const TALK_BODY = "Whichever bot it belongs to answers here. Nothing to pick first.";

/** The welcome's two moments, written by the welcome itself: the box is drawn (helloSeen), the card may come (cardDue). */
export const WELCOME_STATE = { helloSeen: false, cardDue: false } as const;
/** The card waits on this one (arrivalCard `after`), so it never lands in the same moment as the box. */
export const WELCOME_CARD_AFTER = "cardDue";
/** How long he waves on his own before the box comes, and how long after that the card waits. */
export const HELLO_MS = 3000;
export const CARD_AFTER_MS = 1400;

/** Whether this build plays the welcome (it moves), or draws it still. */
export const welcomeMoves = (ctx: BotsCtx): boolean => canMove(ctx);

/**
 * THE LINE OF THE DAY. Short, of the hour, and in the person's own time zone. The parts of the day are Home's
 * (touches.ts dayPart: night is the small hours only). One line a part of the day, the next one the next day.
 */
const DAY_LINES: Record<DayPart, ReadonlyArray<(name: string) => string>> = {
  morning: [(n) => (n ? `Morning, ${n}` : "Morning"), () => "Coffee and a plan?", () => "Fresh start?"],
  afternoon: [(n) => (n ? `Afternoon, ${n}` : "Afternoon"), () => "Midday ask?", () => "Busy hands? Just talk"],
  evening: [(n) => (n ? `Evening, ${n}` : "Evening"), () => "Wrapping up the day?", () => "Golden-hour chat?"],
  night: [() => "Moonlit chat?", (n) => (n ? `Up late, ${n}?` : "Up late?"), () => "Night owl mode"],
};

export function dayLine(ctx: Pick<BotsCtx, "tzOffsetMinutes" | "live" | "user">): string {
  const part = dayPart(ctx.tzOffsetMinutes, ctx.live.now);
  const day = Math.floor((ctx.live.now + ctx.tzOffsetMinutes * 60_000) / 86_400_000);
  const lines = DAY_LINES[part];
  return lines[((day % lines.length) + lines.length) % lines.length]!(firstName(ctx as BotsCtx));
}

/** The hello, by their name: the first visit, or (`back`) a visit after a long time away. */
export function helloWords(ctx: BotsCtx, back: boolean): { hi: string; line: string } {
  const name = firstName(ctx);
  return back
    ? { hi: name ? `Welcome back, ${name}` : "Welcome back", line: `${ASSISTANT_NAME} and your bots missed you.` }
    : { hi: name ? `Hi ${name}, I'm ${ASSISTANT_NAME}` : `Hi, I'm ${ASSISTANT_NAME}`, line: "Every bot here is me, ready for one job." };
}

const title = (s: string): Node => text(s, { size: 20, weight: 700, tracking: -0.3, lineHeight: 25, align: "center" });
const body = (s: string): Node => text(s, { size: 13, color: C.meta, align: "center", lineHeight: 18 });

/** The bot in his box with a line under him: every visit after the first (the line of the day), and the still welcome. */
export function talkFrame(ctx: BotsCtx, words: { title?: string; body?: string } = {}): Node {
  return card([blip("listen", 120), title(words.title ?? dayLine(ctx)), body(words.body ?? TALK_BODY)], {
    dashed: true, gap: 10, padding: 24, style: { alignItems: "center", alignSelf: "stretch" },
  });
}

/**
 * THE WELCOME. He waves with his hello, alone, for HELLO_MS. Then, without moving, the box draws in around him (it settles
 * from a little larger), he turns to listening, and the hello gives way to what Talk says. The welcome writes its own
 * two moments, in one chain on one Store (as Home's does, so a fresh copy of the screen cannot strand it halfway).
 *
 * The box is drawn behind him (absolute, first child) so nothing about him moves when it comes; the frame keeps its
 * padding from the start for the same reason. A build that cannot move gets the hello still, in the box.
 */
export function welcomeFrame(ctx: BotsCtx, back: boolean): Node {
  const { hi, line } = helloWords(ctx, back);
  if (!welcomeMoves(ctx)) return talkFrame(ctx, { title: hi, body: `${line} ${TALK_BODY}` });
  const border: Record<string, unknown> = {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: RADIUS.card,
    borderWidth: 1.5, borderStyle: "dashed", borderColor: C.dashed, backgroundColor: C.paper,
  };
  const seen = { truthy: "helloSeen" }, waving = { falsy: "helloSeen" };
  return {
    type: "Stack",
    style: { position: "relative", padding: 24, gap: 10, alignItems: "center", alignSelf: "stretch", marginTop: 60 },
    on: {
      onAppear: seq(
        { kind: "delay", ms: HELLO_MS }, { kind: "setState", path: "helloSeen", value: true },
        { kind: "delay", ms: CARD_AFTER_MS }, { kind: "setState", path: WELCOME_CARD_AFTER, value: true },
      ),
    },
    children: [
      { type: "Rise", visibleIf: seen, props: { fromY: 0, scaleFrom: 1.07 }, style: border, children: [] },
      when(waving, blip("hello", 120)),
      when(seen, blip("listen", 120)),
      when(waving, col([
        text(hi, { size: 24, weight: 700, tracking: -0.5, lineHeight: 30, align: "center" }),
        text(line, { size: 14, color: C.grey70, align: "center", lineHeight: 20 }),
      ], { gap: 6, alignItems: "center" })),
      { type: "Rise", visibleIf: seen, props: { delayMs: 120, fromY: 10, scaleFrom: 1 }, children: [col([title("Say what you need"), body(TALK_BODY)], { gap: 10, alignItems: "center" })] },
    ],
  };
}

/** What comes in under the box once it is drawn: each a beat after the one before. */
export function afterWelcome(nodes: Node[]): Node[] {
  return nodes.map((x, i) => ({ type: "Rise", visibleIf: { truthy: "helloSeen" }, props: { delayMs: 350 + i * 90, fromY: 24, scaleFrom: 0.98 }, children: [x] }));
}

/**
 * What is on Talk besides the bot, during his hello: the head and the bar. Nothing else is there while he waves; they
 * fade in as the box draws, keeping their room the whole time (a Rise that waits, not one that mounts late), so the bot
 * never moves when they come.
 */
export function fadeInWithBox(x: Node): Node {
  return { type: "Rise", props: { delayMs: HELLO_MS, fromY: 0, scaleFrom: 1 }, children: [x] };
}
