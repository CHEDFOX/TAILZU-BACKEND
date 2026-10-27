/**
 * THE FRONT DOOR'S OWN SENTENCES, IN THE LANGUAGE THE PERSON WROTE IN.
 *
 * A few fixed lines that are said without asking a model (a question to settle a costly guess, a file kind that cannot be read yet,
 * the label on a one-tap offer). English, Hinglish (Hindi in Latin letters) and Hindi; any other language gets English. They are
 * the product's words, not a prompt, so they are written out here and nowhere else.
 */
import type { AttachmentKind, Clarify, VisualKind } from "./types.js";

export type Lang = "en" | "hinglish" | "hi";

/** The language the classifier read, as one of the three these lines exist in. */
export const langOf = (language: string): Lang => (language === "hinglish" || language === "hi" ? language : "en");

export type ClarifyKind = "code" | "design" | "research" | "general";

const CLARIFY: Record<ClarifyKind, Record<Lang, Clarify>> = {
  code: {
    en: { question: "Do you want me to change the code, or just explain it?", options: ["Change the code", "Just explain it", "Show me a design first"] },
    hinglish: { question: "Kya aap chahte hain ki main code badal doon, ya bas samjha doon?", options: ["Code badal do", "Bas samjha do", "Pehle design dikhao"] },
    hi: { question: "क्या आप चाहते हैं कि मैं कोड बदल दूँ, या बस समझा दूँ?", options: ["कोड बदल दो", "बस समझा दो", "पहले डिज़ाइन दिखाओ"] },
  },
  design: {
    en: { question: "Should I show you a design first, or change the real code?", options: ["Show a design", "Change the code"] },
    hinglish: { question: "Pehle design dikhaun, ya seedha asli code badal doon?", options: ["Design dikhao", "Code badal do"] },
    hi: { question: "पहले डिज़ाइन दिखाऊँ, या सीधे असली कोड बदल दूँ?", options: ["डिज़ाइन दिखाओ", "कोड बदल दो"] },
  },
  research: {
    en: { question: "Do you want a quick answer, or full research with sources?", options: ["Quick answer", "Full research with sources"] },
    hinglish: { question: "Jaldi ka jawab chahiye, ya sources ke saath poori research?", options: ["Jaldi ka jawab", "Poori research"] },
    hi: { question: "जल्दी जवाब चाहिए, या स्रोतों के साथ पूरी रिसर्च?", options: ["जल्दी जवाब", "पूरी रिसर्च"] },
  },
  general: {
    en: { question: "I want to get this right. What would you like me to do?", options: ["Answer a question", "Make a change", "Show me a design"] },
    hinglish: { question: "Main ise sahi karna chahta hoon. Aap kya chahte hain?", options: ["Sawal ka jawab do", "Badlav karo", "Design dikhao"] },
    hi: { question: "मैं इसे सही करना चाहता हूँ। आप क्या चाहते हैं?", options: ["सवाल का जवाब दो", "बदलाव करो", "डिज़ाइन दिखाओ"] },
  },
};

/** The question that settles a guess too costly to make blindly: two or three options. */
export function clarifyFor(kind: ClarifyKind, lang: Lang): Clarify {
  const c = CLARIFY[kind][lang];
  return { question: c.question, options: [...c.options] };
}

const KIND_NAME: Record<Exclude<AttachmentKind, "image" | "text" | "code">, Record<Lang, string>> = {
  audio: { en: "audio files", hinglish: "audio files", hi: "ऑडियो फ़ाइलें" },
  video: { en: "videos", hinglish: "videos", hi: "वीडियो" },
  pdf: { en: "PDFs", hinglish: "PDF files", hi: "PDF फ़ाइलें" },
  document: { en: "Word, PowerPoint and other documents", hinglish: "Word, PowerPoint jaise documents", hi: "Word, PowerPoint जैसे दस्तावेज़" },
  data: { en: "spreadsheets", hinglish: "spreadsheets", hi: "स्प्रेडशीट" },
  archive: { en: "zip files", hinglish: "zip files", hi: "zip फ़ाइलें" },
  other: { en: "this kind of file", hinglish: "is tarah ki file", hi: "इस तरह की फ़ाइल" },
};

/** The clear answer for a kind of attachment that cannot be read yet. */
export function comingSoon(kind: AttachmentKind, lang: Lang): string {
  if (kind === "image" || kind === "text" || kind === "code") return "";
  const name = KIND_NAME[kind][lang];
  if (lang === "hinglish") return `${name[0]!.toUpperCase()}${name.slice(1)} padhna jaldi aa raha hai. Abhi main sirf images aur text ya code files padh sakta hoon.`;
  if (lang === "hi") return `${name} पढ़ना जल्द आ रहा है। अभी मैं सिर्फ़ तस्वीरें और टेक्स्ट या कोड फ़ाइलें पढ़ सकता हूँ।`;
  return `Reading ${name} is coming soon. For now I can read images and text or code files.`;
}

const OFFER: Record<VisualKind, Record<Lang, string>> = {
  table: { en: "Show this as a table", hinglish: "Ise table mein dikhao", hi: "इसे तालिका में दिखाओ" },
  diagram: { en: "Show this as a diagram", hinglish: "Ise diagram mein dikhao", hi: "इसे डायग्राम में दिखाओ" },
  chart: { en: "Show this as a chart", hinglish: "Ise chart mein dikhao", hi: "इसे चार्ट में दिखाओ" },
  component: { en: "Show how it would look", hinglish: "Dikhao yeh kaisa dikhega", hi: "दिखाओ यह कैसा दिखेगा" },
  page: { en: "Show a page for this", hinglish: "Iska ek page dikhao", hi: "इसका एक पेज दिखाओ" },
};

export const offerLabel = (kind: VisualKind, lang: Lang): string => OFFER[kind][lang];

/** Said when a message could not be read at all, in the person's language. */
export const NOTHING: Record<Lang, string> = {
  en: "I did not catch that. What would you like to know or do?",
  hinglish: "Mujhe samajh nahi aaya. Aap kya jaanna ya karna chahte hain?",
  hi: "मुझे समझ नहीं आया। आप क्या जानना या करना चाहते हैं?",
};

const DESIGN_READY: Record<Lang, string> = {
  en: "Here it is. Tell me what you would change.",
  hinglish: "Yeh raha. Batao kya badalna hai.",
  hi: "यह रहा। बताइए क्या बदलना है।",
};
export const designReady = (lang: Lang): string => DESIGN_READY[lang];

const JOB_STARTED: Record<Lang, (branch: string) => string> = {
  en: (b) => `Started. I'm working on a new branch, ${b}, and will show you what I change before anything is merged.`,
  hinglish: (b) => `Shuru kar diya. Main ek nayi branch, ${b}, par kaam kar raha hoon, aur merge se pehle aapko dikhaunga.`,
  hi: (b) => `शुरू कर दिया। मैं एक नई ब्रांच, ${b}, पर काम कर रहा हूँ, और मर्ज से पहले आपको दिखाऊँगा।`,
};
export const jobStarted = (lang: Lang, branch: string): string => JOB_STARTED[lang](branch);
