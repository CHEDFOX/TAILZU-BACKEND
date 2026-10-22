/**
 * THE NEW ONBOARDING, DRAWN BY THE APPS AND WRITTEN HERE.
 *
 * Ten short steps with one friend beside you: Welcome, Sign in, Code,
 * Languages, Keyboard, Try it, Make me yours, Connect apps, How careful, Done.
 * The friend is Blip, a persistent dot bot that each app draws once, above
 * everything, and walks to wherever a step says he should stand. A step is only
 * a `BlipSpot` (an empty box that says "Blip stands here, in this pose, saying
 * this") inside an `OnboardStage` (the container that glides one step out and
 * the next in, and remembers where you are).
 *
 * Two stages, because sign-in happens before there is a session:
 *   onboardAuthTree  Welcome, Sign in, Code. Rides in the bootstrap's
 *                    `auth.screen`, the only channel that reaches the app
 *                    before there is an account.
 *   onboardScreen    Everything after sign-in, the screen `onboard`.
 *
 * The sign-in LOGIC does not move. The tree reuses the pills, the social
 * buttons and the code entry that already run the flow in the app; only how
 * they look changes, through optional props whose defaults draw today's
 * controls.
 *
 * OLD BUILDS KEEP WORKING. Nothing here is sent unless the asking build
 * declared both `OnboardStage` and `BlipSpot` (canOnboard). Any other build is
 * served exactly what it was served before, except a phone build in a store,
 * which runs this on its first launch without either: it is given the same
 * steps, drawn with what it does have (onboardStore.ts, which builds them from
 * the step builders exported below). ONBOARD_V2=0 turns it all off for
 * everyone without a deploy of the apps.
 *
 * THE WORDS are written in English below and looked up in Hinglish from the
 * design's own lines (onboardHinglishSeeds, which i18n.ts applies to the
 * `onboard` screen). The model never guesses them.
 *
 * "HOW CAREFUL" EXPLAINS; IT DOES NOT ASK. Connected apps work one way now:
 * looking just runs, a new kind of change asks once and is remembered, and
 * deleting or paying always asks. Offering "ask me every time / ask only
 * before I send" would promise modes that do not exist, so the step shows the
 * three real rows, and a per-app level stays in Connected apps. The one level
 * it points at is Can look: a yes raises a Can-draft app to Can send
 * (connectors/tasks.ts), and an app added by link keeps its own per-tool
 * choices, so neither "more careful" nor "the same in every app" is true.
 */
import type { ActionRef, ActionSpec, Condition, Node, ScreenResponse } from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import type { ConnectorInfo } from "../../../shared/types/api.js";
import { CATALOG } from "../connectors/catalog.js";
import { en } from "../connectors/words.js";
import { AUTH_UI, DAILY_LANGUAGES, GOOGLE_PATHS } from "./catalog.js";
import type { ScreenContext } from "./catalog.js";

export type Style = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

/**
 * Every colour, face and measure of the new onboarding, as literals in the
 * tree (the way assistant.ts does), so neither the app's theme nor the sign-in
 * theme changes. What the persistent bot needs (ground, progress bar, bubble,
 * his own colours, the glide) travels as props on the stage, so his overlay
 * holds no colours of its own.
 */
export const OB = {
  paper: "#EFEDE8", card: "#F6F5F1", surf: "#FCFBF8", white: "#FFFFFF",
  ink: "#1C1A17", ink2: "rgba(28,26,23,0.7)", muted: "rgba(28,26,23,0.56)", hair: "rgba(28,26,23,0.13)",
  neon: "#39FF14", neonSoft: "rgba(57,255,20,0.2)", neonLine: "rgba(57,255,20,0.6)",
  ti1: "#8D8983", ti2: "#BDB9B2", ti3: "#DAD6CF",
  /** Blip's pale dots and his ink edge. */
  dot: "#F3E2C6", sticker: "#151311",
  /** PHONE_FONT.grotesk and .hand: Bricolage Grotesque 800 and Kalam. */
  grotesk: "Tailzu Grotesk", hand: "Tailzu Hand",
  /** The one switch for the step headings' face (the prototype's phone frame draws them in the system face). */
  headingFont: "Tailzu Grotesk",
  side: 20,
} as const;

/**
 * The icons, each as ONE path (the SVG node takes one): the prototype's, with
 * its rectangles written as arc paths.
 */
export const IC = {
  mic: "M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  lock: "M7.5 10.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-5a2.5 2.5 0 0 1 2.5-2.5zM8 10.5V8a4 4 0 0 1 8 0v2.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  mail: "M6 5.5h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM3.8 7.5l8.2 6 8.2-6",
  clock: "M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0zM12 7.5V12l3 2",
  chev: "M6 9l6 6 6-6",
  g: "M17.66 6.34A8 8 0 1 0 20 12h-8",
  eye: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
} as const;

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * Every line, in English. Placeholders: {len} and {to} are filled by the code
 * entry from the flow, {n} by this file, and the few lines that name an app
 * come from the assistant's shared table (connectors/words.ts: connect, st.ok,
 * st.no, s6.sug, s6.more, a2.ai, err.connect), not from here.
 */
export const OB_EN = {
  "ob.cont": "Continue",
  "ob.skip": "Skip for now",
  "ob.or": "or",
  "s1.say": "Hello!",
  "s1.h": "Hi, I’m Tailzu.",
  "s1.p": "Talk to me in any language and I’ll write it, clean, in any app. Now I can also get things done in your apps.",
  "s1.p0": "Talk to me in any language and I’ll write it, clean, in any app.",
  "s1.cta": "Let’s set you up",
  "s1.fine": "Takes about two minutes.",
  "si.say": "I’ve got the key.",
  "si.h": "Let’s get you in.",
  "si.p": "One account, so your setup follows you to any phone.",
  "si.p.d": "One account, so your setup follows you to any device.",
  "si.google": "Continue with Google",
  "si.apple": "Continue with Apple",
  "si.em": "Email address",
  "si.email": "Continue with email",
  "si.ph": "Phone number",
  "si.phone": "Continue with phone number",
  "si.trust": "I’ll send you a code to check it’s you. I never sell your number or email.",
  "cd.say": "I’m waiting for it.",
  "cd.say2": "Got it!",
  "cd.h": "Enter the code I sent.",
  "cd.p": "I sent a {len}-digit code to {to}.",
  "cd.wait": "When it comes, tap it above your keyboard, or type it in.",
  "cd.wait.d": "Type it here when it comes.",
  "cd.ok": "Got it. Checking it now…",
  "cd.fail": "I couldn’t send the code. Tap Send it again.",
  "cd.resend": "Send it again",
  "cd.wrong": "Wrong number?",
  "cd.wrongE": "Wrong email?",
  "cd.change": "Change it",
  "s2.say": "I’m listening.",
  "s2.h": "Which languages do you speak?",
  "s2.p": "Pick every one that sounds like you. I’ll follow when you switch, even mid-sentence.",
  "s2.more": "+ {n} more",
  "s2.hint": "You can add more later in Settings.",
  "s3.say": "Almost there.",
  "s3.h": "Add me to your keyboard",
  "s3.p": "Three quick taps in Settings, just once.",
  "s3.1": "Tap Open Settings, then Keyboards",
  "s3.2": "Switch on Tailzu",
  "s3.3": "Switch on Allow Full Access",
  "s3.1a": "Tap Open Settings",
  "s3.2a": "Switch on Tailzu, and tap OK",
  "s3.3a": "Come back here, I’ll take it from there",
  "s3.wh": "Why Full Access?",
  "s3.wp": "I need the internet to turn your voice into clean text, and Full Access is what lets me reach it. I only write down what you say after you tap the mic.",
  "s3.cta": "Open Settings",
  "s3.done": "I’ve added it",
  "s4.say": "Go on, say something.",
  "s4.say1": "I’m all ears.",
  "s4.say2": "That’s me. Nice, right?",
  "s4.h": "Try it once",
  "s4.p": "Hold the mic and say it the way you’d tell a friend.",
  "s4.keys.d": "In any other app, press",
  "s4.you": "Try saying",
  "s4.ex": "haan bhai 5 min mein aa raha hoon",
  "s4.me": "I write",
  "s4.hold": "Hold to speak",
  "s4.live": "Listening…",
  "s4.busy": "Writing it…",
  "s4.again": "Hold to try again",
  "s4.ok": "Capital, comma, full stop. I do this in every app.",
  "s4.err": "I couldn’t hear that. Hold and try again.",
  "s5.say": "These help me help you.",
  "s5.h": "Make me yours",
  "s5.p": "One tap sets it all up. Each one has a reason, and you can switch any of them off later.",
  "s5.all": "Allow both",
  "s5.allsub": "One tap for both",
  "pn": "Notifications",
  "pn.d": "So I can tell you when something needs your yes.",
  "pm": "Microphone",
  "pm.d": "So I can hear you when you tap the mic.",
  "s5.foot": "Change these any time in Settings.",
  "s5.off": "You can turn this off in Settings any time.",
  "s5.blocked": "Turn it on in Settings, then come back.",
  "s6.say": "I brought some for you.",
  "s6.h": "Connect your apps",
  "s6.p": "So I can do things, not just write. I check with you before each new kind of change.",
  "s6.all": "See all",
  "s6.ai": "I only use an app when you ask. What I read there goes to an AI model (OpenAI or Anthropic, through OpenRouter) just to answer you, never for ads or training.",
  "s7.say": "You’re in charge.",
  "s7.h": "Here’s how careful I am.",
  "s7.p": "That’s how it works for the apps you pick from the list.",
  "c1.h": "Looking things up",
  "c1.p": "I just do it. Looking never changes anything.",
  "c1.f": "Look|Answer",
  "c2.h": "A new kind of change",
  "c2.p": "The first time, I show you the exact change or message and wait for your yes. Then I remember that kind, for that app only.",
  "c2.f": "Show you|Your yes|I remember",
  "c3.h": "Deleting or paying",
  "c3.p": "I ask every single time. No exceptions.",
  "c3.f": "Ask|Your yes|Every time",
  "s7.foot": "Want me to only look in an app? Set it to Can look in Connected apps.",
  "s7.cta": "Sounds good",
  "s8.say": "We did it!",
  "s8.h": "You’re all set.",
  "s8.p": "Press the mic on your keyboard in any app, or talk to me here.",
  "s8.p.d": "Press your shortcut in any app, or talk to me here.",
  "s8.try": "Try saying: “Tell Mom I’m on my way on WhatsApp”",
  "s8.try0": "Try it in any chat: “On my way, 5 minutes”",
  "s8.cta": "Take me in",
  "s8.fine": "Everything I do in your apps shows up in Tasks.",
  "s8.fine0": "You can change anything later in Settings.",
  "ob.err.finish": "I couldn’t finish just now. Check your connection and tap again.",
} as const;

