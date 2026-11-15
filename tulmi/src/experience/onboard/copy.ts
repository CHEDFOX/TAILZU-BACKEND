/**
 * The onboarding's words: English, and the design's own Hinglish for each line.
 */

import { DAILY_LANGUAGES } from "../phone/languages.js";

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
  "s1.h": "Hi, I’m X0.",
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
  "s3.2": "Switch on X0 Bot",
  "s3.3": "Switch on Allow Full Access",
  "s3.1a": "Tap Open Settings",
  "s3.2a": "Switch on X0 Bot, and tap OK",
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
  "s1.h": "Hi, main X0 hoon.",
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
  "s3.2": "X0 Bot on karo",
  "s3.3": "Allow Full Access on karo",
  "s3.1a": "Open Settings dabao",
  "s3.2a": "X0 Bot on karo, aur OK dabao",
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
// Shorthands
// ---------------------------------------------------------------------------
export const EN = OB_EN;
