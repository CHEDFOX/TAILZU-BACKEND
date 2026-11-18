/**
 * LINGO'S DOORS (src/lingo, docs/lingo.md): the course a person is on, the session in front of them, and the answers.
 *
 *   GET    /v1/lingo/languages?q=      { suggested, languages }: what the picker shows, and what a search in it finds
   GET    /v1/lingo/courses           { courses: [{ ...course, progress }] }, the one opened last first
 *   PUT    /v1/lingo/course            start or change one: { target, from, level?, goalMin?, calls?, voice? }
 *   DELETE /v1/lingo/course/:target    { reason? } the course and its words, gone; the reason kept as one line
 *   POST   /v1/lingo/words             { target, items: [{ item, gloss, kind?, source? }] } -> { added }
 *   POST   /v1/lingo/session           { target, shape? } -> { exercises, progress, mastery }: the next set
 *   POST   /v1/lingo/set               { target, answers } -> { result, performance, gesture, next }: a set finished
 *   POST   /v1/lingo/answer            { target, ref, kind, said? | picked? | chips? } -> { mark, dueMs, spoken, learned }
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
import { gradeChips, gradeChoice, gradeSpoken, gradeText, gradeUsed } from "../../lingo/grade.js";
import { blendMs, thinkingTime, workedForIt } from "../../lingo/portrait.js";
import { after, FIRST_UNIT, unitDone } from "../../lingo/course.js";
import { askLingo, ASK_MAX } from "../../lingo/ask.js";
import { lessonBank, unitFor, type LessonBank, type UnitItem } from "../../lingo/lessons.js";
import { recall } from "../../lingo/schedule.js";
import { learned } from "../../lingo/schedule.js";
import { answered, dayOf, pick, plan, progress, refOf, shapeFor, streakAfter, wire, type Exercise, type SentenceLookup } from "../../lingo/session.js";
import { againAfter } from "../../lingo/order.js";
import { gestureFor, mastery, performanceOf, readSet, shapeNext, SET_SIZE, type Answered, type SetShape } from "../../lingo/set.js";
import { sentenceBank, type Sentence, type SentenceBank } from "../../lingo/sentences.js";
import { keyOf, lingoStore, type LingoStore, type NewItem } from "../../lingo/store.js";
import { EXERCISE_KINDS, isWhy, LEVELS, type ExerciseKind, type ItemKind, type ItemSource, type Learner, type Level, type LingoItem, type Memory, type Verdict, type Why } from "../../lingo/types.js";
import { languageOf, search as searchLanguages, suggested } from "../../lingo/languages.js";

export interface LingoRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  store?: LingoStore;
  /** The shared sentence bank (src/lingo/sentences.ts); the server's own when not given. */
  bank?: SentenceBank;
  /** What fills a unit for a pair (src/lingo/lessons.ts); the server's own when not given, null to make none. */
  lessons?: LessonBank | null;
  /** The model door a unit is written through. Without one no unit is ever made, and the path simply waits. */
  call?: unknown;
  now?: () => number;
}

