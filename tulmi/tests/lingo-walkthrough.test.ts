/**
 * ONE PERSON, MANY DAYS, THROUGH THE REAL DOORS.
 *
 * Every other Lingo test checks a piece. This one is somebody using it: she picks a language, says what it is for,
 * is given sets, gets things right and wrong, asks how to say a word, comes back the next day, and keeps going for
 * three weeks. Nothing is called directly — it all goes over the routes the app calls, in the order the app calls
 * them, and what she "knows" she only ever learns the way she would.
 *
 * It exists because four separate things were broken on the first minute of this feature while ~190 tests passed:
 * each piece was right and no test ever walked from one to the next.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.BOTS = "true";
  process.env.LINGO = "true";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => {
    const t = h?.replace(/^Bearer\s+/i, "").trim() ?? "";
    return t ? { id: t, token: t } : null;
  } };
});

const { MemoryLingoStore } = await import("../src/lingo/store.js");
const { MemorySentenceBank } = await import("../src/lingo/sentences.js");
const { registerLingoRoutes } = await import("../src/routes/bots/lingo.js");
const { lingoWords, runLingoNote } = await import("../src/lingo/tool.js");
const { lingoDigest } = await import("../src/lingo/digest.js");
import type { LingoItem } from "../src/lingo/types.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 2, 2, 8, 30);
const LOUD = process.env.WALKTHROUGH === "1";
const say = (s = "") => { if (LOUD) console.log(s); };
/** Things a person would notice, gathered as she goes and read out at the end. */
const FOUND: string[] = [];
const noticed = (ok: boolean, what: string) => { if (!ok) FOUND.push(what); return ok; };

/** Short real Spanish, with its English. What a poured-in corpus looks like (scripts/lingo-seed.ts). */
const SPANISH: Array<[string, string]> = [
  ["hola", "hello"], ["gracias", "thank you"], ["buenos días", "good morning"], ["por favor", "please"],
  ["¿cómo estás?", "how are you?"], ["me llamo Ana", "my name is Ana"], ["no entiendo", "I don't understand"],
  ["¿dónde está el baño?", "where is the toilet?"], ["quiero un café", "I want a coffee"], ["la cuenta, por favor", "the bill, please"],
  ["hasta luego", "see you later"], ["mucho gusto", "nice to meet you"], ["lo siento", "I'm sorry"],
  ["¿cuánto cuesta?", "how much does it cost?"], ["tengo hambre", "I'm hungry"], ["está muy rico", "it's delicious"],
  ["¿puedes repetir?", "can you repeat that?"], ["un poco de español", "a little Spanish"],
  ["mi suegra vive en Sevilla", "my mother-in-law lives in Seville"], ["nos vemos mañana", "see you tomorrow"],
  ["¿qué tal?", "how's it going?"], ["muy bien", "very well"], ["de nada", "you're welcome"], ["buenas noches", "good night"],
  ["¿hablas inglés?", "do you speak English?"], ["no lo sé", "I don't know"], ["un momento", "one moment"],
  ["¿me ayudas?", "can you help me?"], ["está cerrado", "it's closed"], ["me gusta mucho", "I like it a lot"],
  ["¿a qué hora?", "at what time?"], ["estoy cansada", "I'm tired"], ["hace calor", "it's hot"], ["tengo que irme", "I have to go"],
  ["¿puedo pasar?", "may I come in?"], ["qué bonito", "how lovely"], ["otra vez, por favor", "again, please"],
  ["no hay problema", "no problem"], ["ya voy", "I'm coming"], ["¿cómo se dice?", "how do you say it?"],
  ["encantada de conocerte", "lovely to meet you"], ["la comida está lista", "the food is ready"],
  ["vamos a la playa", "let's go to the beach"], ["hace mucho frío hoy", "it's very cold today"],
  ["¿quieres un poco más?", "would you like a little more?"], ["gracias por todo", "thank you for everything"],
];

