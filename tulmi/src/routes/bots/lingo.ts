/**
 * LINGO'S DOORS (src/lingo, docs/lingo.md): the course a person is on, the session in front of them, and the answers.
 *
 *   GET    /v1/lingo/languages?q=      { suggested, languages }: what the picker shows, and what a search in it finds
   GET    /v1/lingo/courses           { courses: [{ ...course, progress }] }, the one opened last first
 *   PUT    /v1/lingo/course            start or change one: { target, from, level?, goalMin?, calls?, voice? }
 *   DELETE /v1/lingo/course/:target    the course and every word of it, forgotten
 *   POST   /v1/lingo/words             { target, items: [{ item, gloss, kind?, source? }] } -> { added }
 *   POST   /v1/lingo/session           { target } -> { exercises, progress }: what to do now
 *   POST   /v1/lingo/answer            { target, item, kind, said? | picked? | chips? } -> { mark, dueMs, spoken, learned }
 *
 * THE ANSWER IS MARKED HERE AND NOWHERE ELSE. The app sends what the person did, never whether it was right, so there
 * is no message it can send that says so. That is the whole difference from an app that marks itself.
 *
 * The signed-in person's own. With BOTS off, or Lingo off (LINGO), every route is 404 { code: "lingo_off" }.
 * Nothing a person typed is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { lingoOn } from "../../bots/builtin.js";
import { gradeChips, gradeChoice, gradeSpoken, gradeText } from "../../lingo/grade.js";
import { learned } from "../../lingo/schedule.js";
import { answered, dayOf, pick, plan, progress, shapeFor, streakAfter, type Exercise, type SentenceLookup } from "../../lingo/session.js";
import { againAfter } from "../../lingo/order.js";
import { sentenceBank, type Sentence, type SentenceBank } from "../../lingo/sentences.js";
import { keyOf, lingoStore, type LingoStore, type NewItem } from "../../lingo/store.js";
import { EXERCISE_KINDS, LEVELS, type ExerciseKind, type ItemKind, type ItemSource, type Learner, type Level } from "../../lingo/types.js";
import { languageOf, search as searchLanguages, suggested } from "../../lingo/languages.js";

export interface LingoRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  store?: LingoStore;
  /** The shared sentence bank (src/lingo/sentences.ts); the server's own when not given. */
  bank?: SentenceBank;
  now?: () => number;
}

const TAG_MAX = 16;
const TEXT_MAX = 200;
const GLOSS_MAX = 300;
const WORDS_PER_CALL = 50;
/** Sentences fetched per word that needs one. A handful is plenty: the shortest usable one is taken. */
const SENTENCES_PER_WORD = 4;