export type ObKey = keyof typeof OB_EN;

/** The same lines in the design's Hinglish. Same keys, none empty (the tests hold both). */
export const OB_HG: Record<ObKey, string> = {
  "ob.cont": "Aage chalo",
  "ob.skip": "Abhi nahi",
  "ob.or": "ya",
  "s1.say": "Namaste!",
  "s1.h": "Hi, main Tailzu hoon.",
  "s1.p": "Aap kisi bhi language mein bolo, main kisi bhi app mein saaf likh dunga. Ab aapke apps mein kaam bhi kar dunga.",
  "s1.p0": "Aap kisi bhi language mein bolo, main kisi bhi app mein saaf likh dunga.",
  "s1.cta": "Chalo, set up karte hain",
  "s1.fine": "Bas do minute lagenge.",
  "si.say": "Chaabi mere paas hai.",
  "si.h": "Chalo, andar chalte hain.",
  "si.p": "Ek account, taaki aapka setup kisi bhi phone pe saath chale.",
  "si.p.d": "Ek account, taaki aapka setup har device pe saath chale.",
  "si.google": "Google se aage chalo",
  "si.apple": "Apple se aage chalo",
  "si.em": "Email address",
  "si.email": "Email se aage chalo",
  "si.ph": "Phone number",
  "si.phone": "Phone number se aage chalo",
  "si.trust": "Main aapko ek code bhejunga taaki pata chale aap hi ho. Aapka number ya email main kabhi bechta nahi.",
  "cd.say": "Main intezaar kar raha hoon.",
  "cd.say2": "Mil gaya!",
  "cd.h": "Jo code bheja hai, woh daalo.",
  "cd.p": "Maine {to} par {len} digit ka code bheja hai.",
  "cd.wait": "Code aate hi keyboard ke upar dikhega, tap karo ya khud daal do.",
  "cd.wait.d": "Code aate hi yahan daal do.",
  "cd.ok": "Mil gaya. Check kar raha hoon…",
  "cd.fail": "Code nahi bhej paya. Dobara bhejo dabao.",
  "cd.resend": "Dobara bhejo",
  "cd.wrong": "Number galat hai?",
  "cd.wrongE": "Email galat hai?",
  "cd.change": "Badlo",
  "s2.say": "Main sun raha hoon.",
  "s2.h": "Aap kaunsi languages bolte ho?",
  "s2.p": "Jo bhi aapki lage, sab chun lo. Beech mein language badlo toh bhi main saath rahunga.",
  "s2.more": "+ {n} aur",
  "s2.hint": "Baad mein Settings se aur add kar sakte ho.",
  "s3.say": "Bas thoda aur.",
  "s3.h": "Mujhe apne keyboard mein jodo",
  "s3.p": "Settings mein teen tap, bas ek baar.",
  "s3.1": "Open Settings dabao, phir Keyboards",
  "s3.2": "Tailzu on karo",
  "s3.3": "Allow Full Access on karo",
  "s3.1a": "Open Settings dabao",
  "s3.2a": "Tailzu on karo, aur OK dabao",
  "s3.3a": "Wapas yahan aao, baaki main dekh lunga",
  "s3.wh": "Full Access kyun?",
  "s3.wp": "Aapki awaaz ko saaf text banane ke liye internet chahiye, aur woh Full Access se milta hai. Main sirf tab likhta hoon jab aap mic dabate ho.",
  "s3.cta": "Settings kholo",
  "s3.done": "Add kar diya",
  "s4.say": "Boliye, kuch bhi.",
  "s4.say1": "Main sun raha hoon.",
  "s4.say2": "Yeh hui na baat!",
  "s4.h": "Ek baar try karo",
  "s4.p": "Mic dabake rakho aur waise bolo jaise dost ko bolte ho.",
  "s4.keys.d": "Kisi aur app mein dabao",
  "s4.you": "Aise bolo",
  "s4.ex": "haan bhai 5 min mein aa raha hoon",
  "s4.me": "Main likhta hoon",
  "s4.hold": "Dabake bolo",
  "s4.live": "Sun raha hoon…",
  "s4.busy": "Likh raha hoon…",
  "s4.again": "Dobara dabake bolo",
  "s4.ok": "Capital, comma, full stop, sab theek. Har app mein aise hi likhunga.",
  "s4.err": "Sunai nahi diya. Dabake dobara bolo.",
  "s5.say": "Yeh sab aapki madad ke liye hain.",
  "s5.h": "Mujhe apna bana lo",
  "s5.p": "Ek tap mein sab set. Har ek ki ek wajah hai, aur baad mein kabhi bhi band kar sakte ho.",
  "s5.all": "Dono allow karo",
  "s5.allsub": "Ek tap mein dono",
  "pn": "Notifications",
  "pn.d": "Taaki jab kisi kaam ko aapki haan chahiye, main bata sakoon.",
  "pm": "Microphone",
  "pm.d": "Taaki mic dabate hi main aapko sun sakoon.",
  "s5.foot": "Inhe kabhi bhi Settings mein badal sakte ho.",
  "s5.off": "Settings mein kabhi bhi band kar sakte ho.",
  "s5.blocked": "Settings mein on karo, phir wapas aao.",
  "s6.say": "Aapke liye kuch laya hoon.",
  "s6.h": "Apne apps jodo",
  "s6.p": "Taaki main sirf likhu nahi, kaam bhi karoon. Har naye tarah ke badlaav se pehle main aapse poochunga.",
  "s6.all": "Sab dekho",
  "s6.ai": "Main kisi app ko tabhi use karta hoon jab aap kaho. Wahan jo padhta hoon, woh sirf aapko jawab dene ke liye ek AI model (OpenAI ya Anthropic, OpenRouter ke through) ke paas jaata hai, kabhi ads ya training ke liye nahi.",
  "s7.say": "Faisla aapka.",
  "s7.h": "Main aise dhyaan rakhta hoon.",
  "s7.p": "List se chune hue apps mein yahi tareeka chalta hai.",
  "c1.h": "Dekhna aur dhoondhna",
  "c1.p": "Yeh main seedha kar deta hoon. Dekhne se kuch nahi badalta.",
  "c1.f": "Dekhna|Jawab",
  "c2.h": "Naye tarah ka badlaav",
  "c2.p": "Pehli baar main bilkul wahi badlaav ya message dikhaunga aur aapki haan ka wait karunga. Phir sirf usi app ke liye aisa kaam yaad rakhunga.",
  "c2.f": "Dikhaunga|Aapki haan|Yaad rakhunga",
  "c3.h": "Delete ya payment",
  "c3.p": "Har ek baar poochunga. Hamesha.",
  "c3.f": "Poochunga|Aapki haan|Har baar",
  "s7.foot": "Kisi app mein sirf dekhna ho? Jude hue apps mein use “Dekh sakta hoon” par set karo.",
  "s7.cta": "Theek hai",
  "s8.say": "Ho gaya!",
  "s8.h": "Sab taiyaar hai.",
  "s8.p": "Kisi bhi app mein keyboard ka mic dabao, ya yahin mujhse baat karo.",
  "s8.p.d": "Kisi bhi app mein apna shortcut dabao, ya yahin mujhse baat karo.",
  "s8.try": "Bol ke dekho: “Mummy ko WhatsApp pe bolo main raste mein hoon”",
  "s8.try0": "Kisi bhi chat mein bolo: “Bas 5 minute mein pahunch raha hoon”",
  "s8.cta": "Andar chalo",
  "s8.fine": "Aapke apps mein main jo bhi karta hoon, Tasks mein dikhta hai.",
  "s8.fine0": "Baad mein Settings mein kuch bhi badal sakte ho.",
  "ob.err.finish": "Abhi finish nahi kar paya. Connection check karke dobara dabao.",
};