const TAG_MAX = 16;
const TEXT_MAX = 200;
const GLOSS_MAX = 300;
/** Their own words for what the language is for. A line is plenty; the column holds 400. */
const WHY_NOTE_MAX = 400;
/** What writing one unit of a course for one pair may cost. It is paid once and then everybody on the pair has it. */
const UNIT_PAISE = 400;
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
  const lessons = (): LessonBank => deps.lessons ?? lessonBank();
  /** Whose call it is and what it may spend. A unit is written once for a pair and then taught to everybody. */
  const modelCtx = (userId: string) => ({ userId, budget: { maxPaise: UNIT_PAISE } as never, ...(deps.call ? { call: deps.call as never } : {}) });
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
      // The territory draws a card per language from this one call: how it is going, how far they have got, and
      // what the language is CALLED. A card showing "es · from en" is not a card anybody can read, and the server
      // is the only side that knows the names (src/lingo/languages.ts).
      out.push({
        ...c,
        name: languageOf(c.target)?.name ?? c.target,
        fromName: languageOf(c.from)?.name ?? c.from,
        progress: progress(items, at),
        mastery: mastery(items, at),
      });
    }
    return reply.header("cache-control", "no-store").send({ courses: out });
  });

  app.put("/v1/lingo/course", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    if (!isTag(target)) return bad(reply, "Which language do you want to learn?");
    // The language they already speak, if they did not say: the one their other courses are taught in, else English.
    // Asking the screen to send it meant the screen had to know it, and the screen that adds the FIRST language is
    // the one place nobody knows it yet — so every first language was refused, which is what used to happen here.
    const said = str(b["from"], TAG_MAX);
    if (said && !isTag(said)) return bad(reply, "Which language do you already speak?");
    const kept0 = await store().courses(user.id).catch(() => []);
    const from = said || kept0.find((c) => c.target !== target)?.from || "en";
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
      // What it is FOR, asked once as it is added. Skipping is a complete answer, so neither of these is required and
      // an empty one is never written over an answer they already gave.
      ...(isWhy(b["why"]) && b["why"] ? { why: b["why"] as Why } : kept?.why ? { why: kept.why } : {}),
      ...(str(b["whyNote"], WHY_NOTE_MAX) ? { whyNote: str(b["whyNote"], WHY_NOTE_MAX) } : kept?.whyNote ? { whyNote: kept.whyNote } : {}),
    };
    const saved = await store().setCourse(user.id, learner, at);
    return reply.send({ course: saved });
  });

  /**
   * STOP LEARNING A LANGUAGE. The course and every word of it go.
   *
   * A reason is OPTIONAL and an empty one is a complete answer — that is what "Just clean up" means, and a person
   * who does not want to explain themselves must not be made to. What they do write is kept as one line after the
   * course has gone (migration 0092), with the counts they had reached so it can be read against something, because
   * why people stop is the one thing a learning app is never told.
   */
  app.delete<{ Params: { target: string } }>("/v1/lingo/course/:target", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const target = str(req.params.target, TAG_MAX);
    if (!isTag(target)) return bad(reply, "No such course.");

    const at = now();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const reason = str(b["reason"], 1000);
    const course = await store().course(user.id, target).catch(() => null);
    if (course) {
      const items = await store().items(user.id, target).catch(() => []);
      const m = mastery(items, at);
      const days = Math.max(1, Math.round((at - course.updatedMs) / 86_400_000) || 1);
      // Kept before the course goes, and never allowed to stop the removal: somebody who asked to be rid of a
      // language is rid of it whether or not we managed to write our note about why.
      await store().left(user.id, {
        target, reason, words: items.length, learned: m.learned, streak: course.streakDays, days, leftMs: at,
      }).catch(() => undefined);
    }
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

  /**
   * THE SPINE: what a course is made of before anybody has said anything to it.
   *
   * A course holds the words this person reached for, and on the first day there are none — nothing to schedule,
   * nothing to ask, and "Nothing due" on the very first screen somebody sees. So when it is running dry, the shared
   * bank is drawn on for short sentences of this pair. Real sentences, with their meaning already on them, which is
   * the only reason they can be seeded at all: a bare frequency list would give words with nothing to say they mean.
   *
   * They go in as `seed`, and `unseen` (schedule.ts) puts `seed` LAST, behind said, asked and heard. So anything
   * they reached for themselves is always asked first and the spine is only ever the floor underneath. That is the
   * whole of "what they need first, and the language in the end": their own words lead for as long as they keep
   * coming, and the spine fills in behind them when they do not.
   *
   * How long those sentences are follows the level, so what the spine offers grows with the person.
   */
  const SPINE_LOW = 6;
  const SPINE_ADD = 12;
  const SPINE_WORDS: Record<Level, number> = { a1: 5, a2: 7, b1: 10, b2: 13, c1: 16, c2: 20 };

  /**
   * WALKING THE PATH. Somebody always has a next thing to do, and this is what decides what it is.
   *
   * The unit they are on is loaded into their course the first time they reach it — made for their pair if nobody
   * has ever reached it before, and kept for everybody after (lessons.ts). When most of that unit is held AND has
   * been said, they move to the next one and it is loaded in turn.
   *
   * "Most", not all: one stubborn word must not hold somebody at unit 3 for a fortnight, and nothing is lost by
   * moving on, because the scheduler goes on asking for it wherever they are.
   *
   * This is the difference between a course and a pile of words. Without it there is no answer to "what now?"
   * except "whatever is due", and on a quiet day that is nothing at all.
   */
  const walk = async (userId: string, course: Learner, items: readonly LingoItem[], at: number): Promise<{ items: readonly LingoItem[]; course: Learner }> => {
    let here = course.unit || FIRST_UNIT;
    let learner = course;
    const held = (i: { memory?: Memory }) => (i.memory ? recall(i.memory, at) : 0);
    let have = items;

    // At most two steps in one sitting: somebody who has been away does not get three units poured in at once.
    for (let step = 0; step < 2; step++) {
      const mine = have.filter((i) => i.unit === here);
      if (mine.length && unitDone([...have], here, held as never)) {
        const next = after(here);
        if (!next) break;                        // the end of the path: they carry on with everything they have
        here = next.key;
        continue;
      }
      if (mine.length) break;                     // this unit is loaded and not finished: nothing to do
      // Never reached before. Make it for this pair, or take what was made for somebody else on it.
      const made = deps.lessons === null ? null
        : await unitFor(lessons(), modelCtx(userId), course.target, course.from, here).catch(() => null);
      if (!made?.length) break;                   // could not be made: they carry on with what they have
      await store().add(userId, course.target, made.map((m: UnitItem) => ({
        item: m.text, gloss: m.meaning, kind: m.kind, source: "seed" as const, unit: here,
      })), at).catch(() => 0);
      have = await store().items(userId, course.target).catch(() => have);
      break;
    }
    if (here !== (course.unit || FIRST_UNIT)) {
      learner = { ...course, unit: here };
      await store().setCourse(userId, { ...learner, usedMs: at }, at).catch(() => undefined);
    }
    return { items: have, course: learner };
  };

  const topUp = async (userId: string, course: Learner, items: readonly LingoItem[], at: number): Promise<readonly LingoItem[]> => {
    // ONLY WHERE THE PATH COULD NOT REACH. The spine was built for a course with nothing in it; the path fills that
    // now, and better, because it is in an order that goes somewhere. Pouring in loose sentences beside a unit
    // drowns it — twenty of them against a unit of eight — so it stands down the moment the path has anything.
    if (items.some((i) => i.unit)) return items;
    if (items.filter((i) => i.memory.state === "new").length >= SPINE_LOW) return items;
    const rows = await bank().around(course.target, course.from, SPINE_WORDS[course.level] ?? 5, SPINE_ADD * 3).catch(() => []);
    const have = new Set(items.map((i) => keyOf(i.item)));
    const add: NewItem[] = rows
      .filter((r) => r.text.trim() && r.gloss.trim() && !have.has(keyOf(r.text)))
      .slice(0, SPINE_ADD)
      .map((r) => ({ item: keyOf(r.text), gloss: r.gloss.trim().slice(0, GLOSS_MAX), kind: "phrase" as const, source: "seed" as const }));
    // An empty bank is not an error: the course simply stays as it is and the person is asked what they do have.
    if (!add.length) return items;
    const added = await store().add(userId, course.target, add, at).catch(() => 0);
    return added ? await store().items(userId, course.target).catch(() => items) : items;
  };

  /**
   * "HOW DO I SAY…?", FROM ANY SCREEN, INCLUDING THE MIDDLE OF A SET.
   *
   * One question, one card, and the word goes into their course on the way past so it comes back in the practice
   * instead of being read once and lost. It is not a conversation: somebody mid-lesson who is made to go and have
   * one loses both the word and their place.
   */
  app.post("/v1/lingo/ask", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const question = str(b["q"], ASK_MAX);
    if (!question) return bad(reply, "What did you want to say?");
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const said = await askLingo(modelCtx(user.id), {
      target, from: course.from, question, level: course.level,
      ...(course.whyNote ? { why: course.whyNote } : {}),
    }).catch(() => null);
    if (!said) return reply.status(503).send({ code: "lingo_down", error: "Couldn't answer that just now." });

    // Into the course on the way past: `asked` is what they went looking for themselves, which the scheduler
    // already puts ahead of anything off a list.
    const at = now();
    await store().add(user.id, target, [{
      item: keyOf(said.say), gloss: said.means, kind: said.kind, source: "asked" as const,
    }], at).catch(() => 0);
    return reply.header("cache-control", "no-store").send({ ...said, target, kept: true });
  });

  app.post("/v1/lingo/session", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const at = now();
    // The path first: load the unit they are on, or move them to the next one when this one is done. Then the
    // spine, which is only ever the floor under a course the path could not fill.
    const walked = await walk(user.id, course, await store().items(user.id, target).catch(() => []), at);
    const items = await topUp(user.id, walked.course, walked.items, at);
    const onPath = walked.course;
    // The shape of this set, as the last one's performance left it. The app hands back what /v1/lingo/set gave it
    // and never invents one; anything that cannot be read as a shape means the first set of a sitting.
    const shape = readShape(b["shape"]);
    // Only the words the ladder would put into a sentence are looked up in the bank.
    const wants = items.filter((i) => shapeFor(i, at) === "blank").map((i) => i.item);
    const sentences = await lookupFor(target, onPath.from, pick(items, onPath, at, shape), wants);
    // Opening a session is what makes this the course the app shows next time. It writes back the course AS THE
    // PATH LEFT IT, not as it was read: walking may just have moved them to the next unit, and writing the old row
    // back over it put them where they started. Whole-row writes mean every writer has to carry what the last one did.
    await store().setCourse(user.id, { ...onPath, usedMs: at }, at).catch(() => undefined);
    // Wired: the item's own text, the accepted answers and which option is right are all taken out. A typed or
    // spoken exercise would otherwise travel with its own answer in it.
    const exercises = plan(items, onPath, at, sentences, shape).map((ex) => wire(ex, refOf(user.id, target, ex.item)));
    return reply.header("cache-control", "no-store")
      .send({
        exercises, progress: progress(items, at), mastery: mastery(items, at),
        // What the language is called, so a prompt can say "in Español" rather than "in es".
        name: languageOf(target)?.name ?? target,
      });
  });

  /**
   * A set's shape as the app hands it back. Read defensively and never trusted: a shape can only make the next set
   * GENTLER or sized differently, so the worst a bad one can do is ask an easier question.
   */
  const readShape = (v: unknown): SetShape | undefined => {
    const o = (v ?? null) as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return undefined;
    const size = num(o["size"]);
    const room = num(o["newRoom"]);
    const cap = str(o["rungCap"], 8);
    return {
      size: size === null ? SET_SIZE : Math.max(4, Math.min(40, Math.round(size))),
      newRoom: room === null ? 3 : Math.max(0, Math.min(20, Math.round(room))),
      rungCap: (EXERCISE_KINDS as readonly string[]).includes(cap) ? (cap as ExerciseKind) : null,
      pushSpoken: o["pushSpoken"] === true,
      revisit: Array.isArray(o["revisit"]) ? (o["revisit"] as unknown[]).map((x) => keyOf(str(x, TEXT_MAX))).filter(Boolean).slice(0, 20) : [],
    };
  };

  /**
   * A SET IS FINISHED. What happened, what the bot does about it, and the shape of the next one — all decided here.
   * The app sends what was answered and gets back the gesture to play and the shape to ask for next, so the
   * difficulty follows the person and the app works none of it out for itself.
   */
  app.post("/v1/lingo/set", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const raw = Array.isArray(b["answers"]) ? (b["answers"] as unknown[]).slice(0, 80) : [];
    const answers: Answered[] = [];
    for (const r of raw) {
      const o = (r ?? {}) as Record<string, unknown>;
      const item = keyOf(str(o["item"], TEXT_MAX));
      const kind = str(o["kind"], 8);
      const verdict = str(o["verdict"], 8);
      if (!item || !(EXERCISE_KINDS as readonly string[]).includes(kind)) continue;
      if (!["right", "close", "wrong"].includes(verdict)) continue;
      answers.push({ item, kind: kind as ExerciseKind, verdict: verdict as Verdict, learnedNow: o["learnedNow"] === true });
    }
    if (!answers.length) return bad(reply, "Nothing was answered.");

    const at = now();
    const items = await store().items(user.id, target).catch(() => []);
    const result = readSet(answers);
    const performance = performanceOf(result);
    return reply.send({
      result,
      performance,
      gesture: gestureFor(performance),
      next: shapeNext(performance, result),
      mastery: mastery(items, at),
    });
  });

  app.post("/v1/lingo/answer", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const kind = str(b["kind"], 8) as ExerciseKind;
    if (!(EXERCISE_KINDS as readonly string[]).includes(kind)) return bad(reply, "That is not a kind of exercise.");

    const at = now();
    const items = await store().items(user.id, target).catch(() => []);
    // Which item: by its opaque ref, found by hashing this person's own items. `item` is still read for a caller
    // that has the word (the chat adding one, a test), but the apps send the ref and never the answer.
    const ref = str(b["ref"], 64);
    const key = keyOf(str(b["item"], TEXT_MAX));
    const item = ref
      ? items.find((i) => refOf(user.id, target, i.item) === ref)
      : key ? items.find((i) => i.item === key) : undefined;
    if (!ref && !key) return bad(reply, "Which word was that?");
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
    // Tapping chips builds ONE LINE ("un café"), and that is what the screen sends — a string, not a list. Taking
    // only a list meant every chips answer arrived empty and was marked wrong with the reason "silence", however
    // right it was. A list is still read, because a caller may have one.
    const chips = Array.isArray(b["chips"])
      ? (b["chips"] as unknown[]).map((c) => str(c, TEXT_MAX)).filter(Boolean).slice(0, 40)
      : str(b["chips"], TEXT_MAX * 2).split(/\s+/).filter(Boolean).slice(0, 40);

    const mark =
      // A gap in a sentence is answered by choosing a word; when the bank had no sentence for it, exerciseFor fell
      // back to writing, and `ex.kind` says so, so it is marked the way it was actually asked.
      kind === "choose" || kind === "reply" || ex.kind === "blank" ? gradeChoice(picked ?? -1, ex.correct, ex.options)
      : kind === "chips" || ex.kind === "chips" ? gradeChips(chips, [ex.item.split(" ").filter(Boolean)])
      : kind === "talk" ? gradeUsed(said, ex.accepted)
      : kind === "say" || kind === "speak" ? gradeSpoken(said, ex.accepted)
      : gradeText(said, ex.accepted);

    // HOW LONG THEY THOUGHT ABOUT IT: the gap since their last answer here, which is the only honest measure of it
    // that exists — no clock in the app, and no message that could say otherwise. A gap where they put the phone
    // down is not thinking and is thrown away rather than capped (portrait.ts). It is the difference between a word
    // somebody HAS and one they can work out, and nothing else here can tell those apart: both are marked right.
    const thought = thinkingTime(course.lastAnswerMs, at);
    // RECALLED, OR WORKED OUT? Against their own middle for THIS kind of question, because speaking is slower than
    // tapping for everybody and comparing the two would only measure that. The scheduler is told, and treats a
    // right answer that cost them as what it is (schedule.ts ratingFor).
    const normal = course.tally?.[kind]?.ms ?? 0;
    const slow = workedForIt(thought, normal);
    const answeredItem = answered(item, kind, mark, at, slow);
    const next = thought
      ? { ...answeredItem, memory: { ...answeredItem.memory, thinkMs: blendMs(item.memory.thinkMs ?? 0, thought) } }
      : answeredItem;
    await store().save(user.id, target, [next], at);

    // A session that got anywhere counts for the day. The streak is the person's own day, not the server's.
    const tz = num(b["tzOffsetMinutes"]) ?? 0;
    const today = dayOf(at, Math.max(-840, Math.min(840, tz)));
    const streak = streakAfter(course, today);
    // Per kind: asked, right, and the middle time. The portrait's rates are built from these, and they are counted
    // here because this is the only place that knows what was actually asked and how it went.
    const was = course.tally?.[kind] ?? { asked: 0, right: 0, ms: 0 };
    const tally = {
      ...(course.tally ?? {}),
      [kind]: {
        asked: was.asked + 1,
        right: was.right + (mark.verdict === "right" ? 1 : 0),
        ms: thought ? blendMs(was.ms, thought) : was.ms,
      },
    };
    await store().setCourse(user.id, { ...course, ...streak, tally, lastAnswerMs: at, usedMs: at }, at).catch(() => undefined);

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
