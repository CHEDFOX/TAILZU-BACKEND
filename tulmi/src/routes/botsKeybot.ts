/**
 * Bots app · keybot area: what the Keybot pages read and write beyond the existing routes.
 *
 * The pages also use the routes that were already there: PUT /v1/personality (the read-aloud voice), POST /v1/words
 * (add or forget a word), DELETE /v1/history/:id. Everything here is the signed-in person's own, under /v1/keybot
 * (not /v1/bots/keybot, which is the built-in bot's own record in routes/bots.ts).
 *
 *   GET  /v1/keybot                 the home page: the week's words by day, minutes saved, by app, a line per page
 *   GET  /v1/keybot/tone            Tone per app
 *   POST /v1/keybot/tone            { group, preset?, noStop?, latin?, signOff? }: kept, and written into personality.appStyles
 *   GET  /v1/keybot/words?q=        Your words: added, learned, how often each was said, where last
 *   GET  /v1/keybot/voices          Read aloud
 *   GET  /v1/keybot/train           Teach your style: the ten lines, what was said, what it learned
 *   POST /v1/keybot/train           { line, said }: learned from (POST /v1/train/pick, the same as the Train sheet), then kept
 *   POST /v1/keybot/train/skip      { line }
 *   POST /v1/keybot/train/restart   start the ten lines again (what it learned stays)
 *   POST /v1/keybot/learned/forget  { kind: "word" | "style", key }: "Not me", out of the style portrait
 *   GET  /v1/keybot/history?q=      What you said
 *   POST /v1/keybot/history/clear   every line of it, gone
 *   GET  /v1/keybot/settings        the phone keyboard's choices, the languages
 *   POST /v1/keybot/language        { value, on }: one language in or out of personality.languages
 *   GET  /v1/keybot/prefs           the whole Keybot document (prefs.ts), for a client to follow
 *   PUT  /v1/keybot/prefs           any part of it; keyboard.haptics also switches personality.hapticsAll
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { deleteHistoryEntry, listHistory, statsForUser } from "../history/store.js";
import { getPersonality, updatePersonality } from "../personality/store.js";
import { getPrefs, mergePrefs, prefsPatchSchema, TONE_GROUPS, updatePrefs, type KeybotPrefs } from "../keybot/prefs.js";
import { presetById, withGroupStyles } from "../keybot/tones.js";
import { historyView, homeView, settingsView, toneView, trainView, TRAIN_LINES, voicesView, wordsView } from "../keybot/views.js";
import type { BotsAreaDeps } from "./botsArea.js";

/** The clock the person reads their day by: the app sends it (x-tz-offset or ?tz), else their portrait's. */
function tzOf(req: FastifyRequest, fallback: number | undefined): number {
  const raw = (req.query as { tz?: unknown } | undefined)?.tz ?? req.headers["x-tz-offset"];
  const n = Number(raw);
  const v = Number.isFinite(n) && String(raw ?? "").trim() !== "" ? n : (fallback ?? 0);
  return Math.max(-840, Math.min(840, Math.round(v)));
}

const toneSchema = z.object({
  group: z.enum(TONE_GROUPS),
  preset: z.string().max(40).nullable().optional(),
  noStop: z.boolean().optional(),
  latin: z.boolean().optional(),
  signOff: z.boolean().optional(),
}).strict();

const trainSchema = z.object({ line: z.number().int().min(0).max(TRAIN_LINES.length - 1), said: z.string().trim().min(1).max(600) }).strict();
const lineSchema = z.object({ line: z.number().int().min(0).max(TRAIN_LINES.length - 1) }).strict();
const forgetSchema = z.object({ kind: z.enum(["word", "style"]), key: z.string().trim().min(1).max(120) }).strict();
const languageSchema = z.object({ value: z.string().trim().min(1).max(16).regex(/^[a-z][a-z-]*$/i), on: z.boolean() }).strict();