/**
 * The few lines only the STORE variant says (onboardStore.ts). A build that
 * draws the new onboarding itself holds the microphone to speak; the store
 * build's mic button is one you tap to start and tap to stop, so the lines
 * that say how are different. Everything else the variant says is OB_EN's.
 */
export const OB_STORE_EN = {
  "st.p": "Tap the button, say it the way you’d tell a friend, then tap again.",
  "st.tap": "Tap to speak",
  "st.live": "Listening… tap to stop",
  "st.again": "Tap to try again",
} as const;

export const OB_STORE_HG: Record<keyof typeof OB_STORE_EN, string> = {
  "st.p": "Button dabao, waise bolo jaise dost ko bolte ho, phir dobara dabao.",
  "st.tap": "Tap karke bolo",
  "st.live": "Sun raha hoon… rukne ke liye dabao",
  "st.again": "Tap karke dobara bolo",
};

/** The languages this step shows as chips: India's, and English. */
export const shownChip = (l: (typeof DAILY_LANGUAGES)[number]): boolean => l.india || l.value === "en";

/** What "+ N more" counts: every language the Languages screen has that this step does not show. */
export function moreLanguages(): number {
  return DAILY_LANGUAGES.length - DAILY_LANGUAGES.filter(shownChip).length;
}

export const fillSlots = (s: string, vars: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/**
 * English line -> the design's Hinglish line, used as written (i18n.ts applies
 * these to the `onboard` screen, over the assistant's seeds and the cache: a few
 * English lines here are also on other screens with a Hinglish of their own).
 *
 * Two kinds of line are written out the way they reach the translator, which
 * asks about whole strings: the one with {n} (filled here, so the seed is the
 * line as drawn), and the "a|b|c" flows on How careful, which are drawn as one
 * pill per part, so each part is its own seed.
 */
export function onboardHinglishSeeds(): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const key of Object.keys(OB_STORE_EN) as Array<keyof typeof OB_STORE_EN>) seeds.set(OB_STORE_EN[key], OB_STORE_HG[key]);
  for (const key of Object.keys(OB_EN) as ObKey[]) {
    const from: string = OB_EN[key];
    const to = OB_HG[key];
    if (from.includes("|")) {
      const toParts = to.split("|");
      from.split("|").forEach((part, i) => seeds.set(part, toParts[i] ?? part));
    } else if (from.includes("{n}")) {
      const n = moreLanguages();
      seeds.set(fillSlots(from, { n }), fillSlots(to, { n }));
    } else {
      seeds.set(from, to);
    }
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// The gate: who gets the new flow
// ---------------------------------------------------------------------------

/**
 * Does the asking build draw the new onboarding? Only a build that declared
 * both new node types does, and only while ONBOARD_V2 is not "0". Anything else
 * is served exactly what it was served before: a build that cannot draw an
 * OnboardStage must never be handed one.
 *
 * Takes the list a bootstrap carries or the Set a screen request becomes. Read
 * per call (not at import) so the switch is the environment's alone.
 */
export function canOnboard(c?: unknown): boolean {
  if (process.env.ONBOARD_V2 === "0") return false;
  const has = c instanceof Set ? (n: string) => c.has(n) : Array.isArray(c) ? (n: string) => c.includes(n) : null;
  return !!has && has("OnboardStage") && has("BlipSpot");
}

/**
 * Are the "Connect your apps" and "How careful" steps part of the flow? When
 * connected apps are off there is nothing to connect and nothing to be careful
 * about, so both are left out (and the words that mention apps change).
 */
export function onboardAppsOn(connectorsOn: boolean): boolean {
  return connectorsOn && CATALOG.some((c) => !c.hidden && c.auth === "oauth");
}

/**
 * How many steps there are in all, for the progress bar. The three before the
 * session (Welcome, Sign in, Code) and the ones after it: on a phone Languages,
 * Keyboard, Try it, Make me yours, [Connect apps, How careful,] Done; in a
 * window, no Keyboard (it has none to add) and no Make me yours (the OS asks).
 * The bootstrap works this out too, so the bar never changes length at the
 * boundary between the two stages.
 */
export function onboardTotal(desktop: boolean, appsOn: boolean): number {
  return 3 + postAuthSteps(desktop, appsOn).length;
}

export function postAuthSteps(desktop: boolean, appsOn: boolean): string[] {
  const apps = appsOn ? ["apps", "careful"] : [];
  return desktop
    ? ["languages", "try", ...apps, "done"]
    : ["languages", "keyboard", "try", "yours", ...apps, "done"];
}

/**
 * Where a cold start lands inside `onboard`, as an index into the steps built.
 * Languages are asked once: someone who has answered goes on to the next thing
 * still missing (the phone's keyboard, else Try it; a window goes to Try it).
 * Within a running app the stage also remembers the step, so a refetch never
 * moves anyone backward.
 */
export function onboardStart(f: {
  desktop: boolean;
  languagesSet: boolean;
  keyboardReady: boolean;
  /** Step id -> index, for the list actually built. */
  I: Record<string, number>;
}): number {
  if (!f.languagesSet) return f.I.languages!;
  if (f.desktop) return f.I.try!;
  return f.keyboardReady ? f.I.try! : f.I.keyboard!;
}

/**
 * The language the screen `onboard` is written in.
 *
 * Everywhere else the app's language is the profile's, which stays "auto"
 * (English) until someone changes it in Settings. Here that would mean nobody
 * ever met the Hinglish: the Languages step only saves the person's languages
 * (personality.languages), never the profile's. So while the profile has said
 * nothing, the first language they chose is the one the rest of the flow
 * speaks, the same fallback effectiveLanguage() makes for a request. A language
 * set in the profile still wins.
 */
export function onboardLanguage(profileLanguage: string | undefined, chosen: readonly unknown[] | undefined): string {
  const set = typeof profileLanguage === "string" ? profileLanguage.trim() : "";
  if (set && set !== "auto") return set;
  const first = chosen?.[0];
  return typeof first === "string" && first.trim() && first.trim() !== "auto" ? first.trim() : "auto";
}

// ---------------------------------------------------------------------------
// Shorthands
// ---------------------------------------------------------------------------

export const EN = OB_EN;
export const words = en;

/** The stage moves only through setState: the desktop has no incrementState. */
export const SET = (i: number): ActionSpec => ({ kind: "setState", path: "step", value: i });
export const seq = (...actions: ActionRef[]): ActionSpec => ({ kind: "sequence", actions });
export const haptic = (style: "selection" | "success"): ActionSpec => ({ kind: "haptic", style });
export const toast = (message: string, tone: "info" | "error" = "info"): ActionSpec => ({ kind: "toast", message, tone });
export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
export const when = (cond: Condition, then: ActionRef, otherwise?: ActionRef): ActionSpec =>
  ({ kind: "condition", if: cond, then, ...(otherwise !== undefined ? { else: otherwise } : {}) });
export const bothPerms: Condition = { all: [{ truthy: "perm.n" }, { truthy: "perm.m" }] };

export const nodes = (kids: Array<Node | null | false | undefined>): Node[] => kids.filter((k): k is Node => !!k);

/**
 * A style value that follows state: the app resolves `{<condition>, then, else}`
 * live, on every redraw. Typed as the string it stands for, because that is the
 * slot it fills.
 */
export const IF = (cond: Condition, then: string, otherwise: string): string => ({ ...cond, then, else: otherwise }) as unknown as string;

/** A step: what the stage shows one at a time. */
export const STEP = (id: string, kids: Array<Node | null>, extra: Partial<Node> = {}): Node => ({
  type: "Stack",
  props: { stepId: id },
  style: { flexGrow: 1, paddingHorizontal: OB.side, paddingBottom: 30 },
  children: nodes(kids),
  ...extra,
});

/** Where Blip stands, in which pose, saying what. An empty box the host measures. */
export const SPOT = (pose: string, h: number, say: ObKey, bubble: "side" | "corner" = "side", x: Style = {}): Node => ({
  type: "BlipSpot",
  props: { pose, h, say: EN[say], bubble, ...x },
  style: bubble === "side" ? { marginLeft: -Math.round(0.24 * h), marginRight: -Math.round(0.16 * h) } : {},
});
/** A step's head: Blip, with his bubble beside him. */
export const HD = (...spots: Node[]): Node =>
  ({ type: "Stack", style: { flexDirection: "row", alignItems: "flex-start" }, children: spots });
/** Welcome's and Done's head: Blip big, centred, his bubble in the corner. */
export const C1 = (...spots: Node[]): Node =>
  ({ type: "Stack", style: { alignItems: "center", marginTop: 10 }, children: spots });

export const H = (k: ObKey, xl = false): Node => ({
  type: "Heading",
  props: { content: EN[k] },
  // No fontWeight: a custom face's weight is its file.
  style: {
    fontFamily: OB.headingFont, fontSize: xl ? 32 : 26, lineHeight: xl ? 36 : 29, letterSpacing: -0.6, color: OB.ink,
    marginTop: 6, marginBottom: 6, ...(xl ? { textAlign: "center" } : {}),
  },
});
/**
 * HOW A LINE OF OURS SAYS WHAT IT LOOKS LIKE, ALL OF IT.
 *
 * Both apps draw a Text and a Paragraph in the dark theme's own voices first
 * (`body` and `paragraph`: Light, weight 300, a 26-point line) and lay a node's
 * style over them, so whatever a style leaves out falls through to those. Body
 * copy then came out Light and not Regular, and a 12-point label sat in a
 * 26-point box, which made the little pills 34 tall. So every line sets its own
 * weight and its own line height: Regular (400), and about 1.3 times its size.
 * A line with a face of its own is left without a weight, as the headings are:
 * a custom face's weight is its file.
 */
export const plain = (style: Style): Style => ({
  ...(style.fontFamily ? {} : { fontWeight: "400" }),
  lineHeight: Math.round((Number(style.fontSize) || 15) * 1.3),
  ...style,
});
export const P = (k: ObKey, s: Style = {}): Node => ({
  type: "Paragraph", props: { content: EN[k] },
  style: plain({ fontSize: 15, lineHeight: 21, color: OB.ink2, marginBottom: 12, ...s }),
});
/** The small capitals over a group: Suggested, You said, I wrote. */
export const LABEL = (content: string): Node => ({
  type: "Text", props: { content },
  style: plain({ fontSize: 12, lineHeight: 14, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: OB.ink2, marginTop: 6, marginBottom: 8 }),
});
export const LAB = (k: ObKey): Node => LABEL(EN[k]);
export const FINE = (k: ObKey, center = false): Node => ({
  type: "Text", props: { content: EN[k] },
  style: plain({ fontSize: 13, lineHeight: 18, color: OB.ink2, ...(center ? { textAlign: "center", marginTop: 6 } : { marginVertical: 2 }) }),
});
/** A line of ours in the system face. */
export const TXT = (content: string, style: Style): Node => ({ type: "Text", props: { content }, style: plain(style) });
/** A line drawn from the screen's state: an app's name, a language: never translated. */
export const FROM = (path: string, style: Style): Node => ({ type: "Text", props: { content: "" }, bind: { content: path }, style: plain(style) });

/** The ink button. `label` is the line itself (ours from OB_EN, or the shared table's). Dimmed it cannot be pressed. */
export const BTN = (label: string, action: ActionRef, dim = false): Node => ({
  type: "Stack",
  ...(dim ? {} : { on: { onPress: action } }),
  props: { pressOpacity: 0.7 },
  style: {
    height: 52, borderRadius: 16, backgroundColor: OB.ink, opacity: dim ? 0.3 : 1,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  children: [TXT(label, { fontSize: 16, fontWeight: "600", color: OB.surf })],
});
/** The quiet one under it. */
export const BTN2 = (label: string, action: ActionRef): Node => ({
  type: "Stack",
  on: { onPress: action },
  props: { pressOpacity: 0.7 },
  style: { height: 40, borderRadius: 16, backgroundColor: "transparent", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  children: [TXT(label, { fontSize: 14.5, fontWeight: "600", color: OB.ink2 })],
});

const hairline = (): Node => ({ type: "Stack", style: { flex: 1, height: 1, backgroundColor: OB.hair } });
/** A line with "or" in the middle. */
export const OR = (): Node => ({
  type: "Stack",
  style: { flexDirection: "row", alignItems: "center", gap: 10 },
  children: [
    hairline(),
    TXT(EN["ob.or"], { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: OB.ink2 }),
    hairline(),
  ],
});
/** Pushes what follows to the bottom of the window. */
export const PUSH = (): Node => ({ type: "Spacer", style: { flex: 1, minHeight: 12 } });

export const ICON = (name: keyof typeof IC, size: number, color: string): Node => ({
  type: "SVG",
  props: { viewBox: "0 0 24 24", d: IC[name], fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
  style: { width: size, height: size },
});

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * The stage's look, which the persistent bot reads too. The same on both sides
 * of sign-in, so he does not change at the boundary. (Reduced motion is the
 * app's to apply to `glide`.)
 */
export function stageProps(id: "onboard.auth" | "onboard", first: number, of: number): Style {
  return {
    id, first, of,
    // Opts the tree out of the capitalising pass (titleCase.ts): these are
    // sentences, and the Hinglish seeds match them letter for letter.
    keepCase: true,
    ground: OB.paper,
    progress: { on: OB.ink, off: OB.hair, height: 4, gap: 4 },
    bubble: { background: OB.surf, border: OB.ink, ink: OB.ink, font: OB.hand, size: 19, bigSize: 22 },
    blip: { dot: OB.dot, sticker: OB.sticker, glow: OB.neon },
    glide: { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 },
  };
}

// ---------------------------------------------------------------------------
// Before the session: Welcome, Sign in, Code
// ---------------------------------------------------------------------------

/** The email and phone fields, and the button under each. */
const FIELD = {
  height: 48, radius: 16, background: OB.white, borderColor: OB.ink, textColor: OB.ink,
  placeholderColor: OB.muted, fontSize: 17,
  buttonBackground: OB.ink, buttonTextColor: OB.surf, buttonHeight: 48, buttonRadius: 16,
  countryBackground: OB.surf, countryBorderColor: OB.hair,
} as const;

/** Google's "G" in its four colours, as four SVG nodes laid over one another (as googleLinkButton draws it). */
function googleLogo(size: number): Node {
  return {
    type: "Stack",
    style: { width: size, height: size },
    children: GOOGLE_PATHS.map(([fill, d]) => ({
      type: "SVG",
      props: { viewBox: "0 0 48 48", d, fill },
      style: { position: "absolute", left: 0, top: 0, width: size, height: size },
    })),
  };
}

const googleRow = (): Node => ({
  type: "Stack",
  style: { flexDirection: "row", alignItems: "center", gap: 10 },
  children: [googleLogo(20), TXT(EN["si.google"], { fontSize: 15.5, fontWeight: "600", color: OB.ink })],
});

/** The consent line, as AUTH_UI.legal has it (the same parts, links and fallback), in the paper look. */
function legalLine(): Node {
  const ui = AUTH_UI.legal;
  return {
    type: "Stack",
    style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: 8 },
    children: ui.parts.map((part) => ({
      type: "Text",
      props: { content: part.text },
      ...(part.url ? { on: { onPress: { kind: "openUrl", url: part.url, external: true } } } : {}),
      style: plain({
        fontSize: 12, lineHeight: 17, color: part.url ? OB.ink : OB.ink2,
        ...(part.url ? { textDecorationLine: "underline" } : {}),
      }),
    })) as Node[],
    // A bundle that cannot lay this out still shows the sentence: consent copy
    // missing is worse than consent copy that does not open.
    fallback: TXT(ui.text, { textAlign: "center", fontSize: 12, lineHeight: 17, color: OB.ink2, marginTop: 8 }),
  };
}

export interface OnboardAuthOpts {
  /** A window (the desktop app). */
  desktop?: boolean;
  /** Leave Google out (an Android bundle that cannot come back from it). */
  googleHidden?: boolean;
  /** With it, Google is a link to Supabase's own sign-in instead (googleLinkButton's bridge). */
  googleLink?: string | null;
  /** Leave Apple out (a window that is not a Mac). */
  appleHidden?: boolean;
  /** The apps steps are part of the flow (onboardAppsOn): the bar's length, and Welcome's words. */
  connectorsOn?: boolean;
}

/**
 * Welcome, Sign in and Code, for the bootstrap's `auth.screen`. All actions are
 * inline: the auth tree has no action table. The sign-in logic is the app's
 * (the pills, Google, Apple and the code entry all run the flow the gate
 * already owns); this decides how it looks and what Blip says.
 *
 * The phase of that flow picks the step while it is running: `verify` and
 * `verifying` show Code whatever the stored step says (phaseStep), and "Change
 * it" walks back to Sign in by returning the flow to `entry`.
 */
export function onboardAuthTree(opts: OnboardAuthOpts = {}): Record<string, unknown> {
  const desktop = opts.desktop === true;
  const appsOn = opts.connectorsOn === true;

  const welcome = STEP("welcome", [
    C1(SPOT("wave", 196, "s1.say", "corner")),
    H("s1.h", true),
    P(appsOn ? "s1.p" : "s1.p0", { textAlign: "center", paddingHorizontal: 6 }),
    PUSH(),
    BTN(EN["s1.cta"], seq(haptic("selection"), SET(1))),
    FINE("s1.fine", true),
  ]);

  const google: Node | null = opts.googleLink
    // The bridge for a bundle that cannot come back from Google: the same
    // two-step press googleLinkButton makes (note the tap, then open the link).
    ? {
        type: "Stack",
        on: { onPress: seq(setState("googleStarted", true), { kind: "openUrl", url: opts.googleLink, external: true }) },
        props: { pressOpacity: 0.7, accessibilityLabel: EN["si.google"] },
        style: {
          width: "100%", height: 48, borderRadius: 16, borderWidth: 1.5, borderColor: OB.ink, backgroundColor: OB.surf,
          flexDirection: "row", alignItems: "center", justifyContent: "center",
        },
        children: [googleRow()],
      }
    : opts.googleHidden
      ? null
      : {
          type: "GoogleSignIn",
          props: { size: 48, radius: 16, background: OB.surf, borderWidth: 1.5, borderColor: OB.ink, label: EN["si.google"] },
          style: { width: "100%" },
          children: [googleRow()],
        };
  // Apple's own control. It hides itself on Android.
  const apple: Node | null = opts.appleHidden
    ? null
    : {
        type: "AppleSignIn",
        props: { size: 48, radius: 16, buttonType: "CONTINUE", buttonStyle: "WHITE_OUTLINE", label: EN["si.apple"] },
        style: { width: "100%" },
      };
  const social = nodes([google, apple]);

  const signin = STEP("signin", [
    HD(SPOT("key", 110, "si.say")),
    H("si.h"),
    P(desktop ? "si.p.d" : "si.p"),
    {
      type: "Stack",
      style: { gap: 8, marginTop: 4 },
      children: nodes([
        ...social,
        // An "or" with nothing above it would hang from the top of the form.
        social.length ? OR() : null,
        { type: "SwipePill", props: { method: "email", variant: "field", placeholder: EN["si.em"], submitLabel: EN["si.email"], ...FIELD } },
        // The phone field is the backend's switch (AUTH_ENABLE_PHONE), as ever.
        {
          type: "Stack",
          visibleIf: { flag: "auth.enablePhone" },
          style: { gap: 8 },
          children: [
            OR(),
            {
              type: "SwipePill",
              props: {
                method: "phone", variant: "field", placeholder: EN["si.ph"], submitLabel: EN["si.phone"],
                presetCountry: "IN", dial: "+91", ...FIELD,
              },
            },
          ],
        },
        {
          type: "Stack",
          style: { flexDirection: "row", gap: 7, marginTop: 2 },
          children: [ICON("lock", 16, OB.ink2), TXT(EN["si.trust"], { flex: 1, fontSize: 13.5, lineHeight: 19, color: OB.ink2 })],
        },
        legalLine(),
      ]),
    },
  ]);

  // The code is verified the moment it is complete, so there is no Continue
  // to wait on. Blip waits while it comes and nods once it is in.
  const code = STEP("code", [
    HD(
      { type: "AuthPhase", props: { phases: ["verify"] }, children: [SPOT("wait", 110, "cd.say")] },
      { type: "AuthPhase", props: { phases: ["verifying"] }, children: [SPOT("nod", 110, "cd.say2")] },
    ),
    H("cd.h"),
    {
      type: "CodeEntry",
      props: {
        variant: "boxes",
        sentTo: EN["cd.p"], waitLabel: EN[desktop ? "cd.wait.d" : "cd.wait"], okLabel: EN["cd.ok"], failLabel: EN["cd.fail"],
        resendLabel: EN["cd.resend"], wrongLabel: EN["cd.wrong"], wrongEmailLabel: EN["cd.wrongE"], changeLabel: EN["cd.change"],
        boxHeight: 60, boxRadius: 14, boxGap: 8, boxBackground: OB.surf, boxBorderColor: OB.hair,
        boxFilledBackground: OB.white, boxFilledBorderColor: OB.ink, boxActiveRing: OB.neonSoft,
        digitColor: OB.ink, digitFont: OB.grotesk, digitSize: 28, textColor: OB.ink2, linkColor: OB.ink,
      },
    },
  ]);

  return {
    type: "OnboardStage",
    bind: { step: "step" },
    props: { ...stageProps("onboard.auth", 0, onboardTotal(desktop, appsOn)), phaseStep: { verify: 2, verifying: 2 } },
    children: [welcome, signin, code],
  };
}

// ---------------------------------------------------------------------------
// After the session: the screen `onboard`
// ---------------------------------------------------------------------------

/** Everything a step needs to know about this person and this build. */
export interface Plan {
  desktop: boolean;
  ios: boolean;
  appsOn: boolean;
  /** Step id -> index, for the list actually built. */
  I: Record<string, number>;
  /** The index after this step's. */
  next: (id: string) => number;
  /** Every app the person can see, and the five the tiles show. */
  apps: ConnectorInfo[];
  five: ConnectorInfo[];
  /**
   * HOW A STEP AND BLIP ARE DRAWN. Here they are a stage's step and a BlipSpot;
   * the store variant (onboardStore.ts) builds the same steps out of what every
   * build draws, and hands these two its own.
   */
  step: typeof STEP;
  spot: typeof SPOT;
}

export function languageChip(l: (typeof DAILY_LANGUAGES)[number]): Node {
  const picked: Condition = { contains: ["langs", l.value] };
  const save = (): ActionSpec => ({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } });
  return {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: seq(haptic("selection"), { kind: "toggleInArray", path: "langs", value: l.value }, save()) },
    style: {
      height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, flexDirection: "row", alignItems: "center", gap: 6,
      borderColor: IF(picked, OB.ink, OB.hair),
      backgroundColor: IF(picked, OB.neonSoft, OB.surf),
    },
    children: [
      { ...ICON("check", 15, OB.ink), visibleIf: picked },
      // A language's name is a proper noun: drawn from state, so it is never translated.
      FROM(`ln.${l.value}`, { fontSize: 14.5, fontWeight: "600", color: OB.ink }),
    ],
  };
}

export function languagesStep(p: Plan): Node {
  const rest = moreLanguages();
  const more: Node = {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: { kind: "navigate", screenId: "languages" } },
    style: {
      height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1,
      backgroundColor: OB.surf, flexDirection: "row", alignItems: "center", gap: 6,
    },
    children: [TXT(fillSlots(EN["s2.more"], { n: rest }), { fontSize: 14.5, fontWeight: "600", color: OB.ink })],
  };
  return p.step("languages", [
    HD(p.spot("listen", 104, "s2.say")),
    H("s2.h"),
    P("s2.p"),
    {
      type: "Stack",
      style: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
      children: [...DAILY_LANGUAGES.filter(shownChip).map(languageChip), more],
    },
    FINE("s2.hint"),
    PUSH(),
    // Saved on Continue too, so a default nobody touched is still recorded.
    // Then the screen is asked for again: it is written in the first language
    // chosen here (onboardLanguage), which the server did not know until now.
    // The step moves first, and the stage remembers the furthest step it has
    // shown, so the new copy of the screen opens where the person already is.
    BTN(EN["ob.cont"], seq(
      { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } },
      p.desktop
        ? SET(p.I.try!)
        : when({ truthy: "keyboardReady" }, SET(p.I.try!), SET(p.I.keyboard!)),
      { kind: "refresh" },
    )),
  ]);
}

