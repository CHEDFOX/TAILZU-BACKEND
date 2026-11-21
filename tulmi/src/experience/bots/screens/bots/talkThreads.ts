/**
 * TALK'S CONVERSATIONS: carry one on, or start a fresh one (docs/talk-door.md).
 *
 * Talk is one conversation at a time. That is the whole point of it — a thread you add to, not a list you file things
 * in — but it left no way to put one down and pick it up later, and no way to see what had already been talked about.
 * "/new" existed and nothing said so, which is a feature nobody has.
 *
 * So this is the door to the rest of them: every Talk conversation, newest first, each openable where it stopped.
 *
 *   NOTHING NEW IS DRAWN. The rows are botSessions.ts — the same rows a bot's page uses, with the same picture, the
 *   same "today / yesterday / Tue", and the same round "+". Sessions were built for this (botsBots/sessions.ts) and
 *   already served at /v1/botsapp/sessions/:slug; what was missing was only ever the way in.
 *
 *   CARRYING ONE ON DOES NOT PUSH A SCREEN. Talk is a TAB ROOT and a tab root is reached by switching to it, which
 *   carries no params (ids.ts). So a row makes its session the one last touched (POST session/:id/here) and switches
 *   to Talk, which reads whatever is current — the same rule that decides where new words land (sessions.ts current).
 */
import type { ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, page, col, row, meta, C, call, toTab, title as pageTitle, emptyState, appMark,
} from "../../kit.js";
import { A, refresh } from "./parts.js";
import { botSessions, newSessionKey, SESSION_STATE, type BotSession } from "./botSessions.js";

/** The slug Talk's own thread is kept under (routes/bots/botsTalk.ts TALK_SLUG). */
export const TALK_SLUG = "talk";

/** Talk's conversations, newest first (routes/bots/botsBots.ts GET AREA/sessions/:slug; AREA is parts.ts `A`). */
export const TALK_THREADS_PATH = `${A}/sessions/${TALK_SLUG}`;

/** What the screen reads (GET /v1/botsapp/sessions/talk). */
export interface TalkThreadsData {
  sessions?: BotSession[];
  down?: boolean;
}

/** Where Talk's rows lead: this one becomes the current conversation, then Talk is where you land. */
function carryOn(id: string): ActionRef {
  return call("POST", `${A}/session/${encodeURIComponent(id)}/here`, {}, {
    ok: toTab("talk"),
    // It could not be made current: Talk still opens, on whatever is current now. Never a dead row.
    fail: toTab("talk"),
  });
}

/**
 * Talk wears its own three balloons rather than a bot's face: the conversation is with the app, and whichever bot
 * answered a turn is said in the thread itself. The same glyph the Talk tab wears (glyphs.ts).
 */
const TALK_FACE = { color: C.ink, icon: "balloons" as const };

export function talkThreadsPage(ctx: BotsCtx, d: TalkThreadsData | undefined): ReturnType<typeof page> {
  const data = d ?? { down: true };
  const list = data.sessions ?? [];
  return page(ctx, {
    back: true, title: "Conversations", nav: "talk", ...(ctx.client === "desktop" ? { maxWidth: 760 } : {}),
    state: { ...SESSION_STATE },
    body: [
      row([
        appMark(ctx, ctx.client === "desktop" ? 34 : 30, []),
        col([
          pageTitle("Conversations"),
          meta("Pick one up where it stopped, or start a fresh one.", { size: 13, lineHeight: 18 }),
        ], { gap: 6, flexShrink: 1 }),
      ], { gap: 12, alignItems: "flex-start" }),
      ...(data.down
        ? [emptyState({ pose: "think", title: "Couldn't open your conversations", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : []),
      ...botSessions(ctx, TALK_FACE, list, { label: "In Talk", onPick: carryOn }),
      ...(!list.length && !data.down
        ? [emptyState({ pose: "hello", title: "Only this one so far", body: "Everything you say in Talk is one conversation until you start another." })]
        : []),
    ],
    // The same gesture as Activities' and a bot's page: begin something.
    footer: [newSessionKey(ctx, TALK_SLUG)],
    gap: 20,
  });
}