export function registerBotsKeybotRoutes(app: FastifyInstance, deps: BotsAreaDeps): void {
  const RL = { config: deps.rateLimit };

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Sign in first" }); return null; }
    return user;
  };
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });
  const failed = (req: FastifyRequest, reply: FastifyReply, err: unknown, message: string) => {
    req.log.error({ err: (err as Error)?.message }, "keybot: request failed");
    return reply.code(500).send({ code: "internal", message });
  };

  // ------------------------------------------------------------------ the home page

  app.get("/v1/keybot", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    try {
      const [personality, prefs] = await Promise.all([getPersonality(user), getPrefs(user)]);
      const tz = tzOf(req, personality.stylePortrait?.tzOffsetMinutes);
      const stats = await statsForUser(user, "week", tz).catch(() => undefined);
      return reply.send(homeView({ stats, personality, prefs, now: Date.now(), tzOffsetMinutes: tz }));
    } catch (err) { return failed(req, reply, err, "Couldn't read your week"); }
  });

  // ------------------------------------------------------------------ tone per app

  app.get("/v1/keybot/tone", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const prefs = await getPrefs(user);
    return reply.send(toneView(prefs, prefs.toneFocus));
  });

  app.post("/v1/keybot/tone", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = toneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "Say which kind of app, and the tone");
    const { group, preset, ...little } = parsed.data;
    if (preset && !presetById(preset)) return bad(reply, "No such tone");
    try {
      const prefs = await updatePrefs(user, (cur) => {
        const t = { ...(cur.tones?.[group] ?? {}), ...little, ...(preset !== undefined ? { preset: preset ?? undefined } : {}) };
        return { ...cur, tones: { ...(cur.tones ?? {}), [group]: t }, toneFocus: group };
      });
      // What the writer reads: the kind's apps, in the chosen tone (none chosen: as they said it).
      await updatePersonality(user, (p) => withGroupStyles(p, group, prefs.tones?.[group]));
      return reply.send(toneView(prefs, group));
    } catch (err) { return failed(req, reply, err, "Couldn't save that tone"); }
  });

  // ------------------------------------------------------------------ your words

  app.get("/v1/keybot/words", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    try {
      const personality = await getPersonality(user);
      const saved = String(personality.vocabulary ?? "").split(/\r?\n/).map((w) => w.trim()).filter(Boolean).slice(0, 500);
      const [stats, history] = await Promise.all([
        statsForUser(user, "month", tzOf(req, personality.stylePortrait?.tzOffsetMinutes), saved).catch(() => undefined),
        listHistory(user, { limit: 200 }).then((h) => h.entries).catch(() => []),
      ]);
      return reply.send(wordsView({ personality, dictionary: stats?.dictionary, history, q: String((req.query as { q?: unknown }).q ?? "") }));
    } catch (err) { return failed(req, reply, err, "Couldn't read your words"); }
  });

  // ------------------------------------------------------------------ read aloud

  app.get("/v1/keybot/voices", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const [personality, prefs] = await Promise.all([getPersonality(user), getPrefs(user)]);
    return reply.send(voicesView(personality, prefs));
  });

  // ------------------------------------------------------------------ teach your style

  app.get("/v1/keybot/train", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const [personality, prefs] = await Promise.all([getPersonality(user), getPrefs(user)]);
    return reply.send(trainView(personality, prefs));
  });

  app.post("/v1/keybot/train", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = trainSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "Say the line your way first");
    const { line, said } = parsed.data;
    // Learned from exactly as the Train sheet's pick is: the line, and how they would really say it.
    const pick = await app.inject({
      method: "POST", url: "/v1/train/pick",
      headers: { authorization: String(req.headers["authorization"] ?? ""), "content-type": "application/json" },
      payload: { input: TRAIN_LINES[line]!.text, chosen: said },
    });
    if (pick.statusCode >= 300) {
      let body: unknown = {};
      try { body = JSON.parse(pick.body); } catch { /* not JSON */ }
      return reply.code(pick.statusCode).send(body);
    }
    const prefs = await updatePrefs(user, (cur) => ({
      ...cur, train: { ...(cur.train ?? {}), said: { ...(cur.train?.said ?? {}), [String(line)]: said } },
    }));
    return reply.send(trainView(await getPersonality(user), prefs));
  });

  app.post("/v1/keybot/train/skip", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = lineSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "Which line?");
    const prefs = await updatePrefs(user, (cur) => ({
      ...cur, train: { ...(cur.train ?? {}), skipped: [...new Set([...(cur.train?.skipped ?? []), parsed.data.line])] },
    }));
    return reply.send(trainView(await getPersonality(user), prefs));
  });

  app.post("/v1/keybot/train/restart", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const prefs = await updatePrefs(user, (cur) => ({ ...cur, train: {} }));
    return reply.send(trainView(await getPersonality(user), prefs));
  });

  app.post("/v1/keybot/learned/forget", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = forgetSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "Which one?");
    const { kind, key } = parsed.data;
    const same = (a: string | undefined) => String(a ?? "").trim().toLowerCase() === key.toLowerCase();
    try {
      const p = await updatePersonality(user, (cur) => {
        const sp = cur.stylePortrait ?? {};
        return {
          ...cur,
          stylePortrait: kind === "word"
            ? { ...sp, words: (sp.words ?? []).filter((w) => !same(w.term)) }
            : { ...sp, styles: (sp.styles ?? []).filter((s) => !same(s.name)) },
        };
      });
      return reply.send(trainView(p, await getPrefs(user)));
    } catch (err) { return failed(req, reply, err, "Couldn't forget that"); }
  });

  // ------------------------------------------------------------------ what you said

  app.get("/v1/keybot/history", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    try {
      const [personality, list] = await Promise.all([getPersonality(user), listHistory(user, { limit: 200 })]);
      return reply.send(historyView(list.entries, personality, String((req.query as { q?: unknown }).q ?? "")));
    } catch (err) { return failed(req, reply, err, "Couldn't read what you said"); }
  });

  app.post("/v1/keybot/history/clear", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    try {
      let cleared = 0;
      // Page by page, newest first, until nothing is left (bounded: a runaway is not a reason to spin).
      for (let round = 0; round < 50; round++) {
        const { entries } = await listHistory(user, { limit: 200 });
        if (!entries.length) break;
        for (const e of entries) if (await deleteHistoryEntry(user, e.id)) cleared++;
      }
      return reply.send({ ok: true, cleared });
    } catch (err) { return failed(req, reply, err, "Couldn't clear it"); }
  });

  // ------------------------------------------------------------------ keyboard settings

  app.get("/v1/keybot/settings", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const [personality, prefs] = await Promise.all([getPersonality(user), getPrefs(user)]);
    return reply.send(settingsView(personality, prefs));
  });

  app.post("/v1/keybot/language", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = languageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "Which language?");
    const { value, on } = parsed.data;
    try {
      const p = await updatePersonality(user, (cur) => {
        const list = (cur.languages ?? []).map(String).filter((l) => l !== value);
        return { ...cur, languages: on ? [...list, value].slice(0, 12) : list };
      });
      return reply.send(settingsView(p, await getPrefs(user)));
    } catch (err) { return failed(req, reply, err, "Couldn't change your languages"); }
  });

  // ------------------------------------------------------------------ the document

  app.get("/v1/keybot/prefs", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    return reply.send({ prefs: await getPrefs(user) });
  });

  app.put("/v1/keybot/prefs", RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const parsed = prefsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, "That isn't a Keybot setting");
    if (parsed.data.tones) return bad(reply, "Tones change through POST /v1/keybot/tone");
    try {
      const prefs: KeybotPrefs = await updatePrefs(user, (cur) => mergePrefs(cur, parsed.data));
      // The keyboard buzzes by personality.hapticsAll: Off turns it off, Light or Strong on.
      const haptics = parsed.data.keyboard?.haptics;
      if (haptics) await updatePersonality(user, (p) => ({ ...p, hapticsAll: haptics !== "off" }));
      return reply.send({ prefs });
    } catch (err) { return failed(req, reply, err, "Couldn't save that"); }
  });
}
