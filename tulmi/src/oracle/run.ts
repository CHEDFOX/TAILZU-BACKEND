/**
 * A TURN WITH THE ORACLE: THE PERSON'S SKY, THE TURNS BEFORE, AND THE ROUTE THE LAST QUESTION TOOK, SENT TO THE ORACLE'S SERVICE.
 *
 *   runOracle(deps, req) -> BotAnswer          bots/run.ts sends the Oracle's turns here; every other bot runs the usual loop
 *
 *   1. the sky       when and where they were born (store.ts), read only once it is whole (the cards keep the when first), with their name and
 *                    gender from the profile (the About you card's, or the Oracle's last card). Not known yet and the message holds it ("13 July
 *                    1994, 9:30 am, Mumbai")? It is read (birth.ts), the place found (places/), kept, and said back in the notes. Still no whole
 *                    sky: there is no reading. The engine is not asked, nothing is charged, and the answer sends them to the cards
 *   2. the turns     what the bot's thread kept (memory.ts), as for any bot; an API caller sends its own
 *   3. the answer    the service (worker.ts), streamed: its words go out as they come, then the route is kept for the next turn
 *   4. memory        after an owner's chat turn, as for any bot
 *
 * THE MONEY: one answer is a few rupees (the reply on Sonnet 5.5 at low thinking, and the small calls before it); the service reports it in
 * dollars and it is turned into paise here. A request whose cap cannot cover one answer is refused before anything is asked (402).
 */
import { createHash } from "node:crypto";
import { DEFAULT_USD_INR, usdToPaise } from "../code/brain/money.js";
import { places as defaultPlaces } from "../places/index.js";
import type { Place } from "../places/types.js";
import { memoryFor, recentTurnsOf, rememberTurn } from "../bots/memory.js";
import { scrub, type RunDeps, type RunRequest } from "../bots/run.js";
import { BotError, type BotAnswer } from "../bots/types.js";
import type { AuthedUser } from "../auth/supabase.js";
import { getProfile } from "../profile/store.js";
import { isComplete, readBirth, skyLine, skyOf, type Sky } from "./birth.js";
import { oracleStore, type OracleStore } from "./store.js";
import { oracleWorker, OracleUnavailable, type OraclePerson, type OracleWorker } from "./worker.js";

export const ORACLE_SLUG = "oracle";
/** The least one answer needs, in paise (about 2.3 US cents for the reply and the calls before it). */
export const ORACLE_MIN_PAISE = 250;

export interface OracleDeps {
  store?: OracleStore;
  /** Null: not set up (no ORACLE_WORKER_URL / ORACLE_WORKER_SECRET). */
  worker?: OracleWorker | null;
  places?: { place(q: string): Promise<Place | null> };
  fx?: number;
  /** Their name and gender (the profile's when not given). */
  person?: (userId: string) => Promise<OraclePerson | null>;
}

/** Their name and gender as the profile has them: "other", and anything unknown, is left out (the engine reads only male and female). */
export async function profilePerson(userId: string): Promise<OraclePerson | null> {
  const p = await getProfile({ id: userId } as AuthedUser);
  const name = p.fullName?.trim().slice(0, 80);
  const gender = p.gender === "male" || p.gender === "female" ? p.gender : undefined;
  return name || gender ? { ...(name ? { name } : {}), ...(gender ? { gender } : {}) } : null;
}

/** What it says instead of a reading while it has no whole chart (no model is asked for these). */
export const NEEDS_SKY = "To read this, I need to know when and where you were born: the date, the time if you know it, and the town. The Oracle's cards ask for them. Then ask me again.";
export const NEEDS_PLACE = "I have the day you were born, but not the town yet. Add it on the Oracle's card, then ask me again.";
export const FOUND_NOT = "I couldn't find that birthplace on the map. Try the nearest city, or pick it on the Oracle's card.";

/** The service is told who is asking only as a hash: enough to keep one model for one person's conversation, nothing more. */
export const sessionOf = (userId: string): string => `oracle:${createHash("sha256").update(`oracle:${userId}`).digest("hex").slice(0, 24)}`;

/** Birth details in the message, made into a sky (the place found), or null. */
export async function skyFromWords(words: string, find: (q: string) => Promise<Place | null>): Promise<{ sky: Sky | null; missing: "date" | "place" | "found" | null }> {
  const read = readBirth(words);
  if (!read) return { sky: null, missing: "date" };
  if (!read.placeWords) return { sky: null, missing: "place" };
  const place = await find(read.placeWords).catch(() => null);
  if (!place) return { sky: null, missing: "found" };
  return { sky: skyOf(read, place), missing: null };
}

