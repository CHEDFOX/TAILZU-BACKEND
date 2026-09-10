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
 * So the dimensions below are the ones a linguist would use to describe an
 * individual's idiolect, and the prohibitions are the things that would be
 * profiling rather than portraiture.
 */

/** The observable dimensions of one person's writing, in prompt form. */
export const PORTRAIT_DIMENSIONS = [
  "REGISTER — where they sit between formal and casual, and how far they move when the audience changes.",
  "DIRECTNESS — whether they lead with the ask or arrive at it, and how much they hedge before committing to it.",
  "DISTANCE — how they are polite: warmth and solidarity, or deference and apology, or neither because they are simply plain.",
  "ORDER — headline first, or context first and the point at the end.",
  "SHAPE — sentence length, how many clauses they run together, whether they use fragments.",
  "LEXICON — the words and phrases they actually reach for, quoted exactly and in their own script.",
  "TYPOGRAPHY — capitalisation, commas, dashes, ellipses, exclamation marks, emoji.",
  "FRAMING — how they open and close, whether they greet, whether they use the person's name, whether they sign off.",
  "SWITCHING — which languages they mix, when they switch, and which script they write each in.",
  "ELLIPSIS — what they leave unsaid because they assume it is understood.",
].join("\n");

/**
 * The line that keeps a portrait a portrait.
 *
 * Without it a writing model asked to describe someone will reach for
 * character judgement — it is what "describe this person" means in most of
 * its training data. Every clause here rules out a specific thing that turned
 * up when this was left implicit.
 */
export const PORTRAIT_BOUNDS = [
  "Write only what is visible in the text itself. Every line must be something another reader could check against the same messages.",
  "Never infer or record personality traits, mood, mental state, intelligence, age, gender, politics, health or circumstances. None of that is reliable from writing, none of it tells you how to write a sentence, and it would be kept and acted on for months.",
  "Never judge them. Not their grammar, not their spelling, not their taste. You are describing a voice so it can be reproduced, not assessing one.",
  "Say nothing about the training, the conversation, or how you learned any of it.",
].join(" ");

/** The output contract, shared so the three writers cannot drift on it. */
export function portraitJsonContract(trainingTone?: string): string {
  return (
    'Return ONLY JSON: {"core": "≤130 words, tone-independent, the dimensions above in plain prose"' +
    (trainingTone
      ? `, "toneNote": "≤40 words, only what is specific to their '${trainingTone}' voice"`
      : "") +
    "}."
  );
}

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
