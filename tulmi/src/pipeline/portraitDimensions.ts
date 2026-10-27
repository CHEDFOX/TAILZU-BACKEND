/**
 * What a portrait is allowed to notice, and what it is not.
 *
 * ONE LIST, read by all three writers. There used to be three: the picking
 * path looked for "length, punctuation, warmth, directness, emoji, phrasing
 * habits", the spoken path looked for "sentence length, directness, warmth,
 * humour, openings and closings, the words they reach for", and both then
 * overwrote the same field. A spoken session silently dropped whatever the
 * picking path had learned about punctuation, because its prompt had never
 * been told punctuation mattered.
 *
 * THE PSYCHOLOGY IS PRAGMATICS, NOT PERSONALITY. The ask was for a portrait
 * that replicates the person, built with real behavioural understanding, and
 * the honest form of that is not a trait diagnosis. Two reasons, and the
 * second is the stronger one:
 *
 *   Text does not carry a reliable trait signal. Inferring that someone is
 *   anxious or disagreeable from forty messages produces a confident guess
 *   with no way to be wrong, and it would be stored and acted on for months.
 *
 *   And a trait would not help. "Conscientious" does not tell a writing model
 *   whether to open with a greeting. What determines the sentence that comes
 *   out is how this person handles register, distance, hedging, order and
 *   emphasis — the pragmatics of how they actually talk to people. That IS
 *   the behavioural layer, it is observable in every message, and every item
 *   of it changes a word on the screen.
 *
 * So the dimensions (principles/roles.ts, in the portrait roles) are the ones a linguist would use to describe an
 * individual's idiolect, and the prohibitions are the things that would be
 * profiling rather than portraiture.
 */

// THE LISTS THEMSELVES ARE IN THE ROLES. The dimensions, the bounds and the
// fields of the portrait are the stable text of the three portrait roles
// (principles/roles.ts: portrait_update, portrait_transcript, portrait_usage),
// one copy read by all three, so a cache holds them and they cannot drift.
// What is left here is what is not the same twice: how much evidence is behind
// the portrait a call is given (below), and the reader of what comes back.

/**
 * The portrait's own provenance, told to the writer that is about to rewrite it.
 *
 * Without this, every rewrite treats the existing portrait as an equal — a
 * first impression from one afternoon and a habit confirmed across fifty
 * sittings arrive looking identical, so a single odd session can overturn
 * months of evidence. Telling it how much is behind what it is reading is what
 * turns "rewrite this" into "revise this, and know what you are revising".
 *
 * The thresholds are deliberately coarse. The writer needs to know whether it
 * is sketching or amending, and there is no useful third state between them.
 */
export function portraitProvenance(p: {
  sessions?: number;
  examples?: number;
  firstSeenAt?: string;
} | undefined): string {
  const sessions = p?.sessions ?? 0;
  const trained = p?.examples ?? 0;
  if (!sessions && !trained) {
    return "This is the FIRST thing you have ever seen of this person. Write only what this evidence actually shows and leave the rest out — an invented habit will be read back on every message they send until something contradicts it.";
  }

  const days = p?.firstSeenAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(p.firstSeenAt)) / 86_400_000))
    : 0;
  const span =
    days >= 60 ? `over about ${Math.round(days / 30)} months`
    : days >= 14 ? `over about ${Math.round(days / 7)} weeks`
    : days >= 1 ? `over ${days} day${days === 1 ? "" : "s"}`
    : "today";

  const history =
    `The portrait you are given was built from ${sessions} sitting${sessions === 1 ? "" : "s"} ` +
    `${span}${trained ? `, plus ${trained} round${trained === 1 ? "" : "s"} where they picked between versions of their own writing` : ""}.`;

  // Under five sittings the existing text is one or two afternoons of evidence
  // and should bend easily. Past that it has survived repetition, and the bar
  // for overturning a line is that this session contradicts it MORE THAN ONCE.
  const weight =
    sessions < 5
      ? "That is still a sketch. Revise it freely where this evidence disagrees, and drop anything it does not support."
      : "That is a lot of evidence, and most of it is no longer in front of you. Treat what is already written as established: keep it unless this session contradicts it repeatedly, and change a line for one counter-example only if that example is unmistakable. Add what is genuinely new.";

  return `${history} ${weight}`;
}

/** Everything a portrait writer may return. */
export interface PortraitDraft {
  core?: string;
  words?: Array<{ term: string; means: string }>;
  styles?: Array<{ name: string; when: string }>;
  rhythms?: Array<{ when: string; vibe: string }>;
  toneNote?: string;
}

const cap = (v: unknown, n: number): string =>
  typeof v === "string" ? v.trim().slice(0, n) : "";

/** Read a writer's JSON reply into a draft, keeping only what is well-formed.
 *  A malformed field is dropped rather than defaulted — a portrait with a
 *  missing part is fine, a portrait with an invented one is not. */
export function parsePortraitDraft(raw: string): PortraitDraft {
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  const list = <T>(v: unknown, take: (o: Record<string, unknown>) => T | null, max: number): T[] =>
    Array.isArray(v)
      ? v
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map(take)
          .filter((x): x is T => x !== null)
          .slice(0, max)
      : [];

  return {
    core: cap(json.core, 1_100) || undefined,
    words: list(json.words, (o) => {
      const term = cap(o.term, 60);
      const means = cap(o.means, 140);
      return term && means ? { term, means } : null;
    }, 12),
    styles: list(json.styles, (o) => {
      const name = cap(o.name, 40);
      const when = cap(o.when, 120);
      return name ? { name, when } : null;
    }, 4),
    rhythms: list(json.rhythms, (o) => {
      const when = cap(o.when, 40);
      const vibe = cap(o.vibe, 140);
      return when && vibe ? { when, vibe } : null;
    }, 3),
    toneNote: cap(json.toneNote, 300) || undefined,
  };
}

/**
 * The most recent 40 words a portrait may carry.
 *
 * Somebody's lexicon does not stop growing, but the prompt it rides on does.
 * Newest first, because a word learned this month is likelier to be live than
 * one learned in March — and because the alternative, dropping the newest, would
 * mean the list stops learning the moment it fills up.
 */
export const MAX_PORTRAIT_WORDS = 40;

/**
 * Fold a new pass into the words already known.
 *
 * ACCUMULATE, don't replace. This is the one part of the portrait that must
 * survive a session it did not come up in: someone's slang is learned a word
 * at a time over months, and a rewrite-from-scratch forgets every term that
 * happened not to appear in the last forty messages.
 *
 * A repeat updates the meaning rather than duplicating the entry, because the
 * later reading is the better-evidenced one — and it moves to the front, since
 * being used again is what makes a word current.
 */
export function mergePortraitWords(
  existing: Array<{ term: string; means: string }> | undefined,
  incoming: Array<{ term: string; means: string }> | undefined,
): Array<{ term: string; means: string }> {
  const out: Array<{ term: string; means: string }> = [];
  const seen = new Set<string>();
  for (const w of [...(incoming ?? []), ...(existing ?? [])]) {
    const key = w.term.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ term: w.term.trim(), means: w.means.trim() });
    if (out.length >= MAX_PORTRAIT_WORDS) break;
  }
  return out;
}