export async function runOracle(d: RunDeps & { oracle?: OracleDeps }, r: RunRequest): Promise<BotAnswer> {
  const now = d.now ?? Date.now;
  const t0 = now();
  const bot = r.bot;
  const emit = r.emit ?? (() => undefined);
  const worker = d.oracle?.worker !== undefined ? d.oracle.worker : oracleWorker();
  if (!worker) throw new BotError("not_configured", "The Oracle isn't set up on this server yet.", 503);
  if (r.capPaise < ORACLE_MIN_PAISE) {
    throw new BotError("budget", "One answer from the Oracle costs more than this bot has left today. It starts again tomorrow.", 402);
  }
  const store = d.oracle?.store ?? oracleStore();
  const find = (d.oracle?.places ?? defaultPlaces()).place.bind(d.oracle?.places ?? defaultPlaces());
  const remember = r.surface === "chat" || r.surface === "command";
  const notes: string[] = [];

  emit({ t: "status", stage: "reading" });
  const [row, mem, person] = await Promise.all([
    store.get(r.userId).catch(() => null),
    remember ? memoryFor(d.store, r.userId, bot.id).catch(() => ({ facts: [], thread: null })) : Promise.resolve({ facts: [], thread: null }),
    (d.oracle?.person ?? profilePerson)(r.userId).catch(() => null),
  ]);

  // Birth details in the message: kept when there were none yet, or when a whole new set is given.
  let sky: Sky | null = isComplete(row?.sky) ? row!.sky as Sky : null;
  let route = row?.route ?? null;
  const said = await skyFromWords(r.message, find);
  if (said.sky && remember) {
    sky = said.sky;
    route = null;
    await store.setSky(r.userId, sky, now()).catch(() => undefined);
    notes.push(`Kept your birth details: ${skyLine(sky)}.`);
  }

  // No reading without a chart: the engine is not asked and nothing is charged. They are sent to the cards (the Oracle's page) instead.
  if (!sky) {
    const text = said.missing === "found" ? FOUND_NOT : row?.sky ? NEEDS_PLACE : NEEDS_SKY;
    r.onText?.(text);
    emit({ t: "text", text });
    const out: BotAnswer = {
      bot: { slug: bot.slug, name: bot.name, colour: bot.colour, builtin: bot.ownerId === null },
      text, paise: 0, tools: [], approvals: [], artifacts: [], opens: [], notes: [], ...(r.pickedBy ? { pickedBy: r.pickedBy } : {}), ms: now() - t0,
    };
    emit({ t: "result", result: out });
    return out;
  }

  const history = r.history?.length ? r.history : remember && !r.fresh ? recentTurnsOf(mem.thread) : [];
  let answer;
  try {
    answer = await worker.answer({ message: r.message, history, sky, person, route, session: sessionOf(r.userId) },
      (e) => { if (e.t === "status") emit(e); else r.onText?.(e.text); }, r.signal);
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
    const message = err instanceof OracleUnavailable ? err.message : "The Oracle couldn't be reached just now. Nothing was lost; try again in a moment.";
    throw new BotError("model_down", message, 503);
  }
  await store.setRoute(r.userId, answer.route ?? null, now()).catch(() => undefined);

  let paise = usdToPaise(answer.usd, d.oracle?.fx ?? DEFAULT_USD_INR);
  const clean = scrub(answer.text || "I couldn't put an answer together. Ask it a little differently.");
  if (clean.cleaned) { notes.push("Part of the reply was left out: it looked like it held a secret."); r.onReset?.(); }
  const text = clean.text;
  if (answer.cast?.picks.length) {
    notes.push(`Drawn for you (${answer.cast.title}): ${answer.cast.picks.map((p) => `${p.position}, ${p.name}${p.reversed ? " reversed" : ""}`).join("; ")}.`);
  }
  emit({ t: "text", text });

  if (remember && !r.signal?.aborted) {
    const learned = await rememberTurn(
      { store: d.store, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), ...(d.now ? { now: d.now } : {}), ...(d.shared ? { shared: d.shared } : {}) },
      { userId: r.userId, botId: bot.id, said: r.message, answered: text, leftPaise: Math.max(0, r.capPaise - paise), ...(r.signal ? { signal: r.signal } : {}) },
    ).catch(() => null);
    if (learned) paise += learned.paise;
  }

  const out: BotAnswer = {
    bot: { slug: bot.slug, name: bot.name, colour: bot.colour, builtin: bot.ownerId === null },
    text, paise, tools: [], approvals: [], artifacts: [], opens: [], notes: [...new Set(notes)],
    ...(r.pickedBy ? { pickedBy: r.pickedBy } : {}), ms: now() - t0,
  };
  emit({ t: "result", result: out });
  return out;
}