describe("three weeks of somebody actually using it", () => {
  it("walks from an empty app to holding words, over the real routes", async () => {
    let clock = START;
    const store = new MemoryLingoStore();
    const bank = new MemorySentenceBank();
    await bank.put("es", "en", SPANISH.map(([text, gloss]) => ({ text, gloss, words: 0, licence: "CC0-1.0", author: "", source: "walkthrough" })), clock);

    const app: FastifyInstance = Fastify();
    registerLingoRoutes(app, { rateLimit: {}, bots: {}, store, bank, now: () => clock });
    await app.ready();
    const ME = { authorization: "Bearer maria" };
    const go = async (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown) => {
      const r = await app.inject({ method, url, headers: ME, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { code: r.statusCode, body: r.statusCode === 200 ? r.json() : r.body };
    };
    /** What she can see of her own course, which is how she "knows" an answer: she learned it here. */
    const mine = async (): Promise<LingoItem[]> => store.items("maria", "es");
    const byRef = async (ref: string) => {
      const { refOf } = await import("../src/lingo/session.js");
      return (await mine()).find((i) => refOf("maria", "es", i.item) === ref);
    };

    // ---------------------------------------------------------------- day one
    say("\n=== DAY 1 — she opens Lingo for the first time ===");
    const empty = await go("GET", "/v1/lingo/courses");
    expect(empty.code).toBe(200);
    expect(empty.body.courses).toEqual([]);
    say(`  territory: ${empty.body.courses.length} languages -> the empty state asks which one`);

    const langs = await go("GET", "/v1/lingo/languages?q=span");
    expect(langs.code).toBe(200);
    const spanish = langs.body.languages.find((l: { tag: string }) => l.tag === "es");
    expect(spanish, "searching 'span' finds Spanish").toBeTruthy();
    say(`  search "span" -> ${langs.body.languages.slice(0, 3).map((l: { name: string; en: string }) => `${l.name} (${l.en})`).join(", ")}`);

    const started = await go("PUT", "/v1/lingo/course", {
      target: "es", why: "someone", whyNote: "My partner's mother is in Seville. I meet her in March and she has no English.",
    });
    expect(started.code, "she never said which language she speaks, and it still starts").toBe(200);
    expect(started.body.course).toMatchObject({ target: "es", from: "en", why: "someone" });
    say(`  started: learning ${started.body.course.target} from ${started.body.course.from}, because ${started.body.course.why}`);

    // ---------------------------------------------------------------- her first set
    const first = await go("POST", "/v1/lingo/session", { target: "es" });
    expect(first.code).toBe(200);
    expect(first.body.exercises.length, "a brand new course is not an empty lesson").toBeGreaterThan(0);
    say(`\n  first set: ${first.body.exercises.length} exercises, all ${[...new Set(first.body.exercises.map((e: { kind: string }) => e.kind))].join("/")}`);
    say(`  the answer is never in what the app was sent: ${JSON.stringify(first.body.exercises[0])}`);
    for (const e of first.body.exercises) {
      expect(e.item, "no exercise carries its own answer").toBeUndefined();
      expect(e.accepted).toBeUndefined();
      expect(e.correct).toBeUndefined();
    }

    // She guesses: a beginner shown three meanings gets some right and some wrong.
    const answers: Array<{ item: string; kind: string; verdict: string; learnedNow?: boolean }> = [];
    let n = 0;
    for (const e of first.body.exercises as Array<{ ref: string; kind: string; options: string[] }>) {
      const it = await byRef(e.ref);
      expect(it, "every exercise is about a word she has").toBeTruthy();
      const right = e.options.indexOf(it!.gloss);
      // Two in every five she gets wrong, which is about what guessing from three looks like.
      const picked = n % 5 < 2 ? (right + 1) % e.options.length : right;
      const r = await go("POST", "/v1/lingo/answer", { target: "es", ref: e.ref, kind: e.kind, picked });
      expect(r.code).toBe(200);
      answers.push({ item: it!.item, kind: e.kind, verdict: r.body.mark.verdict, ...(r.body.learned ? { learnedNow: true } : {}) });
      n++;
      clock += 20_000;
    }
    const got = answers.filter((a) => a.verdict === "right").length;
    say(`  she got ${got} of ${answers.length} right`);

    const set1 = await go("POST", "/v1/lingo/set", { target: "es", answers });
    expect(set1.code).toBe(200);
    say(`  the bot's reading: ${set1.body.performance} -> gesture ${JSON.stringify(set1.body.gesture)}`);
    say(`  next set: ${set1.body.next.size} long, ${set1.body.next.newRoom} new, nothing above "${set1.body.next.rungCap ?? "anything"}", revisiting ${set1.body.next.revisit.length}`);
    expect(["flying", "solid", "shaky", "struggling"]).toContain(set1.body.performance);

    // ---------------------------------------------------------------- she asks Lingo a word
    say("\n  she types: how do you say stubborn?");
    const tool = await runLingoNote(lingoWords(store), "maria", {
      words: [{ word: "terco", meaning: "stubborn", how: "asked" }],
    }, clock);
    expect(tool.ok).toBe(true);
    say(`  Lingo writes it down: ${tool.content}`);
    expect((await mine()).some((i) => i.item === "terco" && i.source === "asked")).toBe(true);

    const next = await go("POST", "/v1/lingo/session", { target: "es", shape: set1.body.next });
    const hers = await Promise.all((next.body.exercises as Array<{ ref: string }>).map((e) => byRef(e.ref)));
    const cameBack = hers.some((i) => i?.item === "terco");
    say(`  does it come back in the next set? ${cameBack ? "yes" : "NO"}`);
    noticed(cameBack, "She asked how to say a word, Lingo said it wrote it down, and it did not come back in the next set: the bad set before it set newRoom to 0, and a word she asked for 10 seconds ago is treated as new material off a list.");

    // ---------------------------------------------------------------- three weeks
    say("\n=== DAYS 2-21 — she comes back each morning and does one set ===");
    const ladder = new Map<string, string[]>();
    let sets = 0, asked = 0, rightAll = 0;
    let shape = set1.body.next;
    for (let day = 2; day <= 21; day++) {
      clock = START + (day - 1) * DAY + 9 * 3_600_000;
      const s = await go("POST", "/v1/lingo/session", { target: "es", shape });
      expect(s.code, `day ${day}`).toBe(200);
      if (!s.body.exercises.length) { say(`  day ${day}: nothing due`); continue; }
      sets++;
      const todays: typeof answers = [];
      for (const e of s.body.exercises as Array<{ ref: string; kind: string; options: string[]; chips: string[] }>) {
        const it = await byRef(e.ref);
        if (!it) continue;
        ladder.set(it.item, [...(ladder.get(it.item) ?? []), e.kind]);
        // Somebody who has met a word a few times mostly knows it: right four times in five.
        const knows = asked % 5 !== 3;
        const body: Record<string, unknown> =
          e.kind === "choose" || e.kind === "reply" || e.kind === "blank"
            ? { picked: knows ? e.options.indexOf(e.kind === "choose" ? it.gloss : it.item) : -1 }
          : e.kind === "chips" ? { chips: knows ? it.item : "no" }   // one line, exactly as the screen sends it
          : { said: knows ? it.item : "no" };
        const r = await go("POST", "/v1/lingo/answer", { target: "es", ref: e.ref, kind: e.kind, ...body });
        expect(r.code, `day ${day} ${e.kind}`).toBe(200);
        todays.push({ item: it.item, kind: e.kind, verdict: r.body.mark.verdict, ...(r.body.learned ? { learnedNow: true } : {}) });
        if (r.body.mark.verdict === "right") rightAll++;
        asked++;
        clock += 25_000;
      }
      const done = await go("POST", "/v1/lingo/set", { target: "es", answers: todays });
      say(`    day ${String(day).padStart(2)}: ${todays.filter((a) => a.verdict === "right").length}/${todays.length} right -> ${done.body.performance.padEnd(11)} cap "${done.body.next.rungCap ?? "none"}" new ${done.body.next.newRoom}`);
      shape = done.body.next;
      if (day % 5 === 0 || day === 21) {
        const c = (await go("GET", "/v1/lingo/courses")).body.courses[0];
        say(`  day ${day}: ${c.progress.items} words, ${c.progress.learned} learned, ${c.progress.due} due, held ${(c.mastery.held * 100).toFixed(0)}%, mastery ${(c.mastery.value * 100).toFixed(0)}%, streak ${c.streakDays}`);
      }
    }

    // ---------------------------------------------------------------- what actually happened
    say("\n=== WHAT THE LADDER DID ===");
    const kinds = new Map<string, number>();
    for (const seq of ladder.values()) for (const k of seq) kinds.set(k, (kinds.get(k) ?? 0) + 1);
    say(`  ${asked} questions over ${sets} sets, ${((rightAll / Math.max(1, asked)) * 100).toFixed(0)}% right`);
    say(`  kinds asked: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const [item, seq] of [...ladder.entries()].slice(0, 6)) say(`    ${item.padEnd(26)} ${seq.join(" -> ")}`);

    say("\n=== WHERE HER WORDS ACTUALLY ARE ===");
    const states = new Map<string, number>();
    for (const i of await mine()) states.set(i.memory.state, (states.get(i.memory.state) ?? 0) + 1);
    say(`  states: ${[...states.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const i of (await mine()).slice(0, 6)) {
      say(`    ${i.item.padEnd(26)} state ${i.memory.state.padEnd(11)} reps ${String(i.memory.reps).padStart(2)} lapses ${String(i.memory.lapses).padStart(2)} steps ${i.memory.steps} stability ${i.memory.stability.toFixed(1)} spoken ${i.spoken}`);
    }
    const end = (await go("GET", "/v1/lingo/courses")).body.courses[0];
    say(`\n  after three weeks: ${end.progress.items} words, ${end.progress.learned} learned, ${end.mastery.spoken} ever said out loud, streak ${end.streakDays}`);
    const digest = await lingoDigest("maria", { store, now: clock });
    say(`\n=== WHAT LINGO KNOWS ABOUT HER ===\n${digest?.split("\n").slice(0, 10).map((l) => `  ${l}`).join("\n")}`);

    // What has to be true at the end of all that.
    noticed(sets > 15, `She only got a set on ${sets} of the 20 days.`);
    noticed(end.streakDays > 15, `Her streak reached ${end.streakDays} after 21 days of turning up.`);
    noticed(kinds.size > 2, `Only ${kinds.size} kind(s) of question were ever asked: ${[...kinds.keys()].join(", ")}.`);
    noticed(!!(await mine()).find((i) => i.item === "terco"), "The word she asked for is gone from her course.");
    noticed(end.progress.learned > 0, `After three weeks nothing had crossed into learned (${end.progress.learned}).`);
    noticed(end.mastery.spoken > end.progress.items / 2, `Only ${end.mastery.spoken} of her ${end.progress.items} words had ever been said out loud.`);
    noticed(end.progress.items > 25, `The spine stopped feeding her: ${end.progress.items} words after three weeks.`);

    say("\n=== WHAT A PERSON WOULD NOTICE ===");
    if (!FOUND.length) say("  nothing");
    for (const f of FOUND) say(`  - ${f}`);
    // Every one of these was true at some point today and each was a real fault, not a strict test:
    // a word she asked for never came back, chips were always marked wrong, and three weeks of
    // eighty-per-cent days finished nothing because a wobbly day was capped below speaking.
    expect(FOUND).toEqual([]);
  }, 60_000);
});
