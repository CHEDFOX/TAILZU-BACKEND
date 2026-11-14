/**
 * THE BOT AT THE FOOT OF HOME, AS WHAT IS HAPPENING (docs/home-updates.md; behind HOME_UPDATES, off).
 *
 *   homeUpdatesOn(userId)     whether this person gets it (the switch and its stage)
 *   homeUpdatesBot(ctx, d)    him, walking, with the updates in his thought
 *
 * His thought used to be a box to type in. Here it is what is going on, and his ear:
 *
 *   at rest      one line of the most pressing thing — "2 need you", "Xode is building the cart fix", "Nothing new" — not "Talk freely"
 *   open         what needs them, with the same two buttons the decision card has; what their bots are working on, with its stage;
 *                what just finished. Every row opens where it belongs (the job, the approval, the bot's page, the chat)
 *   his ear      a mic that listens turn after turn (canVoice); while he listens the words he hears stand above the list, and a tap
 *                on him stops. With HOME_LISTEN he starts the moment Home is in front, without being asked
 *   typing       a small key, out of the way: it opens the field for the times they cannot speak. Not the first thing they see
 *
 * WHAT HE SAYS BACK. A voice ask goes out as `mode: "voice"`, so the front door shapes it for the ear (front/decide.ts `spoken`,
 * handlers.ts "Spoken: yes."): a short answer, no table, no page. He says a filler while it is out ("mm, let me see…") and then
 * speaks the answer. A typed ask stays silent and is read, as it always was.
 *
 * THE ROUTING IS THE FRONT DOOR'S, UNCHANGED (docs/front-door.md, docs/bots.md section 7): the words are read for nothing, the
 * right bot is picked by its purpose and skills (the tiny tier only when the rules are unsure), and a message that is nobody's
 * goes down the front door's own roads — a reply, the web, research, a plan, an artifact, a code answer. Nothing here routes.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { getConfig } from "../../../../config.js";
import type { FeedRow } from "../../../../shell/feed.js";
import {
  ASK_PATH, C, FACE, SCREENS, answerParams, botStage, box, canVoice, col, grow, icon, keptOffline, labelled, liveWords, meta, needsCard,
  open, roamFor, roundButton, row, sectionLabel, seq, statusMark, text, voiceLive, voiceStop, when, canScroll, scrollBox, type BotsCtx,
} from "../../kit.js";
import type { Node as SduiNode } from "../../../../../../shared/types/sdui.js";
import { failed as momentFailed, SENT_WORDS, start as momentStart, streamed as momentStreamed } from "../../askMoment.js";
import { avatarOf, markOf, nameOf, stageBars } from "./parts.js";

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const clear = (path: string): ActionSpec => ({ kind: "clearState", path });

/** What Home starts with: closed, any bot, not listening, not typing. */
export const HOME_UPDATES_STATE = { askOpen: false, askBot: "any", voice: "", typing: false, spoke: false };

/**
 * How many of each kind his thought holds: enough to be the news, never a second Activity screen. A build whose boxes scroll gets
 * the longer list, because it can reach the end of it; one whose boxes do not gets the short list, so his ear and the key below it
 * are never pushed out of the box.
 */
const SHOW = { needs: 2, working: 3, done: 4 };
const SHORT = { needs: 1, working: 2, done: 2 };
/** The tallest the list may be before it scrolls inside his thought. */
const LIST_H = { phone: 300, desktop: 360 } as const;
/** What counts as "just finished": nothing older than this is news. */
const FRESH_MS = 36 * 3_600_000;

// ===================================================================== the switch

