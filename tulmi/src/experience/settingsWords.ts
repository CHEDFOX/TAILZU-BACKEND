/**
 * THE WORDS OF SETTINGS, THE EMPTY STATES AND THE TAB LABELS, in the voice the
 * new onboarding speaks (onboard.ts): short, warm, honest, and "I" for Tailzu.
 *
 * English is written once here, with its Hinglish beside it, so both screens
 * that draw Settings (the phone's, catalog.ts, and the desk's, desk.ts) say
 * the same thing and the translator is never left to guess at them: the
 * Hinglish below is used as written, the way the onboarding's own is
 * (settingsHinglishSeeds, applied by i18n.ts to the screens that use these).
 *
 * `sentence` marks a line drawn as a sentence, not a label. The phone starts
 * every word of its own LABELS with a capital (titleCase.ts); a sentence
 * opts out with `props.keepCase`, as the onboarding does, so it reads as it
 * was written. The desk keeps sentence case everywhere.
 *
 * This file imports only the capitalising pass, so desk.ts (which must not
 * import the catalog) can use it.
 */
import { titleCase } from "./titleCase.js";

export interface Line {
  en: string;
  hg: string;
  sentence?: true;
}

const label = (en: string, hg: string): Line => ({ en, hg });
const sentence = (en: string, hg: string): Line => ({ en, hg, sentence: true });

export const SW = {
  // ---- the five sections (phone and desk) -------------------------------------
  "you.h": label("You", "Aap"),
  "you.p": sentence("Your account and your plan.", "Aapka account aur aapka plan."),
  "write.h": label("Writing", "Likhna"),
  "write.p": sentence("How I write for you.", "Main aapke liye kaise likhta hoon."),
  "comp.h": label("This computer", "Yeh computer"),
  "comp.p": sentence("How I listen on this one.", "Main is par kaise sunta hoon."),
  "priv.h": label("Privacy and data", "Privacy aur data"),
  "priv.p": sentence("I delete your audio as soon as I’ve written it.", "Likhte hi main aapki audio delete kar deta hoon."),
  "help.h": label("Help and about", "Madad aur jaankari"),
  "help.p": sentence("Questions and the fine print.", "Sawaal aur zaroori baatein."),

  // ---- the rows (phone and desk) ----------------------------------------------
  "r.lang": label("Languages", "Bhashayein"),
  "r.lang.none": label("Found as you talk", "Bolte bolte pata chalega"),
  "r.tone": label("Voice and tone", "Awaaz aur andaaz"),
  "r.tone.d": sentence("Same words, in the voice you choose.", "Wahi shabd, aapki chuni hui awaaz mein."),
  "r.kb": label("Keyboard haptics", "Keyboard haptics"),
  "r.apps": label("Your apps", "Aapke apps"),
  "r.read": label("The voice I read in", "Jis awaaz mein main padhta hoon"),
  "r.name": label("What you call me", "Aap mujhe kya bulate ho"),
  "r.privacy": label("Privacy policy", "Privacy policy"),
  "r.terms": label("Terms of use", "Istemaal ki shartein"),
  "r.delete": label("Delete my account", "Mera account delete karo"),
  "r.mail": label("Write to us", "Humein likho"),

  // ---- the desk's page and its rows -------------------------------------------
  "d.h1": sentence("How I work on this computer", "Is computer par main kaise kaam karta hoon"),
  "d.pill": sentence("I show it at the foot of the screen while you talk", "Jab aap bolte ho, main ise screen ke neeche dikhata hoon"),
  "d.pause": sentence("Each pause writes what you said, and I keep listening", "Har pause par jo bola woh likh deta hoon, aur sunta rehta hoon"),
  "d.live": sentence("I show your words above the pill as you speak", "Aap bolte ho toh main aapke shabd pill ke upar dikhata hoon"),
  "d.auto": sentence("I’ll be ready when you sign in", "Aap sign in karoge toh main taiyaar milunga"),
  "d.audio": sentence("I delete it as soon as it’s written", "Likhte hi main ise delete kar deta hoon"),
  "d.history": sentence("I keep it so you can copy a note again", "Main ise rakhta hoon taaki aap note phir se copy kar sako"),
  "d.tone.go": label("Open", "Kholo"),
  "d.name.give": label("Give me a name", "Mujhe ek naam do"),

  // ---- empty states: Blip and one warm line -----------------------------------
  "e.hist": sentence("Nothing here yet. Say something in any app, and I’ll keep it here.", "Abhi kuch nahi. Kisi bhi app mein kuch bolo, main yahin rakh lunga."),
  "e.notes": sentence("No notes yet. Start one, and I’ll listen.", "Abhi koi note nahi. Ek shuru karo, main sunta hoon."),
  "e.apps": sentence("No apps yet. Connect one, and I can start doing things in it.", "Abhi koi app nahi. Ek jodo, phir main usmein kaam karna shuru kar dunga."),

  // ---- Blip's greeting on the home page, by the person's time of day (touches.ts dayPart) ----
  "g.morning": sentence("Good morning. I’m ready when you are.", "Good morning. Jab aap ho, main taiyaar hoon."),
  "g.afternoon": sentence("Good afternoon. Say the word, and I’ll write it.", "Good afternoon. Aap bolo, main likh deta hoon."),
  "g.evening": sentence("Good evening. Anything to write up before the day ends?", "Good evening. Din khatam hone se pehle kuch likhwana hai?"),
  "g.night": sentence("Still up? I’m here, and I’ll keep it quiet.", "Abhi tak jaag rahe ho? Main yahin hoon, chupchaap."),

  // ---- the You tab's "Hand it to me" card (assistant.ts youCard), only while connected apps are on ----
  "y.h": label("Hand it to me", "Mujhe de do"),
  "y.p": sentence("Tell me what to do, and I’ll do it in your apps.", "Bolo kya karna hai, main aapke apps mein kar dunga."),
  "y.up": label("Coming up", "Aane wale kaam"),
  "y.ok": label("Needs your OK", "Aapki haan chahiye"),
  "y.none": sentence("Nothing on my list yet.", "Meri list mein abhi kuch nahi."),
  "y.all": label("See all", "Sab dekho"),
  "y.more": label("Add more apps", "Aur apps jodo"),
  // Activity: the last runs and how each ended (youCard's third card)
  "y.act": label("Activity", "Kya hua"),
  "y.again": label("Try again", "Phir se karo"),
  // A desktop run's row: its words are not kept (src/runs), so it says where it ran.
  "y.desk": label("On your computer", "Computer pe"),

  // ---- the fix, in one line, under an error a screen already shows ------------
  "x.apps": sentence("Open this again in a little while, and I’ll try once more.", "Thodi der baad ise phir kholo, main ek baar aur koshish karunga."),
  "x.note": sentence("Tap Organise again, and I’ll have another go.", "Organise phir se dabao, main ek baar aur koshish karta hoon."),

  // ---- the desk's tab label that was written as a verb at me ------------------
  "tab.train": label("Teach me", "Mujhe sikhao"),
} as const satisfies Record<string, Line>;