/** A language tag, as loosely as BCP-47 allows and no looser. No list of languages exists anywhere in Lingo. */
const isTag = (s: string): boolean => /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(s) && s.length <= TAG_MAX;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function registerLingoRoutes(app: FastifyInstance, deps: LingoRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const store = (): LingoStore => deps.store ?? lingoStore();
  const bank = (): SentenceBank => deps.bank ?? sentenceBank();
  const now = deps.now ?? Date.now;

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    if (!deps.bots || !lingoOn()) { reply.code(404).send({ code: "lingo_off", message: "Lingo is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return user;
  };
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });

  /**
   * WHAT THE PICKER SHOWS. The list and the search both live on the server, so adding a language, fixing a name or
   * changing what is suggested is a deploy and never an app release — and nothing about the list is compiled into a
   * phone. Each row carries the language's own name and the English one, because somebody looks for the word they
   * call their language by.
   *
   * `q` empty: the suggested few, then every language by name. `q` set: what it finds, best first, folded so the
   * marks over letters cannot hide a match ("espanol" finds Español).
   */
  app.get<{ Querystring: { q?: string; from?: string } }>("/v1/lingo/languages", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const q = str(req.query.q, 60);
    // The language they already speak is never offered as one to learn. Theirs is whatever they say, else their
    // newest course's, else nothing — a picker that has to guess simply offers everything.
    const from = str(req.query.from, TAG_MAX) || (await store().courses(user.id).catch(() => []))[0]?.from || "";
    const row = (l: { tag: string; name: string; en: string }) => ({ tag: l.tag, name: l.name, en: l.en });
    return reply.header("cache-control", "no-store").send({
      from: from || null,
      fromName: from ? (languageOf(from)?.name ?? null) : null,
      suggested: q ? [] : suggested(from).map(row),
      languages: searchLanguages(q, { from }).map(row),
    });
  });

  app.get("/v1/lingo/courses", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const at = now();
    const courses = await store().courses(user.id).catch(() => []);
    const out = [];
    for (const c of courses) {
      const items = await store().items(user.id, c.target).catch(() => []);
      out.push({ ...c, progress: progress(items, at) });
    }
    return reply.header("cache-control", "no-store").send({ courses: out });
  });

  app.put("/v1/lingo/course", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const from = str(b["from"], TAG_MAX);
    if (!isTag(target)) return bad(reply, "Which language do you want to learn?");
    if (!isTag(from)) return bad(reply, "Which language do you already speak?");
    if (target === from) return bad(reply, "Those are the same language.");

    const at = now();
    const kept = await store().course(user.id, target).catch(() => null);
    const level = str(b["level"], 2).toLowerCase();
    const goal = num(b["goalMin"]);
    const learner: Learner = {
      target,
      from,
      level: (LEVELS as readonly string[]).includes(level) ? (level as Level) : (kept?.level ?? "a1"),
      goalMin: goal === null ? (kept?.goalMin ?? 10) : Math.max(1, Math.min(240, Math.round(goal))),
      calls: typeof b["calls"] === "boolean" ? (b["calls"] as boolean) : (kept?.calls ?? false),
      voice: str(b["voice"], 60) || kept?.voice || null,
      streakDays: kept?.streakDays ?? 0,
      lastDay: kept?.lastDay ?? null,
      usedMs: at,
      updatedMs: at,
    };
    const saved = await store().setCourse(user.id, learner, at);
    return reply.send({ course: saved });
  });

  app.delete<{ Params: { target: string } }>("/v1/lingo/course/:target", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const target = str(req.params.target, TAG_MAX);
    if (!isTag(target)) return bad(reply, "No such course.");
    await store().forget(user.id, target);
    return reply.send({ forgotten: true });
  });

  app.post("/v1/lingo/words", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    if (!isTag(target)) return bad(reply, "Which language are these for?");
    if (!(await store().course(user.id, target).catch(() => null))) return bad(reply, "That course has not been started.");

    const raw = Array.isArray(b["items"]) ? (b["items"] as unknown[]).slice(0, WORDS_PER_CALL) : [];
    const items: NewItem[] = [];
    for (const r of raw) {
      const o = (r ?? {}) as Record<string, unknown>;
      const item = keyOf(str(o["item"], TEXT_MAX));
      if (!item) continue;
      const kind = str(o["kind"], 8) === "phrase" || item.includes(" ") ? "phrase" : "word";
      const source = str(o["source"], 8);
      items.push({
        item,
        kind: kind as ItemKind,
        gloss: str(o["gloss"], GLOSS_MAX),
        source: (["seed", "said", "asked", "heard"].includes(source) ? source : "seed") as ItemSource,
      });
    }
    if (!items.length) return bad(reply, "Nothing to add.");
    const added = await store().add(user.id, target, items, now());
    return reply.send({ added });
  });

  /**
   * A real sentence for each word that is at the stage of being put back into one. Only those words are looked up,
   * so a session costs one small query per word that actually needs it and none for the rest.
   */
  const lookupFor = async (target: string, from: string, items: readonly { item: string }[], want: readonly string[]): Promise<SentenceLookup> => {
    const found = new Map<string, readonly Sentence[]>();
    const need = items.filter((i) => want.includes(i.item)).slice(0, 40);
    await Promise.all(need.map(async (i) => {
      const rows = await bank().using(target, from, i.item, SENTENCES_PER_WORD).catch(() => []);
      if (rows.length) found.set(i.item, rows);
    }));
    return (item: string) => found.get(item) ?? [];
  };

  app.post("/v1/lingo/session", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const at = now();
    const items = await store().items(user.id, target).catch(() => []);
    // Only the words the ladder would put into a sentence are looked up in the bank.
    const wants = items.filter((i) => shapeFor(i, at) === "blank").map((i) => i.item);
    const sentences = await lookupFor(target, course.from, pick(items, course, at), wants);
    // Opening a session is what makes this the course the app shows next time.
    await store().setCourse(user.id, { ...course, usedMs: at }, at).catch(() => undefined);
    return reply.header("cache-control", "no-store")
      .send({ exercises: plan(items, course, at, sentences), progress: progress(items, at) });
  });

  app.post("/v1/lingo/answer", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const key = keyOf(str(b["item"], TEXT_MAX));
    const kind = str(b["kind"], 8) as ExerciseKind;
    if (!key) return bad(reply, "Which word was that?");
    if (!(EXERCISE_KINDS as readonly string[]).includes(kind)) return bad(reply, "That is not a kind of exercise.");

    const at = now();
    const items = await store().items(user.id, target).catch(() => []);
    const item = items.find((i) => i.item === key);
    if (!item) return bad(reply, "That word is not in this course.");

    // The exercise is rebuilt here from the item itself, so what is accepted comes from the table and never from the
    // app: an app that asked to be marked against its own answers could mark itself right. A sentence with a gap in
    // it is rebuilt from the bank the same way, and the options come out in the same order, because the shuffle is
    // seeded by the word and the day.
    const { exerciseFor } = await import("../../lingo/session.js");
    const sentences = kind === "blank" ? await lookupFor(target, course.from, [item], [item.item]) : undefined;
    const ex: Exercise = exerciseFor(item, items, at, kind, sentences);

    const said = str(b["said"], TEXT_MAX * 2);
    const picked = num(b["picked"]);
    const chips = Array.isArray(b["chips"]) ? (b["chips"] as unknown[]).map((c) => str(c, TEXT_MAX)).filter(Boolean).slice(0, 40) : [];

    const mark =
      // A gap in a sentence is answered by choosing a word; when the bank had no sentence for it, exerciseFor fell
      // back to writing, and `ex.kind` says so, so it is marked the way it was actually asked.
      kind === "choose" || ex.kind === "blank" ? gradeChoice(picked ?? -1, ex.correct, ex.options)
      : kind === "chips" || ex.kind === "chips" ? gradeChips(chips, [ex.item.split(" ").filter(Boolean)])
      : kind === "say" || kind === "talk" ? gradeSpoken(said, ex.accepted)
      : gradeText(said, ex.accepted);

    const next = answered(item, kind, mark, at);
    await store().save(user.id, target, [next], at);

    // A session that got anywhere counts for the day. The streak is the person's own day, not the server's.
    const tz = num(b["tzOffsetMinutes"]) ?? 0;
    const today = dayOf(at, Math.max(-840, Math.min(840, tz)));
    const streak = streakAfter(course, today);
    if (streak.lastDay !== course.lastDay || streak.streakDays !== course.streakDays) {
      await store().setCourse(user.id, { ...course, ...streak, usedMs: at }, at).catch(() => undefined);
    }

    return reply.send({
      mark,
      dueMs: next.memory.dueMs,
      spoken: next.spoken,
      learned: learned(next),
      streakDays: streak.streakDays,
      // How many exercises later this one should be asked again in this same sitting, 0 for not at all (order.ts).
      // The server decides it, so the app never has to work out what a miss is worth.
      againAfter: againAfter(mark.verdict),
      // What it was actually asked as, which differs from `kind` only when a gap had no sentence to sit in.
      asked: ex.kind,
    });
  });
}
