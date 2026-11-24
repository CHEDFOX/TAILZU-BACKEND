/**
 * Bots app · TALK: the one screen, and its one thread (docs/talk-door.md; the screen is experience/bots/screens/bots/talkDoor.ts).
 *
 *   GET    /v1/botsapp/talk?limit=     -> { turns, session, bots, people, commands }   the thread oldest first, and what "/" and "@" offer
 *   POST   /v1/botsapp/talk { message, bot?, to?, session?, streamId?, attachments?, tz?, clientId?, typedAt? }
 *                                      -> { turns, shell }                            one message, done, and kept on the thread
 *   POST   /v1/botsapp/talk/new        -> { session }                                 a fresh thread ("/new"); nothing is deleted
 *   DELETE /v1/botsapp/talk            -> { ok, cleared }                             start it over (the person's own to do)
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. It is NOT another brain. Every message goes through the door that already exists
 * (`POST /v1/shell/ask` -> `POST /v1/ask`: the front door's rules, its picking of a bot, its guards, its budgets, its
 * routine drafts and its Activity row, docs/front-door.md). What this file adds is the two things a chat needs that the
 * door never had:
 *
 *   1. ONE THREAD. The door answered and the app then opened a page with the answer on it. Here both turns are kept
 *      (botsBots/chat.ts keepDoor) under one slug, whoever answered, with `by` saying which bot did and `did` what it
 *      left to do. So the thread reads as one conversation and the next message has a subject.
 *   2. THE TWO MARKS. "/" names a bot, "@" names a person (botsBots/talkWords.ts). Both are read for nothing, and
 *      neither is taken on the client's word: a "/slug" has to be one of this person's own bots, and an "@" is an id
 *      that must be someone they still share a space with — the NAME is then read off that list here, never sent in.
 *
 * So nothing about how a message is answered lives here, and turning this off leaves every other way in exactly as it was.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError, type Bots } from "../../bots/index.js";
import type { BotChat, TurnBy, TurnDid, TurnFile } from "../../botsBots/chat.js";
import { filesOf, TURN_FILES_MAX } from "../../botsBots/chat.js";
import { isPictureAsk } from "../../botsBots/pictureAsk.js";
import type { Sessions } from "../../botsBots/sessions.js";
import { readTalk, slashBots, talkName, TALK_COMMANDS } from "../../botsBots/talkWords.js";
import { spacesOn } from "../../botsBots/spacesSwitch.js";
import type { Threads } from "../../botsBots/threads.js";
import { botLook } from "../../experience/bots/palette.js";
import type { BotsAreaDeps } from "./botsArea.js";

/**
 * THE SLUG TALK'S THREAD IS KEPT UNDER: the built-in generalist's (bots/builtin.ts "talk"). Every turn of Talk goes in
 * here whoever answered, which is the whole point — one conversation, not one per bot. The specialist bots keep their own
 * threads for their own pages, untouched.
 */
export const TALK_SLUG = "talk";

/** The most turns one read of the thread hands back (the chat's own limit; botsBots/chat.ts CHAT_KEEP caps it again). */
const TURNS = 40;
const MESSAGE_MAX = 2000;

export interface TalkRoutesParts {
  chat: BotChat | null;
  sessions: Sessions;
  /** Who the person shares a space with: the "@" list, and the one check on an "@" that came in (botsBots/threads.ts). */
  threads: Threads;
  /**
   * THE PICTURE ENGINE, when there is one (the cinema bot's, cinema/service.ts picture: read the ask, pick the model, make
   * it, check it, charge it, keep it). Asked for at each message, because the server builds it after this route. Null, or
   * absent: no pictures here, and an ask for one goes through the door like any other.
   */
  pictures?: () => TalkPictures | null;
}

/** What Talk needs of the picture engine: one picture from the words, with the person's attached photos as references. */
export interface TalkPictures {
  make(userId: string, o: { words: string; photoIds: string[] }): Promise<{ id: string; type: string; note: string | null }>;
}

/** Who answers with a picture: the cinema bot, as itself. */
const PICTURE_BY: TurnBy = { slug: "cinema", name: "Cinema", color: botLook("cinema").color };

