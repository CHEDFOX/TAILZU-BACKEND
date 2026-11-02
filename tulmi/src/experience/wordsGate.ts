/**
 * The free plan's word allowance as the app shows it: the gate's numbers and its words.
 */

/**
 * The card the app opens with — the one place to say something to everybody.
 *
 * A new feature to point at, a setup step never finished, an offer running
 * this week. It is a node tree, so there is no card shape to work around: a
 * line and a button, or art and three choices, are the same amount of work
 * here and none at all in the app.
 *
 * TO SHOW A CARD, write one and give it an id nobody has seen. To stop
 * showing it, set this to null. Changing the words of a card people have
 * already seen shows nobody anything — the id is the showing, not the
 * content, so a second announcement needs a second id.
 *
 * Null by default. An app that greets everyone with a card on the day they
 * install it has spent the one moment it had.
 */
/**
 * THE FREE-WORD GATE — every mark, every line and every threshold, in one
 * object, so all of it is edited here and none of it can fall out of step.
 *
 * It used to be a list of numbers beside a map of copy keyed by those exact
 * numbers. That reads fine and is a trap: retuning a mark without editing the
 * map left the lookup undefined and threw on the next bootstrap — for every
 * user at once, from a change that looked like editing a number. One entry
 * carrying its own words cannot do that.
 *
 * COPY IS TEMPLATED, not computed in code. `{used}`, `{left}`, `{total}` and
 * `{streak}` are filled with the reader's own figures, already grouped for
 * their locale. So changing what a card says — including which numbers it
 * says — is editing a string, and a card that mentions no numbers simply
 * mentions none.
 */
export const WORDS_GATE = {
  /**
   * Where a card is worth showing, and what it says there.
   *
   * `at` is a count of words used. Not evenly spaced and not round, because
   * each is a different sentence rather than a step on a meter:
   *
   *   222  the first point where using it is clearly a habit and not a trial.
   *        Early enough to read as news rather than as a bill.
   *   446  about halfway. The only one of the three that is a fact rather
   *        than a nudge, and worth saying plainly.
   *   732  close enough that the next few days decide it — the last moment a
   *        person can act BEFORE being stopped, which is the difference
   *        between an offer and a toll gate.
   *
   * Order does not matter; the latest mark passed is the one that shows.
   * Adding a fourth is one entry. Removing one is deleting it.
   */
  milestones: [
    {
      at: 222,
      kicker: "222 words",
      title: "It is writing for you now",
      body: "That is a habit, not a trial. {left} free words left this month.",
    },
    {
      at: 446,
      kicker: "Halfway",
      title: "Half your free words",
      body: "{used} used, {left} left. Coming back each day earns more.",
    },
    {
      at: 732,
      kicker: "{left} left",
      title: "The month is nearly up",
      body: "Upgrade now and nothing stops mid-sentence.",
    },
  ],
  /** On every milestone card. The way in, and the way out that is not buying. */
  cta: "See plans",
  dismiss: "Not now",
  /** Where both the cards and the out-of-words screen send someone. */
  paywallScreenId: "paywall",
  /** The screen the keyboard's mic diverts to. Named here so the destination
   *  can move without a keyboard build. */
  outScreenId: "words_out",
  /**
   * WHEN THE KEYBOARD CALLS IT "NEARLY OUT".
   *
   * A share of the month's ceiling, floored at a fixed count — a tenth of
   * 2,900 earned words is a warning that arrives while there is still a week
   * of writing left, and a tenth of a small ceiling is not enough words to
   * act on. The floor is roughly one real message, which is what the warning
   * has to be worth to be worth showing.
   */
  lowShare: 0.1,
  lowFloor: 40,
  /** The out-of-words screen. Same templating as the cards. */
  out: {
    kicker: "Out of words",
    title: "That is the month",
    body: "You have used all {total} of your free words. The keyboard still types — it just cannot write for you until they come back.",
    /** Shown only when there IS a streak. "0 days" is not encouragement. */
    streakNote: "{streak} days running. Coming back keeps earning words — upgrading stops the counting.",
    meter: "{used} of {total} used",
    cta: "Get more words",
    back: "Back to typing",
  },
  /** What the keyboard's status line says when it cannot open the app. */
  keyboardStatus: "Out of free words — open X0 Bot to get more.",
};

/**
 * Fill {used} / {left} / {total} / {streak} in a line of gate copy.
 *
 * Numbers are grouped before they land, so a template never has to think
 * about it and a line that mentions no numbers is returned untouched.
 */
export function wordsCopy(
  line: string,
  figures: { used: number; total: number; streak?: number },
): string {
  const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-US");
  return line
    .replaceAll("{used}", n(figures.used))
    .replaceAll("{left}", n(figures.total - figures.used))
    .replaceAll("{total}", n(figures.total))
    .replaceAll("{streak}", n(figures.streak ?? 0));
}