/** The little keyboard in a row of Keyboard's steps: three bars, one lit, and the thing to tap or flip on it. */
export function miniKeyboard(lit: number, kind: "point" | "toggle"): Node {
  const marker: Node = kind === "point"
    ? { type: "Stack", style: { position: "absolute", right: -3, top: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: OB.neon, borderWidth: 1.5, borderColor: OB.ink } }
    : { type: "Stack", style: { position: "absolute", right: 2, top: -1, width: 9, height: 6, borderRadius: 3, backgroundColor: OB.ink } };
  return {
    type: "Stack",
    style: {
      width: 60, height: 46, borderRadius: 9, backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink,
      paddingVertical: 6, paddingHorizontal: 5, gap: 4, marginLeft: "auto",
    },
    children: [0, 1, 2].map((i): Node => i === lit
      ? { type: "Stack", style: { height: 8, borderRadius: 4, backgroundColor: OB.neonSoft, borderWidth: 1, borderColor: OB.neonLine }, children: [marker] }
      : { type: "Stack", style: { height: 8, borderRadius: 4, backgroundColor: OB.hair } }),
  };
}

export function keyboardStep(p: Plan): Node {
  const row = (n: number, k: ObKey, mini: Node): Node => ({
    type: "Stack",
    style: {
      flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.hair,
      borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 7,
    },
    children: [
      {
        type: "Stack",
        style: { width: 24, height: 24, borderRadius: 12, backgroundColor: OB.ink, alignItems: "center", justifyContent: "center" },
        children: [TXT(String(n), { fontSize: 13, fontWeight: "700", color: OB.surf })],
      },
      TXT(EN[k], { flex: 1, fontSize: 14, lineHeight: 18, color: OB.ink }),
      mini,
    ],
  });
  // iOS gives an app its own Settings page only after the app has asked for a
  // permission, so the microphone is first asked HERE, as Open Settings is
  // tapped (the reasoning of the old onboardingKeyboard). The box beside the
  // button says why the keyboard needs Full Access.
  const why: Node = {
    type: "Stack",
    style: { backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink, borderRadius: 16, paddingTop: 11, paddingHorizontal: 14, paddingBottom: 12, marginTop: 6 },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", gap: 7, alignItems: "center" },
        children: [ICON("lock", 17, OB.ink), TXT(EN["s3.wh"], { fontSize: 15, fontWeight: "700", color: OB.ink })],
      },
      TXT(EN["s3.wp"], { fontSize: 14, lineHeight: 19, color: OB.ink2 }),
    ],
  };
  return p.step("keyboard", [
    HD(p.spot("tap", 84, "s3.say")),
    H("s3.h"),
    P("s3.p"),
    row(1, p.ios ? "s3.1" : "s3.1a", miniKeyboard(0, "point")),
    row(2, p.ios ? "s3.2" : "s3.2a", miniKeyboard(1, "point")),
    row(3, p.ios ? "s3.3" : "s3.3a", miniKeyboard(2, "toggle")),
    p.ios ? why : null,
    PUSH(),
    BTN(
      EN["s3.cta"],
      p.ios
        ? seq({ kind: "requestPermission", permission: "microphone" }, { kind: "openUrl", url: "app-settings:", external: true })
        : { kind: "openSettings", target: "keyboard" },
    ),
    BTN2(EN["s3.done"], SET(p.I.try!)),
    // The keyboard can be switched on outside the app: the app re-reads the
    // device when it comes back, and the step moves on by itself a beat later.
    {
      type: "Stack",
      style: { height: 0 },
      visibleIf: { truthy: "keyboardReady" },
      on: { onAppear: seq({ kind: "delay", ms: 1100 }, haptic("success"), SET(p.I.try!)) },
    },
  ]);
}