/** A person as the "@" list draws it: their own tiny bot, never initials (docs/spaces.md personLook.ts). */
interface TalkPersonOut { id: string; name: string; bot?: unknown }

export function registerTalkRoutes(app: FastifyInstance, deps: BotsAreaDeps, parts: TalkRoutesParts): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "talk: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };

  /** Signed in, and the bots platform on: Talk is the bots' one door, so with BOTS off there is nothing for it to open. */
  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; bots: Bots; chat: BotChat } | null> => {
    if (!deps.bots || !parts.chat) { reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { user, bots: deps.bots, chat: parts.chat };
  };

  /**
   * The person's own bots, as the "/" rule reads them: Talk itself and Xode left out (talkWords.ts slashBots). This is the
   * CHECK on a "/slug" and on a picked chip, not the list the screen draws — the screen already holds the person's bots
   * with their looks (experience/bots/live.ts), so nothing here repeats them.
   */
  const slashList = async (bots: Bots, userId: string): Promise<Array<{ slug: string; name: string }>> =>
    slashBots(await bots.list(userId).catch(() => [])).map((b) => ({ slug: b.slug, name: b.name }));

  /**
   * Who "@" offers, and the one place a person's name is decided. With Spaces off nobody is connected to anybody, so the
   * list is empty and "@" offers nothing — exactly as every other screen behaves while it is off (docs/spaces.md).
   */
  const peopleList = async (userId: string): Promise<TalkPersonOut[]> => {
    if (!spacesOn()) return [];
    const c = await parts.threads.contacts(userId).catch(() => ({ people: [] as Array<{ userId: string; name: string; bot: unknown }> }));
    return c.people.map((p) => ({ id: p.userId, name: p.name, ...(p.bot ? { bot: p.bot } : {}) }));
  };

  app.get("/v1/botsapp/talk", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      const q = req.query as { limit?: unknown; session?: unknown } | undefined;
      const want = Number(q?.limit ?? TURNS);
      const limit = Number.isFinite(want) ? Math.max(1, Math.min(Math.round(want), TURNS)) : TURNS;
      // TALK IS ONE CONVERSATION AT A TIME, not everything ever said.
      //
      // This read was chat.recent, which selects on { user_id, bot } and knows nothing about sessions — so every turn
      // came back whatever conversation it belonged to, and "/new" only LOOKED fresh: its own answer carries no turns,
      // and the next read put all of them back. A new thread you cannot see is not a new thread.
      //
      // So the turns are the session's (chat.ofSession): the one asked for, else the one last touched. With no session
      // at all — nobody has said anything here yet — it falls back to the thread, which is then empty anyway.
      const asked = typeof q?.session === "string" && q.session ? q.session : "";
      const [open, people] = await Promise.all([
        asked ? Promise.resolve(null) : parts.sessions.list(s.user.id, TALK_SLUG, 1).then((l) => l[0] ?? null).catch(() => null),
        peopleList(s.user.id),
      ]);
      // An id that is not this person's simply has no turns: ofSession matches on user_id as well, so nothing of
      // anyone else's can be read by naming it.
      const id = asked || open?.id || "";
      const turns = id ? await s.chat.ofSession(s.user.id, id, limit) : await s.chat.recent(s.user.id, TALK_SLUG, limit);
      return reply.send({ turns, session: id || null, people, commands: TALK_COMMANDS });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/botsapp/talk/new", tight(30), async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try {
      // A fresh conversation; nothing is deleted, and the thread's older sessions stay where they are (sessions.ts).
      const made = await parts.sessions.open(s.user.id, TALK_SLUG);
      return reply.send({ session: made.id });
    } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/botsapp/talk", RL, async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    try { return reply.send({ ok: true, cleared: await s.chat.clear(s.user.id, TALK_SLUG) }); } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/botsapp/talk", tight(60), async (req, reply) => {
    const s = await who(req, reply);
    if (!s) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const session = typeof b.session === "string" && b.session ? b.session : null;
    // A DRAWING ANSWERED instead of typed (a choice of several, a form: docs/show.md section 3). The picks become the
    // person's words here and then go through the door like anything typed — so what they picked is routed on its own
    // merits, and not handed back to whichever bot happened to draw the choice.
    let said = typeof b.message === "string" ? b.message.trim() : "";
    if (b.picks && typeof b.picks === "object") {
      try { said = await s.chat.wordsOfPicks(s.user.id, TALK_SLUG, b.picks as Parameters<BotChat["wordsOfPicks"]>[2]); } catch (err) { return fail(req, reply, err); }
    }
    // A PHOTO ON ITS OWN IS A MESSAGE. What was sent with the words (the upload's refs); a list the app thinned by taking one
    // off can hold gaps, so only the refs themselves go on.
    const sent = Array.isArray(b.attachments) ? (b.attachments as unknown[]).filter((x) => !!x && typeof x === "object").slice(0, TURN_FILES_MAX) : [];
    const files = filesOf(sent);
    if (!said && !files.length) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });
    if (said.length > MESSAGE_MAX) return reply.code(413).send({ code: "too_large", message: `A message may be ${MESSAGE_MAX} characters at most.` });

    try {
      // "/" is read against the person's OWN bots, so a slug that is not theirs is left in the words as typed.
      const mine = await slashList(s.bots, s.user.id);
      // "@" is an id, and it has to be someone they still share a space with: the name is read off that list, not the body.
      const to = typeof b.to === "string" && b.to ? b.to : "";
      const person = to ? (await peopleList(s.user.id)).find((p) => p.id === to) : undefined;
      const read = readTalk(said, { bots: mine, bot: b.bot, to: person?.name });

      // "/new": a fresh thread, and nothing is asked. The person said it, so it is answered here and not by a model.
      if (read.command === "new") {
        const made = await parts.sessions.open(s.user.id, TALK_SLUG);
        return reply.send({ turns: [], session: made.id, started: true });
      }
      // With no words of their own (or only "/plan"), the bot is told what came, so the file is the question.
      const message = read.message || (files.length ? filesLine(files) : "");
      if (!message) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });

      // A PICTURE, ASKED FOR: made by the picture engine and kept as the cinema bot's answer, with the picture on its turn.
      // Read off the words alone (botsBots/pictureAsk.ts, no model), and narrowly, because a picture costs money.
      const engine = parts.pictures?.() ?? null;
      const photoIds = files.filter((f) => f.mime.startsWith("image/")).map((f) => f.id);
      if (engine && isPictureAsk(read.message || said, { photos: photoIds.length })) {
        let text: string, images: Array<{ id: string; type: string }> = [];
        try {
          const made = await engine.make(s.user.id, { words: read.message || said, photoIds });
          images = [{ id: made.id, type: made.type }];
          text = made.note ? `Here it is. ${made.note}` : "Here it is.";
        } catch (err) {
          // Its own refusals are written for a person (no AI permission yet, today's pictures used up): said as the answer,
          // so the thread says why there is no picture. Anything else is a failure like any other.
          const e = err as { status?: number; message?: string } | null;
          if (!e || typeof e.status !== "number" || e.status >= 500 || !e.message) return fail(req, reply, err);
          text = e.message;
        }
        const turns = await s.chat.keepDoor(s.user.id, TALK_SLUG, {
          said, text, by: PICTURE_BY, images,
          ...(read.forName ? { forName: read.forName } : {}),
          ...(session ? { session } : {}),
          ...(files.length ? { files } : {}),
        });
        return reply.send({ turns, shell: { bot: PICTURE_BY, text }, ...(turns[0]?.session ? { session: turns[0].session } : {}) });
      }

      // THE DOOR, UNCHANGED: the same route Ask has always used, so the guards, the money, the routine drafts, the outbox's
      // answer-once and the Activity row are all the ones that already exist. `draw` is the one thing Talk asks for that Ask
      // does not: its thread draws the answer, so the bot is asked what to draw under its words (docs/show.md section 2).
      const r = await app.inject({
        method: "POST", url: "/v1/shell/ask",
        payload: {
          message, bot: read.bot, device: b.device === "desktop" ? "desktop" : "phone", mode: b.mode === "voice" ? "voice" : "text", draw: true,
          ...(typeof b.tz === "number" ? { tz: b.tz } : {}),
          ...(sent.length ? { attachments: sent } : {}),
          ...(typeof b.streamId === "string" && b.streamId ? { streamId: b.streamId } : {}),
          ...(typeof b.projectId === "string" && b.projectId ? { projectId: b.projectId } : {}),
          ...(typeof b.clientId === "string" && b.clientId ? { clientId: b.clientId } : {}),
          ...(typeof b.typedAt === "number" ? { typedAt: b.typedAt } : {}),
        },
        headers: {
          authorization: String(req.headers["authorization"] ?? ""), "content-type": "application/json",
          ...(req.headers["idempotency-key"] ? { "idempotency-key": String(req.headers["idempotency-key"]) } : {}),
        },
      });
      let j: DoorReply;
      try { j = JSON.parse(r.body) as DoorReply; } catch { return reply.code(r.statusCode >= 400 ? r.statusCode : 502).send({ code: "ask_failed", message: "Couldn't answer that" }); }
      // The door refused (out of allowance, overloaded, stopped): its own answer goes back as it is, and NOTHING is kept —
      // a thread with the person's words and no answer under them reads as an answer that was lost.
      if (r.statusCode < 200 || r.statusCode >= 300) return reply.code(r.statusCode).send(j);

      const shell = j.shell ?? {};
      const by: TurnBy | null = shell.bot && typeof shell.bot.slug === "string"
        ? { slug: shell.bot.slug, name: String(shell.bot.name ?? shell.bot.slug), color: String(shell.bot.color ?? botLook(shell.bot.slug).color) }
        : null;
      const did: TurnDid = {
        ...(typeof shell.job === "string" && shell.job ? { job: shell.job } : {}),
        ...(typeof shell.upi === "string" && shell.upi ? { upi: shell.upi } : {}),
        ...(typeof shell.finds === "string" && shell.finds ? { finds: shell.finds } : {}),
        ...(typeof shell.needs === "number" && shell.needs > 0 ? { needs: shell.needs } : {}),
        // A routine is a card to save and not an answer: its sealed draft rides on the turn, so the card is still there
        // when the thread is drawn again (src/routines; the door makes it with no model call).
        ...(shell.routine ? { routine: JSON.stringify(shell.routine).slice(0, 4000) } : {}),
      };
      const turns = await s.chat.keepDoor(s.user.id, TALK_SLUG, {
        // The person's own words as they typed them — never the line "@" added, which is for the bot and not for the thread.
        said, text: String(shell.text ?? j.result?.text ?? ""), by, did,
        ...(j.answer?.show ? { show: j.answer.show } : {}),
        ...(read.forName ? { forName: read.forName } : {}),
        ...(session ? { session } : {}),
        ...(files.length ? { files } : {}),
      });
      return reply.send({ turns, shell, ...(turns[0]?.session ? { session: turns[0].session } : {}) });
    } catch (err) { return fail(req, reply, err); }
  });
}

/** What the shell's door answers, as much of it as Talk reads (routes/bots/botsShell.ts). */
interface DoorReply {
  result?: { text?: string } | undefined;
  answer?: { show?: unknown } | undefined;
  shell?: {
    bot?: { slug?: unknown; name?: unknown; color?: unknown };
    text?: unknown; job?: unknown; upi?: unknown; finds?: unknown; needs?: unknown; routine?: unknown;
  } | undefined;
}

export { talkName };

/** What the bot is told when a photo or a file came with no words: the file is the question. */
export function filesLine(files: readonly TurnFile[]): string {
  const pics = files.every((f) => f.kind === "image" || f.mime.startsWith("image/"));
  if (files.length === 1) return pics ? "Have a look at this photo." : `Have a look at this file: ${files[0]!.name}`;
  return pics ? `Have a look at these ${files.length} photos.` : `Have a look at these ${files.length} files.`;
}
