/**
 * WHAT A PERSON TOLD ANY OF THEIR BOTS ABOUT THEMSELVES, KEPT ONCE FOR ALL OF THEM.
 *
 *   learnShared(userId, facts, now)   a fact a bot kept (memory.ts) is kept here too, unless it touches a sensitive topic or the switch is off
 *   sharedFacts(userId, about)         the few that matter to this message, for a bot's, Ask's or Xode's prompt
 *   forgetSharedTexts(userId, texts)   a fact forgotten in a bot is forgotten here too
 *   clearShared(userId)                Settings › Privacy › Clear
 *
 * Kept in bot_facts under the reserved id "_you": no bot can have it (a slug has no underscore, a made bot's id is a uuid), so deleting the
 * person's data, deleting the account and the export already cover it. Off when the person turns off Settings › Privacy "Use what you've told
 * your bots" (privacy.personalise, on by default): nothing is learned and nothing is shown. Never kept: health, religion or caste, politics,
 * money, sexuality, on top of what every fact already passes (usableFact: no secret, no instruction to a bot). At most 60 kept, the oldest go
 * first; at most 6 shown, the ones sharing words with the message first, then the newest, so a prompt carries a few short lines, not a profile.
 *
 * Only a chat with the person themselves learns or reads this: a bot's API callers are the owner's customers and never see it.
 */
import { youStore } from "../you/store.js";
import { botStore, type BotStore } from "./store.js";

export const SHARED_ID = "_you";
export const SHARED_KEEP = 60;
export const SHARED_SHOWN = 6;
const CACHE_MS = 30_000;
const CACHE_MAX = 1000;

export interface SharedDeps {
  store?: BotStore;
  /** Is the switch on for this person? The You store's privacy.personalise when not given. */
  on?: (userId: string) => Promise<boolean>;
}

/** The topics a shared fact never touches. A false alarm only means one fact is not shared. */
const SENSITIVE: readonly RegExp[] = [
  /\b(?:health|illness|sick|disease|disorder|diagnos\w*|doctors?|hospital\w*|surgery|therap\w*|medic\w*|pills?|prescri\w*|pregnan\w*|diabet\w*|cancer|asthma|allerg\w*|blood\s+(?:pressure|sugar)|thyroid|pcos|depress\w*|anxiety|adhd|autis\w*|bipolar|ocd|ptsd|mental|disab\w*|hiv|injur\w*)\b/i,
  /\b(?:relig\w*|god|allah|bhagwan|pray\w*|puja|pooja|namaz|temples?|mosques?|church\w*|gurudwara|hindu\w*|muslims?|islam\w*|christian\w*|sikh\w*|jain\w*|buddhis\w*|jew|jewish|atheist|caste|brahmin|dalit|obc)\b/i,
  /\b(?:politic\w*|vot(?:e|ed|es|er|ers|ing)|elections?|bjp|congress|left[-\s]wing|right[-\s]wing|liberal|conservative|leftist|democrat\w*|republican\w*)\b/i,
  /(?:[₹$€£]|\brs\.?\s*\d|\b(?:inr|rupees?|lakhs?|crores?|salary|income|earn(?:s|ed|ing)?|ctc|loans?|debts?|emi|banks?|credit\s+card|debit\s+card|upi|net\s+worth|savings?|invest\w*|stocks?|mutual\s+funds?|crypto|bitcoin|tax(?:es)?|budget)\b)/i,
  /\b(?:sexual\w*|sex|gay|lesbian|bisexual|queer|transgender)\b/i,
];

export function sensitive(text: string): boolean {
  return SENSITIVE.some((re) => re.test(text));
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "and", "for", "are", "was", "you", "your", "with", "that", "this", "what", "how", "can", "but", "not", "have", "has", "from", "they", "their", "them", "who", "why", "when", "where", "which", "will", "would", "should", "could", "about", "into", "like", "just", "also", "than", "then", "there", "here", "some", "any", "all", "our", "out", "its", "it's", "i'm", "kya", "hai", "hain", "aur", "mera", "meri", "mere", "mujhe", "kaise", "karo", "karna"]);
const wordsOf = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []).filter((w) => !STOP.has(w)));