function tryStep(p: Plan): Node {
  const idle: Condition = { eq: ["mic", "idle"] };
  const caption = (k: ObKey, show: Condition): Node =>
    ({ ...TXT(EN[k], { fontSize: 14.5, fontWeight: "600", color: OB.ink2, textAlign: "center" }), visibleIf: show });
  const untried: Condition = { falsy: "tried" };
  const tried: Condition = { truthy: "tried" };
  return p.step("try", [
    HD(
      { ...p.spot("present", 96, "s4.say"), visibleIf: { all: [idle, untried] } },
      { ...p.spot("listen", 96, "s4.say1"), visibleIf: { in: ["mic", ["recording", "busy"]] } },
      { ...p.spot("tada", 96, "s4.say2", "side", { burst: true }), visibleIf: { all: [idle, tried] } },
    ),
    H("s4.h"),
    P("s4.p"),
    p.desktop
      ? {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
          children: [
            TXT(EN["s4.keys.d"], { fontSize: 14, color: OB.ink2 }),
            { type: "Keys", props: { source: "hotkey", cls: "d-keys-small" } },
          ],
        }
      : null,
    {
      type: "Stack",
      style: { gap: 8, marginVertical: 4 },
      children: [
        {
          type: "Stack",
          style: { borderRadius: 16, padding: 11, borderWidth: 1.5, borderColor: OB.hair, backgroundColor: OB.surf },
          children: [LAB("s4.you"), TXT(EN["s4.ex"], { fontSize: 16, fontStyle: "italic", color: OB.ink2 })],
        },
        {
          type: "Stack",
          style: {
            borderRadius: 16, padding: 11, minHeight: 70, borderWidth: 1.5, borderColor: OB.ink,
            backgroundColor: IF(tried, OB.neonSoft, OB.white),
          },
          children: [
            LAB("s4.me"),
            { ...TXT("• • •", { fontSize: 18, letterSpacing: 3.6, color: OB.ti2 }), visibleIf: untried },
            { ...FROM("tried", { fontSize: 17, lineHeight: 22, fontWeight: "600", color: OB.ink }), visibleIf: tried },
          ],
        },
      ],
    },
    {
      type: "Stack",
      style: { alignItems: "center", gap: 8, marginTop: 6 },
      children: [
        {
          type: "Stack",
          style: {
            width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: "center", justifyContent: "center",
            borderColor: IF({ eq: ["mic", "recording"] }, OB.neon, "transparent"),
          },
          children: [{
            type: "VoiceButton",
            bind: { value: "tried", state: "mic" },
            // Hold to speak, release to stop; the glyph is ours, drawn in place of a label.
            props: { hold: true, size: 88, radius: 44, background: OB.ink, recordingBackground: OB.ink, label: "", stopLabel: "", transcribingLabel: "" },
            style: { width: 88, height: 88, paddingVertical: 0, alignItems: "center", justifyContent: "center" },
            on: { onError: toast(EN["s4.err"], "error") },
            children: [ICON("mic", 38, OB.surf)],
          }],
        },
        caption("s4.hold", { all: [idle, untried] }),
        caption("s4.live", { eq: ["mic", "recording"] }),
        caption("s4.busy", { eq: ["mic", "busy"] }),
        caption("s4.again", { all: [idle, tried] }),
      ],
    },
    { ...FINE("s4.ok", true), visibleIf: tried },
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("try"))),
  ]);
}

