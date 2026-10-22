/**
 * THE ASSISTANT'S WORDS: connected apps, tasks and the confirm card, in the
 * two voices of the approved design (the EN and HG copy objects of the
 * assistant prototype). One table, so a word is the same on every surface:
 * Connect, Can look / Can draft / Can send, Approve, Not now.
 *
 * The bot speaks as "I": warm and short, says what it will do and what it
 * won't, never blames. A few lines are the design's own with the one thing
 * that varies made a {slot}.
 *
 * Two ways in:
 *   - The desk's pages are built in English and translated for the person's
 *     language like every other desk string (experience/i18n.ts). For
 *     Hinglish that translation would be a model's guess at words that already
 *     have a written form here, so `HINGLISH_SEEDS` hands i18n the design's
 *     own, line for line, for every app the catalog knows.
 *   - The confirm card travels in the agent's stream, which nothing
 *     localizes, so `wordsFor(language)` picks the voice there.
 */

export type WordKey = keyof typeof EN;

export const EN = {
  // Connected apps
  "apps.h": "Connected apps",
  "apps.p": "What I can reach, and how far I can go.",
  connect: "Connect",
  "st.ok": "Connected",
  "st.re": "Sign in again",
  "st.no": "Not connected",
  "lv.look": "Can look",
  "lv.look.d": "I can read, but I never change anything.",
  "lv.draft": "Can draft",
  "lv.draft.d": "I write drafts for you. Nothing goes out.",
  "lv.send": "Can send",
  "lv.send.d": "I can send for you, the way you’ve approved.",
  "a2.q": "How far can I go in {app}?",
  "a2.foot": "Change this any time. If you disconnect, my access ends right away.",
  "a2.dis": "Disconnect {app}",
  "link.ph": "Paste the link {app} gave you",
  "err.level": "I couldn’t change that. Try again.",
  "err.connect": "I couldn’t start that. Try again.",
  "err.generic": "That didn’t work. Try again.",
  // Tasks
  "a4.h": "Tasks",
  "tasks.h": "What I’m doing in your apps",
  "a4.w": "Waiting for you",
  "a4.r": "Running",
  "a4.d": "Done",
  "a4.wm": "{app} · needs your OK",
  "a4.end": "That’s everything.",
  "tasks.empty": "Nothing yet. Ask me to do something in your apps, and it shows up here.",
  // The confirm card
  "a3.ok": "Approve",
  "a3.edit": "Edit",
  "a3.later": "Not now",
  "a3.h.send": "Ready to send?",
  "a3.h.write": "Ready to make this change?",
  "a3.h.destructive": "Ready to delete this?",
  "a3.h.pay": "Ready to pay?",
  "a3.lab.send": "The exact message",
  "a3.lab.other": "The exact change",
  "a3.wwl": "I’ll do this in {app}, as you. I won’t do anything else.",
  "a3.done": "Done ✓",
  "a3.left": "Okay, I left it.",
  "a3.failed": "That didn’t go through.",
  "a3.change": "What should I change?",
  // The phone's own lines (the design's, plus the few it needs that the desk does not)
  "s6.sug": "Suggested for you",
  "s6.more": "More apps",
  "apps.off": "I can’t reach your apps just yet.",
  "apps.update": "Update Tailzu to connect an app from your phone.",
  "a3.none": "Nothing is waiting for you right now.",
  "a3.reason": "Approve this in {app}",
  "a3.nobio": "No Face ID or fingerprint is set up on this phone, so I’ll just ask once more.",
  // The email hand-off: Gmail opened with the email written; the person sends it.
  "mail.done": "I've written it in Gmail. Check it and hit Send.",
  "mail.open": "Open in Gmail",
} as const;