/** The n facts that matter most to `about`: the ones sharing words with it first, then the newest. */
export function pickFacts(facts: ReadonlyArray<{ text: string; createdAt: number }>, about: string, n = SHARED_SHOWN): string[] {
  const want = wordsOf(about);
  return facts
    .map((f, i) => ({ f, i, hit: [...wordsOf(f.text)].filter((w) => want.has(w)).length }))
    .sort((a, b) => b.hit - a.hit || b.f.createdAt - a.f.createdAt || b.i - a.i)
    .slice(0, n).map((x) => x.f.text);
}

// A person asks many things in a row: the switch and the facts are read once a half minute, and a change made here drops the copy at once.
const cache = new Map<string, { at: number; on: boolean; facts: Array<{ text: string; createdAt: number }> }>();
export function dropSharedCache(userId?: string): void {
  if (userId === undefined) cache.clear(); else cache.delete(userId);
}

async function switchOn(userId: string, d: SharedDeps): Promise<boolean> {
  if (d.on) return d.on(userId);
  return (await youStore().getSettings(userId)).privacy.personalise !== false;
}

/** Keeps what a bot just learned, for every bot. Returns what was kept. */
export async function learnShared(userId: string, facts: readonly string[], now: number, d: SharedDeps = {}): Promise<string[]> {
  const fit = facts.filter((f) => !sensitive(f));
  if (!fit.length || !(await switchOn(userId, d))) return [];
  const added = await (d.store ?? botStore()).addFacts(userId, SHARED_ID, fit, SHARED_KEEP, now);
  dropSharedCache(userId);
  return added.map((f) => f.text);
}

/** The few shared facts for a prompt about `about`; none when the switch is off or the store can't be read. */
export async function sharedFacts(userId: string, about: string, d: SharedDeps = {}, n = SHARED_SHOWN, now = Date.now()): Promise<string[]> {
  try {
    const store = d.store ?? botStore();
    // Only the server's own store, read through the You store's switch, is kept a half minute (a test's stand-ins are read each time).
    const keep = !d.on && store === botStore();
    let hit = keep ? cache.get(userId) : undefined;
    if (!hit || now - hit.at > CACHE_MS) {
      const on = await switchOn(userId, d);
      const facts = on ? (await store.listFacts(userId, SHARED_ID)).map((f) => ({ text: f.text, createdAt: f.createdAt })) : [];
      hit = { at: now, on, facts };
      if (keep) {
        cache.delete(userId);
        cache.set(userId, hit);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      }
    }
    return hit.on ? pickFacts(hit.facts, about, n) : [];
  } catch {
    return [];
  }
}

/** The shared copies of facts the person forgot in one bot. */
export async function forgetSharedTexts(userId: string, texts: readonly string[], d: SharedDeps = {}): Promise<number> {
  if (!texts.length) return 0;
  const store = d.store ?? botStore();
  const gone = new Set(texts.map(norm));
  let n = 0;
  for (const f of await store.listFacts(userId, SHARED_ID)) if (gone.has(norm(f.text)) && (await store.dropFact(userId, SHARED_ID, f.id))) n += 1;
  dropSharedCache(userId);
  return n;
}

/** Every shared fact, gone. */
export async function clearShared(userId: string, d: SharedDeps = {}): Promise<number> {
  const r = await (d.store ?? botStore()).clearMemory(userId, SHARED_ID);
  dropSharedCache(userId);
  return r.facts;
}

/** The facts as the prompts show them: a short block, each line fenced as data by the caller. */
export function aboutLines(facts: readonly string[]): string {
  return facts.map((f) => `- ${f}`).join("\n");
}