/** One row of Make me yours: the glyph, what it is for, and a switch. */
export function permRow(icon: keyof typeof IC, title: string, why: string, path: string, action: string, extra: Style = {}): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: OB.hair, ...extra },
    children: [
      {
        type: "Stack",
        style: { width: 38, height: 38, borderRadius: 11, backgroundColor: OB.card, borderWidth: 1.5, borderColor: OB.hair, alignItems: "center", justifyContent: "center" },
        children: [ICON(icon, 20, OB.ink)],
      },
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          TXT(title, { fontSize: 15.5, fontWeight: "700", color: OB.ink }),
          TXT(why, { fontSize: 13, lineHeight: 17, color: OB.ink2 }),
        ],
      },
      { type: "Switch", bind: { value: path }, props: { onColor: OB.ink, offColor: OB.ti3 }, on: { onChange: action } },
    ],
  };
}

/**
 * Make me yours (phone only): Notifications and Microphone, with one switch for
 * both. It asks for exactly what a feature uses today (approval pushes open the
 * approval screen; the mic is the mic). Contacts and Calendar are not here:
 * nothing in the product uses either, so asking would be a promise with nothing
 * behind it. A row comes back as a deploy once a feature needs it.
 */
export function yoursStep(p: Plan): Node {
  const both = bothPerms;
  const foot = FINE("s5.foot");
  foot.style = { ...foot.style, marginTop: 8 };
  return p.step("yours", [
    HD(
      { ...p.spot("pointd", 100, "s5.say"), visibleIf: { not: both } },
      { ...p.spot("thumbs", 100, "s5.say"), visibleIf: both },
    ),
    H("s5.h"),
    P("s5.p"),
    {
      type: "Stack",
      style: { backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.ink, borderRadius: 20, overflow: "hidden" },
      children: [
        permRow("check", EN["s5.all"], EN["s5.allsub"], "perm.all", "allowBoth", { backgroundColor: OB.neonSoft }),
        permRow("bell", EN.pn, EN["pn.d"], "perm.n", "askPush"),
        permRow("mic", EN.pm, EN["pm.d"], "perm.m", "askMic"),
      ],
    },
    foot,
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("yours"))),
  ], { on: { onAppear: "checkPerms" } });
}