/** Whether this person gets the updates bot. HOME_UPDATES_USERS, while it names anyone, is the stage before everyone. */
export function homeUpdatesOn(userId?: string): boolean {
  try {
    const cfg = getConfig();
    if (cfg.HOME_UPDATES !== true) return false;
    const only = String(cfg.HOME_UPDATES_USERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return !only.length || (!!userId && only.includes(userId));
  } catch {
    return false;
  }
}

/** Whether he listens as soon as Home is in front (HOME_LISTEN): an open microphone for as long as the page is up. */
export function homeListenOn(): boolean {
  try {
    return getConfig().HOME_LISTEN === true;
  } catch {
    return false;
  }
}

// ===================================================================== what he says

/**
 * The ask. `voice`: it was spoken, so the front door is told to shape the answer for the ear and he says it out loud when it lands.
 * Everything else is exactly the ask bar's own road (ASK_PATH), so who answers is decided in one place.
 */
export function updatesSend(ctx: BotsCtx, o: { voice: boolean } = { voice: false }): ActionSpec {
  const say: ActionSpec[] = o.voice
    ? [{ kind: "speak", text: "$state.asked.shell.text" } as ActionSpec, setState("spoke", true)]
    : [];
  return {
    kind: "condition", if: { falsy: "ask" }, then: { kind: "toast", message: "Say what you need, or tap the key to type" },
    else: keptOffline(ctx.client, { message: "$state.ask", clear: "ask" }, {
      kind: "sequence", actions: [
        ...momentStart({ message: "$state.ask", from: "ask", busy: "asking" }),
        clear("asked"),
        setState("spoke", false),
        // A word while he thinks, so a spoken ask is never answered by silence. Said once, before the road is taken.
        ...(o.voice ? [{ kind: "speak", text: "Mm, let me see." } as ActionSpec] : []),
        momentStreamed(ctx, {
          kind: "callEndpoint", method: "POST", path: ASK_PATH,
          body: { message: SENT_WORDS, device: ctx.client, mode: o.voice ? "voice" : "text", bot: "$state.askBot", tz: ctx.tzOffsetMinutes },
          assignTo: "asked", stay: true,
          onSuccess: seq(setState("asking", false), ...say),
          onError: momentFailed({ busy: "asking", from: "ask", then: { kind: "toast", message: "Couldn't reach your bots. Try again.", tone: "error" } }),
        }),
      ],
    }),
  };
}

/** His ear: each turn's words go as a spoken ask when he hears a pause, turn after turn until he is stopped or it falls quiet. */
export function updatesVoice(ctx: BotsCtx): Extract<ActionSpec, { kind: "voiceLive" }> {
  return voiceLive({
    mode: "chat", statePath: "voice", into: "ask", silenceMs: 900, onHeard: updatesSend(ctx, { voice: true }),
    onEnd: setState("askBot", "any"),
    onBlocked: { kind: "toast", message: "Turn on the microphone for X0 Bot in Settings.", tone: "error" },
  }) as Extract<ActionSpec, { kind: "voiceLive" }>;
}

// ===================================================================== the updates

export interface Update {
  id: string;
  bot: string;
  title: string;
  sub?: string;
  mark: FeedRow["mark"];
  at: number;
  stage?: { at: number; of: number; name: string };
  open?: ActionRef;
}

/** Where a finished thing opens: a job, an approval, an answer, else the bot's own page. */
function rowOpen(row: FeedRow): ActionRef | undefined {
  const [kind, id] = row.id.split(":");
  if (kind === "job" && id) return open(SCREENS.codeJob, { id });
  if (kind === "task" && id) return open(SCREENS.approve, { task: id });
  if (kind === "ask") return open(SCREENS.activity);
  if (row.bot && row.bot !== "tailzu") return open(SCREENS.chat, { slug: row.bot });
  return open(SCREENS.activity);
}

/**
 * What his thought holds, in the order it matters: what needs them, what is being worked on, what just finished. The first two come
 * from the live reads every screen already has, so they cost nothing; the finished ones come from the feed when Home read it.
 */
export function updatesOf(ctx: BotsCtx, rows: readonly FeedRow[] = []): { needs: typeof ctx.live.needs; working: Update[]; done: Update[] } {
  const cap = canScroll(ctx) ? SHOW : SHORT;
  const working: Update[] = ctx.live.working.slice(0, cap.working).map((w) => {
    const feed = rows.find((r) => r.id === w.id);
    return {
      id: w.id, bot: w.bot, title: w.title, mark: "working" as const, at: w.at,
      ...(feed?.sub ? { sub: feed.sub } : {}), ...(feed?.stage ? { stage: feed.stage } : {}),
      ...(feed ? { open: rowOpen(feed) } : {}),
    };
  });
  const done: Update[] = rows
    .filter((r) => r.mark !== "working" && r.mark !== "needs" && ctx.live.now - r.at < FRESH_MS)
    .slice(0, cap.done)
    .map((r) => ({ id: r.id, bot: r.bot, title: r.title, mark: r.mark, at: r.at, ...(r.sub ? { sub: r.sub } : {}), open: rowOpen(r) }));
  return { needs: ctx.live.needs.slice(0, cap.needs), working, done };
}

/** The one line he wears at rest: the most pressing thing, in his own short words. */
export function restLine(ctx: BotsCtx, u: ReturnType<typeof updatesOf>): string {
  if (u.needs.length) return u.needs.length === 1 ? `${u.needs[0]!.botName} needs you` : `${u.needs.length} need you`;
  if (u.working.length) {
    const w = u.working[0]!;
    return u.working.length === 1 ? `${nameOf(ctx, w.bot)} is on it` : `${u.working.length} bots are working`;
  }
  if (u.done.length) return u.done.length === 1 ? u.done[0]!.title : `${u.done.length} things done`;
  return "Nothing new";
}

/** One row of the list: the bot's mark and name, what it is, its stage if it is running, and it opens. */
function updateRow(ctx: BotsCtx, u: Update): Node {
  const body = col([
    row([markOf(ctx, u.mark, u.bot), meta(nameOf(ctx, u.bot), { size: 12 })], { gap: 7 }),
    text(u.title, { size: 15, lineHeight: 20, lines: 2 }),
    ...(u.sub ? [meta(u.sub, { size: 12, lines: 1 })] : []),
    ...(u.stage ? [stageBars(u.stage.at, u.stage.of, C.ink, { grow: true })] : []),
  ], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  return row([avatarOf(ctx, u.bot, 26), body, ...(u.open ? [icon("chevron", { size: 16, color: C.meta })] : [])], {
    gap: 10, alignItems: "flex-start", paddingVertical: 10,
  }, u.open);
}

// ===================================================================== him

/** Home's foot: him, walking, with what is happening in his thought and his ear open to a question. */
export function homeUpdatesBot(ctx: BotsCtx, rows: readonly FeedRow[] = []): Node {
  const desk = ctx.client === "desktop";
  const voice = canVoice(ctx);
  const u = updatesOf(ctx, rows);
  const listening = { truthy: "voice" } satisfies Condition;
  const typing = { truthy: "typing" } satisfies Condition;
  const asking = { truthy: "asking" } satisfies Condition;
  const sent = { truthy: "sent" } satisfies Condition;
  const answered = { truthy: "asked.shell.text" } satisfies Condition;
  const quiet = { all: [{ falsy: "sent" }, { falsy: "voice" }, { falsy: "asking" }] } satisfies Condition;

  const reset = seq(clear("sent"), clear("reply"), clear("asked"), setState("askBot", "any"), setState("typing", false));
  const close = seq(setState("askOpen", false), ...(voice ? [voiceStop()] : []), reset);

  // What he was asked, and what came back.
  const bubble = row([box([text("", { size: 15, lineHeight: 21, color: C.paper, bind: "sent", lines: 4 })], {
    backgroundColor: C.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 15, maxWidth: "86%",
  })], { justifyContent: "flex-end" });
  const answer = col([
    when({ truthy: "asked.shell.bot.name" }, row([text("", { size: 13, weight: 600, lineHeight: 17, bind: "asked.shell.bot.name" }), meta(" answered", { size: 13 })])),
    text("", { size: 16, lineHeight: 23, bind: "reply.text" }),
    when({ falsy: "reply.text" }, text("", { size: 16, lineHeight: 23, bind: "asked.shell.text" })),
    row([labelled(row([text("Open", { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 14 })], { gap: 4, minHeight: 32 },
      { kind: "navigate", screenId: SCREENS.ask, params: answerParams(SENT_WORDS) }), "Open the whole answer")]),
  ], { gap: 6 });

  // The list: what needs them (with its own two buttons), what is working, what just finished.
  const list: Node[] = [];
  if (u.needs.length) list.push(col(u.needs.map((n) => needsCard(n, { layout: desk ? "row" : "column" })), { gap: 10 }));
  if (u.working.length) list.push(col([sectionLabel("Working"), ...u.working.map((w) => updateRow(ctx, w))], { gap: 2 }));
  if (u.done.length) list.push(col([sectionLabel("Done"), ...u.done.map((d) => updateRow(ctx, d))], { gap: 2 }));
  if (!list.length) {
    list.push(col([
      text("Nothing new", { size: 16, lineHeight: 22 }),
      meta(voice ? "Ask me anything — tap the mic, or the key to type." : "Ask me anything — tap the key to type.", { size: 13 }),
    ], { gap: 4, paddingVertical: 6 }));
  }
  const all = labelled(row([meta("See everything", { size: 13 }), icon("chevron", { size: 14, color: C.meta })], { gap: 4, minHeight: 32 }, open(SCREENS.activity)), "See everything in Activity");

  // The field, only once they ask for it: typing is there, out of the way.
  const field: Node = {
    type: "TextField", id: "homeAsk", bind: { value: "ask" },
    props: {
      placeholder: "Type what you need", placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0,
      paddingHorizontal: 0, paddingVertical: 0, minHeight: 44, returnKeyType: "send", color: C.ink, autoFocus: true, maxLength: 4000,
    },
    on: { onSubmit: updatesSend(ctx) },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 17, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };

  const keyboardKey = labelled(box([icon("keyboard", { size: 18, color: C.meta })], {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0,
  }, setState("typing", true)), "Type instead");

  const foot = row([
    when(typing, box([field], { flexGrow: 1, flexShrink: 1, minWidth: 0 })),
    when({ falsy: "typing" }, box([meta(voice ? "Talk to me" : "Ask me", { size: 13 })], { flexGrow: 1, flexShrink: 1, minWidth: 0 })),
    when({ falsy: "typing" }, keyboardKey),
    when(typing, roundButton("send", updatesSend(ctx), { size: 40, label: "Send" })),
    ...(voice ? [when({ falsy: "typing" }, roundButton("mic", { kind: "condition", if: listening, then: voiceStop(), else: updatesVoice(ctx) }, { size: 44, label: "Talk to me" }))] : []),
  ], { gap: 10, alignItems: "center" });

  const children: Node[] = [
    row([sectionLabel("What's happening"), grow(), labelled(box([icon("close", { size: 16 })], {
      width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center",
    }, close), "Close")], { gap: 8 }),
    // While he listens, the words he hears stand where the list is; the list comes back when he stops.
    ...(voice ? [when(listening, col([
      row([statusMark("working", { color: C.ink }), meta("Listening", { size: 13 })], { gap: 8 }),
      liveWords({ size: 17, lineHeight: 24 }),
    ], { gap: 8 }))] : []),
    when(sent, bubble),
    when({ all: [asking, { falsy: "reply.text" }] }, row([statusMark("working", { color: C.ink }), meta("Thinking", { size: 13 })], { gap: 8 })),
    when({ any: [{ truthy: "reply.text" }, answered] }, answer),
    // The list scrolls inside his thought where the build can, so his ear and the key under it are always in reach.
    when(quiet, canScroll(ctx)
      ? scrollBox([col([...list, all], { gap: 12 })], { maxHeight: LIST_H[ctx.client], flexShrink: 1 })
      : col([...list, all], { gap: 12 })),
    // His ear and the key sit at the foot of the box, where a thumb is, with whatever room is left above them.
    grow(),
    foot,
  ];

  const tapHim: ActionRef = voice
    ? { kind: "condition", if: listening, then: voiceStop(), else: setState("askOpen", true) }
    : setState("askOpen", true);

  const stage = botStage({
    life: "home.ask", kind: "custom", color: C.ink, size: desk ? 30 : 26, height: desk ? 140 : 136, toys: false, roam: roamFor(ctx),
    thinkWhen: { all: [asking, { falsy: "reply.text" }] }, cheerWhen: answered,
    ...(voice ? { listenWhen: listening } : {}),
    thought: { style: "home", restText: restLine(ctx, u), openPath: "askOpen", fullWhen: { any: [sent, { truthy: "askOpen" }] }, shape: "square", veil: true, place: "follow" },
    label: voice ? `What's happening. ${desk ? "Double-click" : "Double-tap"} me to talk.` : "What's happening.",
  }, [col(children, { padding: 18, gap: 14, flexGrow: 1 })], {
    onPress: tapHim,
    ...(voice ? { onDoubleTap: seq(setState("askBot", "any"), setState("askOpen", true), updatesVoice(ctx)) } : {}),
    onDismiss: reset,
  });
  // HOME_LISTEN: his ear opens the moment Home is in front, without being asked. It is its own switch because it is an open
  // microphone for as long as the page is up; a tap on him stops it, and it falls quiet by itself after a while with nothing said.
  if (!voice || !homeListenOn()) return stage;
  return { ...stage, on: { ...(stage.on ?? {}), onAppear: updatesVoice(ctx) } } satisfies SduiNode;
}
