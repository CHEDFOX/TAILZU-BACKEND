/**
 * KEYBOT'S OWN CHOICES: what the Keylessbord pages of the Bots app let a person pick that has no field in the personality
 * document (shared/types/api.ts, which every other screen reads too):
 *
 *   tones      per kind of app (Chats, Mail, Work chat): the preset chosen and its little things. The writer reads
 *              none of this: choosing one compiles it into personality.appStyles (tones.ts), which it does read.
 *   read       read-aloud speed, which /v1/speak reads at (readSpeed). "Read new messages aloud while driving" and
 *              "Read my draft back before sending" were here too and are gone: nothing on the phone or the server
 *              could act on them, so the pages no longer offer them.
 *   keyboard   the phone keyboard's look, haptics strength, key height, key sounds, hold space to speak, where the
 *              Keylessbord key sits. Haptics on/off is also written to personality.hapticsAll; the rest reaches the
 *              keyboard through GET /v1/keyboard/config (keyboard.ts lays it over the config).
 *   train      Teach your style: what they said for each of the ten lines, and the ones they skipped
 *
 * One JSON document per person in `keybot_prefs` (migration 0043), through the person's own token or the service key,
 * like the personality store; with no database, a map in memory, so the pages work end to end in development.
 * GET /v1/bots/keybot/prefs hands it to any client that wants to follow it (routes/botsKeybot.ts).
 */
import { z } from "zod";
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";

export const TONE_GROUPS = ["chats", "mail", "work"] as const;
export type ToneGroup = (typeof TONE_GROUPS)[number];

const tone = z.object({
  preset: z.string().max(40).optional(),
  /** Skip the full stop at the end. */
  noStop: z.boolean().optional(),
  /** Hindi words in English letters. */
  latin: z.boolean().optional(),
  /** Add their sign-off. */
  signOff: z.boolean().optional(),
}).strict();

/** What a client may change (PUT /v1/bots/keybot/prefs): any part, merged into what is there. */
export const prefsPatchSchema = z.object({
  tones: z.object({ chats: tone.optional(), mail: tone.optional(), work: tone.optional() }).strict().optional(),
  read: z.object({
    speed: z.enum(["0.8", "1", "1.25", "1.5"]).optional(),
  }).strict().optional(),
  keyboard: z.object({
    look: z.enum(["light", "dark"]).optional(),
    haptics: z.enum(["off", "light", "strong"]).optional(),
    height: z.enum(["short", "normal", "tall"]).optional(),
    /** Not set: the phone decides (keyboard.ts). The page's On / Off arrive as "on" / "off". */
    sounds: z.preprocess((v) => (v === "on" ? true : v === "off" ? false : v), z.boolean()).optional(),
    holdSpace: z.boolean().optional(),
    keyAt: z.enum(["left", "right", "top"]).optional(),
  }).strict().optional(),
}).strict();

export type PrefsPatch = z.infer<typeof prefsPatchSchema>;

export interface KeybotPrefs extends PrefsPatch {
  /** Teach your style: line index → what they said for it; the lines they skipped. */
  train?: { said?: Record<string, string>; skipped?: number[] };
  /** The kind of app whose tone was changed last: Tone per app opens on it. */
  toneFocus?: ToneGroup;
  updatedAt?: string;
}

/** The read-aloud speed as a rate, 1 = normal. */
export function readSpeed(prefs: KeybotPrefs): number {
  const n = Number(prefs.read?.speed ?? "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** A patch over what is there, one level into each part (a tone's group two). */
export function mergePrefs(cur: KeybotPrefs, patch: PrefsPatch): KeybotPrefs {
  const next: KeybotPrefs = { ...cur };
  if (patch.tones) {
    const tones = { ...(cur.tones ?? {}) };
    for (const g of TONE_GROUPS) if (patch.tones[g]) tones[g] = { ...(tones[g] ?? {}), ...patch.tones[g] };
    next.tones = tones;
  }
  if (patch.read) next.read = { ...(cur.read ?? {}), ...patch.read };
  if (patch.keyboard) next.keyboard = { ...(cur.keyboard ?? {}), ...patch.keyboard };
  return next;
}

// ------------------------------------------------------------------ the store

const memory = new Map<string, KeybotPrefs>();
const locks = new Map<string, Promise<unknown>>();

/** One read-modify-write at a time per person, so two quick taps both land. */
async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => gate);
  locks.set(userId, tail);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(userId) === tail) locks.delete(userId);
  }
}

export async function getPrefs(user: AuthedUser): Promise<KeybotPrefs> {
  const sb = dataClientFor(user);
  if (!sb) return memory.get(user.id) ?? {};
  const { data, error } = await sb.from("keybot_prefs").select("data").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(`[keybot] prefs load failed for ${user.id}:`, error.message);
    return {};
  }
  return (data?.data as KeybotPrefs) ?? {};
}

async function savePrefs(user: AuthedUser, prefs: KeybotPrefs): Promise<void> {
  const sb = dataClientFor(user);
  if (!sb) {
    memory.set(user.id, prefs);
    return;
  }
  const { error } = await sb.from("keybot_prefs")
    .upsert({ user_id: user.id, data: prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`Failed to save Keylessbord prefs: ${error.message}`);
}

/** Change the document under the person's lock; returns what was saved. */
export async function updatePrefs(user: AuthedUser, mutate: (cur: KeybotPrefs) => KeybotPrefs): Promise<KeybotPrefs> {
  return withLock(user.id, async () => {
    const next = { ...mutate(await getPrefs(user)), updatedAt: new Date().toISOString() };
    await savePrefs(user, next);
    return next;
  });
}