/** An app's first letter on a rounded square (no logos to carry). It is the app's, so it comes from state. */
function appMark(id: string, size: number): Node {
  return {
    type: "Stack",
    style: {
      width: size, height: size, borderRadius: Math.round(size * 0.29), backgroundColor: OB.card, borderWidth: 1.5, borderColor: OB.hair,
      alignItems: "center", justifyContent: "center",
    },
    children: [FROM(`ini.${id}`, { fontFamily: OB.grotesk, fontSize: Math.round(size * 0.42), color: OB.ink })],
  };
}

/** The small pill under an app's name. */
function appPill(inner: Node[], style: Style): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, ...style },
    children: inner,
  };
}

function appTile(a: ConnectorInfo, p: Plan): Node {
  const connected = a.connected;
  return {
    type: "Stack",
    // A tile that is already connected has nothing left to do. On the phone the
    // press opens the sheet that says what happens first; a window connects at once.
    ...(connected
      ? {}
      : { on: { onPress: p.desktop ? ({ kind: "connector.connect", id: a.id } as ActionSpec) : seq(haptic("selection"), setState(`sheet.${a.id}`, true)) } }),
    props: { pressOpacity: 0.7 },
    style: {
      borderRadius: 16, paddingTop: 10, paddingHorizontal: 6, paddingBottom: 9, alignItems: "center", gap: 4,
      backgroundColor: OB.surf, borderWidth: 1.5, borderColor: connected ? OB.ink : OB.hair,
    },
    children: [
      appMark(a.id, 42),
      FROM(`n.${a.id}`, { fontSize: 14, fontWeight: "700", color: OB.ink, textAlign: "center" }),
      connected
        ? appPill(
            [ICON("check", 12, OB.ink), TXT(words("st.ok"), { fontSize: 11.5, fontWeight: "700", color: OB.ink })],
            { backgroundColor: OB.neonSoft, borderWidth: 1, borderColor: OB.neonLine },
          )
        : appPill([TXT(words("connect"), { fontSize: 11.5, fontWeight: "700", color: OB.surf })], { backgroundColor: OB.ink }),
    ],
  };
}

/** The tile that opens the whole Connected apps screen (phone). */
function moreAppsTile(): Node {
  return {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: { kind: "navigate", screenId: "assistant_apps" } },
    style: {
      borderRadius: 16, paddingTop: 10, paddingHorizontal: 6, paddingBottom: 9, alignItems: "center", gap: 4,
      backgroundColor: OB.surf, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1,
    },
    children: [
      {
        type: "Stack",
        style: { width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1, alignItems: "center", justifyContent: "center" },
        children: [TXT("+", { fontFamily: OB.grotesk, fontSize: 18, color: OB.ink })],
      },
      TXT(words("s6.more"), { fontSize: 14, fontWeight: "700", color: OB.ink, textAlign: "center" }),
      appPill([TXT(EN["s6.all"], { fontSize: 11.5, fontWeight: "700", color: OB.ink2 })], { borderWidth: 1, borderStyle: "dashed", borderColor: OB.ti1 }),
    ],
  };
}

/** What Connect does on a phone, said first: what the app is, what happens to what I read, and the button. */
function connectSheet(a: ConnectorInfo): Node {
  return {
    type: "BottomSheet",
    bind: { open: `sheet.${a.id}` },
    props: { background: OB.surf, radius: 28, padding: 16, paddingBottom: 34, handleColor: OB.ti2, scrimColor: "rgba(28,26,23,0.34)" },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
        children: [
          appMark(a.id, 46),
          {
            type: "Stack",
            style: { flex: 1, gap: 2 },
            children: [
              FROM(`n.${a.id}`, { fontSize: 20, fontWeight: "700", color: OB.ink }),
              TXT(words("st.no"), { fontSize: 13.5, color: OB.ink2 }),
            ],
          },
        ],
      },
      TXT(a.oneLine, { fontSize: 14, lineHeight: 20, color: OB.ink, marginBottom: 10 }),
      TXT(words("a2.ai", { app: a.name }), { fontSize: 12.5, lineHeight: 19, color: OB.ink2, marginBottom: 14 }),
      // The in-app browser, not openUrl: its promise settles when the person
      // closes it, so the refresh after it redraws the tile as Connected.
      BTN(words("connect"), seq(
        setState(`sheet.${a.id}`, false),
        haptic("selection"),
        {
          kind: "callEndpoint", method: "POST", path: `/v1/connectors/${a.id}/connect`, body: {}, assignTo: "link",
          onSuccess: seq({ kind: "openInAppBrowser", url: "$state.link.authorizeUrl" }, { kind: "refresh" }),
          onError: toast(words("err.connect"), "error"),
        },
      )),
    ],
  };
}

export function appsStep(p: Plan): Node {
  const five = p.five;
  const anyConnected = p.apps.some((a) => a.connected);
  return p.step("apps", [
    HD(p.spot("carry", 100, "s6.say")),
    H("s6.h"),
    P("s6.p"),
    LABEL(words("s6.sug")),
    {
      type: "Grid",
      props: { columns: 3, gap: 8 },
      children: nodes([...five.map((a) => appTile(a, p)), p.desktop ? null : moreAppsTile()]),
    },
    p.desktop ? FINE("s6.ai") : null,
    PUSH(),
    // Dimmed until one app is connected. Known by the server, fresh on every fetch.
    BTN(EN["ob.cont"], SET(p.I.careful!), !anyConnected),
    BTN2(EN["ob.skip"], SET(p.I.careful!)),
    ...(p.desktop ? [] : five.filter((a) => !a.connected).map(connectSheet)),
  ]);
}