export type SwKey = keyof typeof SW;

/** The English line. */
export const sw = (key: SwKey): string => SW[key].en;

export type DayPartName = "morning" | "afternoon" | "evening" | "night";

/**
 * The old app's time-aware line, for under a greeting that already says it ("Good evening, Aanya"): its own
 * greeting sentence dropped ("Anything to write up before the day ends?"). The night's line has none and stays whole.
 */
export function dayLineAfterGreeting(part: DayPartName): Line {
  const l: Line = SW[`g.${part}`];
  if (part === "night") return l;
  const drop = (t: string) => t.replace(/^[^.?!]*[.?!]\s+/, "");
  return { en: drop(l.en), hg: drop(l.hg), sentence: true };
}

/**
 * HOME'S BIG LINE under the greeting: a few for each part of the day, a different one each day, so it reads fresh and
 * never like a clock. "Still up?" is only for the small hours (touches.ts dayPart: night is 11 pm to 5 am).
 */
const HOME_LINES: Record<DayPartName, readonly Line[]> = {
  morning: [
    sentence("Fresh start. Say what’s first, I’ll line it up.", "Naya din. Batao pehle kya, main line up kar deta hoon."),
    sentence("Coffee in one hand? Talk, I’ll type.", "Ek haath mein coffee? Bolo, main likh deta hoon."),
    sentence("Ready when you are. Your bots already are.", "Aap bolo jab ready ho. Bots toh ready hain."),
  ],
  afternoon: [
    sentence("Halfway through. Hand me the boring bits.", "Aadha din gaya. Boring kaam mujhe de do."),
    sentence("Say the word, and it’s done.", "Bas bolo, ho jayega."),
    sentence("Busy hands? Just talk.", "Haath busy hain? Bas bolo."),
  ],
  evening: [
    sentence("Wrap up the day. I’ll tidy what’s left.", "Din samet lo. Baaki main sambhal lunga."),
    sentence("Anything to finish before tonight?", "Raat se pehle kuch khatam karna hai?"),
    sentence("Kick back. Your bots are still on it.", "Aaram karo. Bots kaam pe lage hain."),
  ],
  night: [
    sentence("Still up? I’ll keep it quiet.", "Abhi tak jaag rahe ho? Main chupchaap rahunga."),
    sentence("Night owl mode. Whisper it, I’ll write it.", "Night owl mode. Dheere se bolo, main likh dunga."),
    sentence("Late one? Your bots don’t sleep either.", "Der ho gayi? Bots bhi nahi sote."),
  ],
};

/** Today's line for this part of the day; `day` is the person's own day number (days since 1970 in their time zone). */
export function homeDayLine(part: DayPartName, day: number): Line {
  const lines = HOME_LINES[part];
  return lines[((Math.floor(day) % lines.length) + lines.length) % lines.length]!;
}

/** Hinglish for Home's day lines as Home draws them (i18n.ts applies it to bots.home). */
export function homeLineSeeds(): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const part of ["morning", "afternoon", "evening", "night"] as const) {
    const l = dayLineAfterGreeting(part); seeds.set(l.en, l.hg);
    for (const h of HOME_LINES[part]) seeds.set(h.en, h.hg);
  }
  return seeds;
}

/**
 * Hinglish, keyed by the English line as a screen draws it. The phone's labels
 * are drawn capitalised (titleCase.ts), the desk's as written, so a label is
 * seeded in both spellings; a sentence is only ever drawn as written.
 */
export function settingsHinglishSeeds(): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const key of Object.keys(SW) as SwKey[]) {
    const line: Line = SW[key];
    seeds.set(line.en, line.hg);
    if (!line.sentence) seeds.set(titleCase(line.en), line.hg);
  }
  return seeds;
}
