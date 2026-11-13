/**
 * LINGO'S DOORS (src/lingo, docs/lingo.md): the course a person is on, the session in front of them, and the answers.
 *
 *   GET    /v1/lingo/courses           { courses: [{ ...course, progress }] }, the one opened last first
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
import { answered, dayOf, plan, progress, streakAfter, type Exercise } from "../../lingo/session.js";
import { keyOf, lingoStore, type LingoStore, type NewItem } from "../../lingo/store.js";
import { EXERCISE_KINDS, LEVELS, type ExerciseKind, type ItemKind, type ItemSource, type Learner, type Level } from "../../lingo/types.js";

export interface LingoRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  store?: LingoStore;
  now?: () => number;
}

const TAG_MAX = 16;
const TEXT_MAX = 200;
const GLOSS_MAX = 300;
const WORDS_PER_CALL = 50;

/** A language tag, as loosely as BCP-47 allows and no looser. No list of languages exists anywhere in Lingo. */
const isTag = (s: string): boolean => /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(s) && s.length <= TAG_MAX;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function registerLingoRoutes(app: FastifyInstance, deps: LingoRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const store = (): LingoStore => deps.store ?? lingoStore();
  const now = deps.now ?? Date.now;

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    if (!deps.bots || !lingoOn()) { reply.code(404).send({ code: "lingo_off", message: "Lingo is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return user;
  };
  const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ code: "bad_request", message });

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

  app.post("/v1/lingo/session", rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = str(b["target"], TAG_MAX);
    const course = isTag(target) ? await store().course(user.id, target).catch(() => null) : null;
    if (!course) return bad(reply, "That course has not been started.");

    const at = now();
    const items = await store().items(user.id, target).catch(() => []);
    // Opening a session is what makes this the course the app shows next time.
    await store().setCourse(user.id, { ...course, usedMs: at }, at).catch(() => undefined);
    return reply.header("cache-control", "no-store").send({ exercises: plan(items, course, at), progress: progress(items, at) });
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
    // app: an app that asked to be marked against its own answers could mark itself right.
    const { exerciseFor } = await import("../../lingo/session.js");
    const ex: Exercise = exerciseFor(item, items, at, kind);

    const said = str(b["said"], TEXT_MAX * 2);
    const picked = num(b["picked"]);
    const chips = Array.isArray(b["chips"]) ? (b["chips"] as unknown[]).map((c) => str(c, TEXT_MAX)).filter(Boolean).slice(0, 40) : [];

    const mark =
      kind === "choose" ? gradeChoice(picked ?? -1, ex.correct, ex.options)
      : kind === "chips" ? gradeChips(chips, [ex.item.split(" ").filter(Boolean)])
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
    });
  });
}