export const HG: Record<WordKey, string> = {
  "apps.h": "Jude hue apps",
  "apps.p": "Main kahan tak pahunch sakta hoon, aur kitna kar sakta hoon.",
  connect: "Jodo",
  "st.ok": "Jud gaya",
  "st.re": "Dobara sign in karo",
  "st.no": "Jura nahi",
  "lv.look": "Dekh sakta hoon",
  "lv.look.d": "Main padh sakta hoon, kuch badalta nahi.",
  "lv.draft": "Draft kar sakta hoon",
  "lv.draft.d": "Main draft likhta hoon. Kuch bahar nahi jaata.",
  "lv.send": "Bhej sakta hoon",
  "lv.send.d": "Aapke approve kiye tareeke se main bhej sakta hoon.",
  "a2.q": "{app} mein main kitna kar sakta hoon?",
  "a2.foot": "Kabhi bhi badlo. Disconnect karte hi meri pahunch turant band.",
  "a2.dis": "{app} hatao",
  "link.ph": "{app} ne jo link diya hai, woh paste karo",
  "err.level": "Yeh nahi badal paaya. Dobara try karo.",
  "err.connect": "Yeh shuru nahi ho paaya. Dobara try karo.",
  "err.generic": "Yeh nahi hua. Dobara try karo.",
  "a4.h": "Kaam",
  "tasks.h": "Aapke apps mein main kya kar raha hoon",
  "a4.w": "Aapka intezaar",
  "a4.r": "Chal rahe hain",
  "a4.d": "Ho gaye",
  "a4.wm": "{app} · aapki haan chahiye",
  "a4.end": "Bas, itna hi.",
  "tasks.empty": "Abhi kuch nahi. Apne apps mein kuch karne ko bolo, yahin dikhega.",
  "a3.ok": "Approve karo",
  "a3.edit": "Badlo",
  "a3.later": "Abhi nahi",
  "a3.h.send": "Bhejne ke liye taiyaar?",
  "a3.h.write": "Yeh badlav karne ke liye taiyaar?",
  "a3.h.destructive": "Yeh hatane ke liye taiyaar?",
  "a3.h.pay": "Payment karne ke liye taiyaar?",
  "a3.lab.send": "Bilkul yahi message",
  "a3.lab.other": "Bilkul yahi badlav",
  "a3.wwl": "Main yeh {app} mein aapke naam se karunga. Aur kuch nahi karunga.",
  "a3.done": "Ho gaya ✓",
  "a3.left": "Theek hai, chhod diya.",
  "a3.failed": "Yeh nahi ho paaya.",
  "a3.change": "Kya badlun?",
  "s6.sug": "Aapke liye",
  "s6.more": "Aur apps",
  "apps.off": "Abhi main aapke apps tak nahi pahunch sakta.",
  "apps.update": "Phone se app jodne ke liye Tailzu update karo.",
  "a3.none": "Abhi aapka intezaar karne wala kuch nahi hai.",
  "a3.reason": "Ise {app} mein approve karo",
  "a3.nobio": "Is phone mein Face ID ya fingerprint set nahi hai, isliye main ek baar aur poochhunga.",
  "mail.done": "Maine Gmail mein likh diya hai. Check karo aur Send dabao.",
  "mail.open": "Gmail mein kholo",
};

/** Hinglish is the one voice with its own table; every other language reads English. */
export const isHinglish = (language: string | undefined): boolean => /^hinglish\b/i.test((language ?? "").trim());

/** The word table for a language, as a function: `w("connect")`, `w("a2.q", { app: "Gmail" })`. */
export function wordsFor(language?: string): (key: WordKey, vars?: Record<string, string>) => string {
  const table: Record<WordKey, string> = isHinglish(language) ? HG : EN;
  return (key, vars) => fill(table[key] ?? EN[key], vars);
}

/** The English words, for the pages translated afterwards. */
export const en = wordsFor("en");

function fill(s: string, vars?: Record<string, string>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m) : s;
}

/**
 * English line -> the design's Hinglish line, for the translator to use as it
 * is. A line with an {app} slot is written out for each app named, since the
 * translator is asked about whole strings.
 */
export function hinglishSeeds(appNames: readonly string[]): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const key of Object.keys(EN) as WordKey[]) {
    const from = EN[key] as string;
    if (from.includes("{app}")) {
      for (const app of appNames) seeds.set(fill(from, { app }), fill(HG[key], { app }));
    } else {
      seeds.set(from, HG[key]);
    }
  }
  return seeds;
}