/** How the three flow pills read: the second one lit, a "›" between. */
function flow(line: string): Node {
  const parts = line.split("|");
  const out: Node[] = [];
  parts.forEach((part, i) => {
    if (i) out.push(TXT("›", { fontSize: 12, color: OB.ti1 }));
    out.push({
      type: "Stack",
      style: {
        paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: i === 1 ? OB.neonSoft : OB.card,
        borderWidth: 1, borderColor: i === 1 ? OB.neonLine : OB.hair,
      },
      children: [TXT(part, { fontSize: 12, fontWeight: "600", color: OB.ink })],
    });
  });
  return { type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }, children: out };
}

/** One of the three rules, as a card. The cards explain; they are not pressable. */
function careCard(icon: keyof typeof IC, h: ObKey, body: ObKey, f: ObKey, strong: boolean): Node {
  return {
    type: "Stack",
    style: {
      flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, marginBottom: 10, backgroundColor: strong ? OB.white : OB.surf,
      borderWidth: 1.5, borderColor: strong ? OB.ink : OB.hair,
    },
    children: [
      {
        type: "Stack",
        style: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: OB.ink, alignItems: "center", justifyContent: "center" },
        children: [ICON(icon, 13, OB.ink)],
      },
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          TXT(EN[h], { fontSize: 17, fontWeight: "700", color: OB.ink }),
          TXT(EN[body], { fontSize: 14, lineHeight: 19, color: OB.ink2, marginTop: 3, marginBottom: 8 }),
          flow(EN[f]),
        ],
      },
    ],
  };
}

export function carefulStep(p: Plan): Node {
  return p.step("careful", [
    HD(p.spot("think", 100, "s7.say")),
    H("s7.h"),
    P("s7.p"),
    careCard("eye", "c1.h", "c1.p", "c1.f", false),
    careCard("check", "c2.h", "c2.p", "c2.f", true),
    careCard("lock", "c3.h", "c3.p", "c3.f", false),
    FINE("s7.foot"),
    PUSH(),
    BTN(EN["s7.cta"], SET(p.I.done!)),
  ]);
}

export function doneStep(p: Plan): Node {
  return p.step("done", [
    C1(p.spot("tada", 190, "s8.say", "corner", { burst: true })),
    H("s8.h", true),
    P(p.desktop ? "s8.p.d" : "s8.p", { textAlign: "center", paddingHorizontal: 6 }),
    {
      type: "Stack",
      style: {
        flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink,
        borderRadius: 16, padding: 12, marginTop: 4,
      },
      children: [ICON("mic", 20, OB.ink), TXT(EN[p.appsOn ? "s8.try" : "s8.try0"], { flex: 1, fontSize: 15, lineHeight: 20, color: OB.ink })],
    },
    PUSH(),
    BTN(EN["s8.cta"], "finish"),
    FINE(p.appsOn ? "s8.fine" : "s8.fine0", true),
  ]);
}

/** What Make me yours does with its three switches (phone). A yes cannot be taken back in the app: only Settings can. */
export function permActions(): Record<string, ActionSpec> {
  const blocked = toast(EN["s5.blocked"]);
  return {
    checkPerms: seq(
      { kind: "checkPermission", permission: "notifications", onGranted: setState("perm.n", true) },
      { kind: "checkPermission", permission: "microphone", onGranted: setState("perm.m", true) },
      when(bothPerms, setState("perm.all", true)),
    ),
    askPush: when(
      { truthy: "perm.n" },
      { kind: "requestPushPermission", onGranted: seq(setState("perm.n", true), haptic("success"), "syncAll"), onDenied: seq(setState("perm.n", false), blocked) },
      seq(setState("perm.n", true), toast(EN["s5.off"])),
    ),
    askMic: when(
      { truthy: "perm.m" },
      {
        kind: "requestPermission", permission: "microphone",
        onGranted: seq(setState("perm.m", true), "syncAll"),
        onDenied: seq(setState("perm.m", false), blocked),
        onBlocked: seq(setState("perm.m", false), blocked, { kind: "openSettings", target: "app" }),
      },
      seq(setState("perm.m", true), toast(EN["s5.off"])),
    ),
    allowBoth: when(
      { truthy: "perm.all" },
      seq(
        { kind: "requestPushPermission", onGranted: setState("perm.n", true) },
        { kind: "requestPermission", permission: "microphone", onGranted: setState("perm.m", true), onBlocked: blocked },
        "syncAll",
      ),
      seq("syncAll", toast(EN["s5.off"])),
    ),
    syncAll: when(bothPerms, seq(setState("perm.all", true), haptic("success")), setState("perm.all", false)),
  };
}

/**
 * The screen after sign-in. Phone: Languages, Keyboard, Try it, Make me yours,
 * [Connect apps, How careful,] Done. Window: Languages, Try it, [Connect apps,
 * How careful,] Done. `firstTabId` is where Done lands a window without the
 * desk.
 */
export function onboardScreen(ctx: ScreenContext, firstTabId = "home"): ScreenResponse {
  const desktop = ctx.formFactor === "desktop";
  const desk = desktop && !!ctx.can?.has("DeskShell");
  const ios = ctx.platform !== "android";
  const apps = ctx.assistant?.apps ?? [];
  // The tiles: the catalog's own apps that sign in (not one added by link), in
  // catalog order, the first five.
  const five = apps.filter((a) => !a.custom && a.auth === "oauth").slice(0, 5);
  // The apps steps need the feature on AND something to connect: a read that
  // failed (no assistant) leaves them out rather than drawing an empty grid.
  const appsOn = ctx.connectorsOn === true && five.length > 0;
  const ids = postAuthSteps(desktop, appsOn);
  const I = Object.fromEntries(ids.map((id, i) => [id, i]));
  const p: Plan = {
    desktop, ios, appsOn, I,
    next: (id) => I[ids[ids.indexOf(id) + 1]!]!,
    apps, five,
    step: STEP, spot: SPOT,
  };

  const build: Record<string, () => Node> = {
    languages: () => languagesStep(p),
    keyboard: () => keyboardStep(p),
    try: () => tryStep(p),
    yours: () => yoursStep(p),
    apps: () => appsStep(p),
    careful: () => carefulStep(p),
    done: () => doneStep(p),
  };

  // What the person already told us, else a guess from where the phone is.
  const saved = (ctx.personality.languages ?? []).map(String);
  const langs = saved.length ? saved : /-IN$/i.test(ctx.locale ?? "") ? ["hinglish", "hi", "en"] : ["en"];

  // The apps' names and first letters are theirs, not ours: in state, so the
  // translator never sees them (assistant.ts says why).
  const state: Record<string, unknown> = {
    step: onboardStart({ desktop, languagesSet: saved.length > 0, keyboardReady: ctx.keyboardReady === true, I }),
    langs,
    ln: Object.fromEntries(DAILY_LANGUAGES.filter(shownChip).map((l) => [l.value, l.label])),
    // Overwritten live by the app, which re-reads the device on a timer and on
    // every return to the foreground. Declared with the conservative answer.
    keyboardReady: false, keyboardEnabled: false, micGranted: false,
    mic: "idle", tried: "",
    perm: { all: false, n: false, m: false },
    sheet: Object.fromEntries(five.map((a) => [a.id, false])),
    link: {},
    n: Object.fromEntries(five.map((a) => [a.id, a.name])),
    ini: Object.fromEntries(five.map((a) => [a.id, a.name.trim().charAt(0).toUpperCase() || "?"])),
  };

  // Where Done lands: the phone on You (where the name card still appears, as
  // before), a window on the desk's Today, or on its first tab without the desk.
  const landed: ActionSpec = {
    kind: "sequence",
    actions: [haptic("success"), { kind: "switchTab", tabId: desktop ? (desk ? "desk_today" : firstTabId) : "personality" }],
  };
  const actions: Record<string, ActionSpec> = {
    finish: { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true }, onSuccess: "finishOk", onError: "finishErr" },
    finishOk: landed,
    finishErr: toast(EN["ob.err.finish"], "error"),
    ...(desktop ? {} : permActions()),
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboard",
    title: "",
    hideChrome: true,
    state,
    actions,
    root: {
      type: "OnboardStage",
      bind: { step: "step" },
      props: stageProps("onboard", 3, 3 + ids.length),
      children: ids.map((id) => build[id]!()),
    },
    cacheTtlSeconds: 0,
  };
}
