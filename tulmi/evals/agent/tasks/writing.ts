/**
 * WORDS WRITTEN FOR THEM: 15 tasks, 5 in each language.
 *
 * A message they asked to have written (to a landlord, a birthday wish), an
 * email (a half day off, an extension), and a short leave note said back.
 * The message and the email are graded on the hand-off itself: every fact
 * they gave is in the words that open in WhatsApp, Messages or Gmail, and a
 * Hindi request gets a message in Devanagari. The leave note is graded on
 * the reply: its facts, and that it stays short.
 *
 * Nothing is sent: the person reads it in the other app and sends it.
 */
import type { Task } from "../types.js";

const NOT_SENT_EN = [/\bsent\b/i];
const NOT_SENT_HG = [/bhej diya/i, /\bsent\b/i];
const NOT_SENT_HI = ["भेज दिया", /\bsent\b/i];

/** Some Devanagari in what was written: a Hindi request gets a Hindi message. */
const IN_HINDI = /[ऀ-ॿ]{3,}/;

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "writing-en-001", family: "writing", lang: "en", split: "dev",
    intent: "A polite message to the landlord carries both facts they gave (rent, 3 days late) to the number they gave.",
    said: "write a polite whatsapp to my landlord Mr. Iyer on 98450 12345 saying this month's rent will be 3 days late because my salary is delayed",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9845012345", text: ["rent", { anyOf: ["3 days", "three days"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Good morning Mr. Iyer, I wanted to let you know that this month\'s rent will be 3 days late, as my salary has been delayed. Sorry for the trouble, and thank you for understanding.","phone":"9845012345","name":"Mr. Iyer"}'] },
    controls: [{ name: "drops a fact", scripted: { calls: ['USE whatsapp.send_message {"text":"Good morning Mr. Iyer, this month\'s rent will be a little late. Sorry!","phone":"9845012345","name":"Mr. Iyer"}'] }, mustFail: ["handoff"] }],
    tags: ["whatsapp", "compose"],
  },
  {
    id: "writing-en-002", family: "writing", lang: "en", split: "dev",
    intent: "An email asking for a half day carries the day and the reason, to the address they gave.",
    said: "draft an email to hr@zentrix.in asking for a half day on Friday for my sister's engagement",
    world: {},
    expect: {
      handoff: { app: "email", to: "hr@zentrix.in", text: [{ anyOf: ["half day", "half-day"] }, { anyOf: ["friday", "30 oct"] }, "engagement"], subject: { anyOf: ["half day", "half-day", "leave"] } },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"hr@zentrix.in","subject":"Half-day leave on Friday, 30 October","body":"Dear HR team,\\n\\nI would like to request a half day on Friday, 30 October, for my sister\'s engagement.\\n\\nThank you,\\nAnanya"}'] },
    tags: ["email", "compose"],
  },
  {
    id: "writing-en-003", family: "writing", lang: "en", split: "held",
    intent: "A two-line leave note is said back short, with the child's name and the reason; nothing opens.",
    said: "write a 2-line leave note for my son Aarav's class teacher, he has a fever and will miss school tomorrow",
    world: {},
    expect: { handoff: "none", reply: { mustContain: ["aarav", "fever"], maxChars: 400 } },
    scripted: { calls: ["SAY Dear Ma'am, Aarav has a fever and will not be able to come to school tomorrow, 27 October. Kindly excuse his absence. Regards, Ananya Iyer\nDONE"] },
    controls: [{
      name: "writes an essay",
      scripted: { calls: ["SAY Dear Ma'am, I am writing to inform you that my son Aarav has been running a high fever since last night, and the doctor has advised him complete rest for at least a day.\nSAY He will therefore not be able to attend school tomorrow, 27 October, and I request you to kindly grant him leave for the day and share any homework he misses.\nSAY Thank you for your understanding and support. With warm regards, Ananya Iyer, mother of Aarav, Class 3 B\nDONE"] },
      mustFail: ["reply"],
    }],
    tags: ["note", "no-app"],
  },
  {
    id: "writing-en-004", family: "writing", lang: "en", split: "dev",
    intent: "A birthday wish written for Kavya opens WhatsApp for them to pick her chat.",
    said: "write a happy birthday message for Kavya and open WhatsApp so I can pick her chat",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: [{ anyOf: ["birthday", "bday"] }, "kavya"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Happy birthday, Kavya! Wishing you a year full of laughter, good food and great adventures. Have the best day!","name":"Kavya"}'] },
    tags: ["whatsapp", "compose"],
  },
  {
    id: "writing-en-005", family: "writing", lang: "en", split: "dev",
    intent: "An email to a professor asking for an extension names the assignment and the day.",
    said: "email my professor dr.mehta@iitb.ac.in asking for an extension on the DBMS assignment till Friday",
    world: {},
    expect: {
      handoff: { app: "email", to: "dr.mehta@iitb.ac.in", text: [{ anyOf: ["extension", "extend"] }, "dbms", { anyOf: ["friday", "30 oct"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"dr.mehta@iitb.ac.in","subject":"Request for extension: DBMS assignment","body":"Dear Prof. Mehta,\\n\\nCould I please have an extension on the DBMS assignment until Friday, 30 October?\\n\\nThank you,\\nIshaan"}'] },
    tags: ["email", "compose"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "writing-hinglish-001", family: "writing", lang: "hinglish", split: "dev",
    intent: "A Hinglish message with the new time (12 baje) goes to the number they gave.",
    said: "Sharma uncle ko WhatsApp pe message likh do ki kal ki society meeting 11 ki jagah 12 baje hogi, number 9811122233",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9811122233", text: [/\b12\b/, { anyOf: ["baje", "bje"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Namaste Sharma uncle, kal ki society meeting 11 ki jagah 12 baje hogi.","phone":"9811122233","name":"Sharma uncle"}'] },
    tags: ["whatsapp", "compose"],
  },
  {
    id: "writing-hinglish-002", family: "writing", lang: "hinglish", split: "held",
    intent: "\"Email likho\" for a day off carries the reason, to the address they gave.",
    said: "hr@brightpath.in ko email likho ki main kal doctor appointment ki wajah se chhutti pe rahunga",
    world: {},
    expect: {
      handoff: { app: "email", to: "hr@brightpath.in", text: ["doctor", { anyOf: ["chhutti", "leave"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"hr@brightpath.in","subject":"Leave on 27 October","body":"Namaste,\\n\\nMain kal, 27 October, doctor appointment ki wajah se chhutti pe rahunga.\\n\\nDhanyavaad,\\nRohit"}'] },
    tags: ["email", "compose"],
  },
  {
    id: "writing-hinglish-003", family: "writing", lang: "hinglish", split: "dev",
    intent: "A short Hinglish leave application said back, with the child's name and the reason.",
    said: "class teacher ke liye 2 line ki leave application likh do, Aarav ko bukhaar hai, kal school nahi aayega",
    world: {},
    expect: { handoff: "none", reply: { mustContain: ["aarav", { anyOf: ["bukhaar", "bukhar", "fever"] }], maxChars: 400 } },
    scripted: { calls: ["SAY Ma'am, Aarav ko bukhaar hai, isliye woh kal 27 October ko school nahi aa payega. Kripya uski chhutti manzoor kar dijiye. Dhanyavaad, Neha Agarwal\nDONE"] },
    tags: ["note", "no-app"],
  },
  {
    id: "writing-hinglish-004", family: "writing", lang: "hinglish", split: "dev",
    intent: "A birthday wish written for Kavya, WhatsApp opened for them to pick the chat.",
    said: "Kavya ke birthday ka ek pyaara sa message likho aur WhatsApp kholo",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: [{ anyOf: ["birthday", "bday", "janamdin"] }, "kavya"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Happy birthday Kavya! Tumhara saal khushiyon aur hasi se bhara rahe. Party kab de rahi ho?","name":"Kavya"}'] },
    tags: ["whatsapp", "compose"],
  },
  {
    id: "writing-hinglish-005", family: "writing", lang: "hinglish", split: "dev",
    intent: "A Diwali wish written for dadi opens Messages to the number they gave.",
    said: "dadi ko Diwali ki badhai ka SMS bhejo, number 9414012345, achha sa likhna",
    world: {},
    expect: {
      handoff: { app: "sms", to: "9414012345", text: [{ anyOf: ["diwali", "deepawali"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE phone.text {"body":"Dadi, aapko Diwali ki dher saari badhai! Aapka aashirwad hamesha hamare saath rahe.","number":"9414012345","name":"Dadi"}'] },
    tags: ["sms", "compose"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "writing-hi-001", family: "writing", lang: "hi", split: "dev",
    intent: "A polite Hindi message to the landlord, in Devanagari, with the rent and the 3 days, to the number they gave.",
    said: "WhatsApp पर मकान मालिक अय्यर जी को 98450 12345 पर विनम्र मैसेज लिखो कि इस महीने का किराया 3 दिन देर से दूँगा",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9845012345", text: [IN_HINDI, { anyOf: ["किराया", "किराए"] }, { anyOf: ["3", "तीन", "३"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE whatsapp.send_message {"text":"नमस्ते अय्यर जी, इस महीने का किराया मैं 3 दिन देर से दूँगा। असुविधा के लिए माफ़ी चाहता हूँ।","phone":"9845012345","name":"अय्यर जी"}'] },
    tags: ["whatsapp", "compose", "mixed-script"],
  },
  {
    id: "writing-hi-002", family: "writing", lang: "hi", split: "dev",
    intent: "A Hindi email for a half day, to the address they gave, with the day and the reason.",
    said: "Gmail में hr@zentrix.in को ईमेल लिखो कि शुक्रवार को बहन की सगाई के लिए आधे दिन की छुट्टी चाहिए",
    world: {},
    expect: {
      handoff: { app: "email", to: "hr@zentrix.in", text: [{ anyOf: ["आधे दिन", "half day"] }, { anyOf: ["शुक्रवार", "friday"] }, { anyOf: ["सगाई", "engagement"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"hr@zentrix.in","subject":"शुक्रवार को आधे दिन की छुट्टी","body":"नमस्ते,\\n\\nशुक्रवार, 30 अक्टूबर को मेरी बहन की सगाई है, इसलिए मुझे आधे दिन की छुट्टी चाहिए।\\n\\nधन्यवाद,\\nसुनीता"}'] },
    tags: ["email", "compose", "mixed-script"],
  },
  {
    id: "writing-hi-003", family: "writing", lang: "hi", split: "held",
    intent: "A two-line Hindi leave note said back, with the child's name and the reason; nothing opens.",
    said: "बेटे आरव की क्लास टीचर के लिए दो लाइन की छुट्टी की अर्ज़ी लिख दो, उसे बुखार है और वह कल स्कूल नहीं आएगा",
    world: {},
    expect: { handoff: "none", reply: { mustContain: ["आरव", "बुखार"], maxChars: 400 } },
    scripted: { calls: ["SAY आदरणीय मैडम, आरव को बुखार है, इसलिए वह कल 27 अक्टूबर को स्कूल नहीं आ पाएगा। कृपया उसकी छुट्टी स्वीकार करें। सुनीता शर्मा\nDONE"] },
    tags: ["note", "no-app"],
  },
  {
    id: "writing-hi-004", family: "writing", lang: "hi", split: "dev",
    intent: "A Hindi birthday wish for Kavya, WhatsApp named in Latin letters and opened for them to pick the chat.",
    said: "काव्या के जन्मदिन के लिए प्यारा सा मैसेज लिखो और WhatsApp खोलो",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: [{ anyOf: ["काव्या", "kavya"] }, { anyOf: ["जन्मदिन", "birthday"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE whatsapp.send_message {"text":"जन्मदिन की ढेर सारी शुभकामनाएँ काव्या! तुम्हारा हर दिन मुस्कान और खुशियों से भरा रहे।","name":"काव्या"}'] },
    tags: ["whatsapp", "compose", "mixed-script"],
  },
  {
    id: "writing-hi-005", family: "writing", lang: "hi", split: "dev",
    intent: "An email asked for wholly in Devanagari, with only the address in Latin letters, reaches no app today; with M2 Gmail opens to that address.",
    said: "प्रोफ़ेसर मेहता को dr.mehta@iitb.ac.in पर ईमेल लिखो कि DBMS असाइनमेंट के लिए शुक्रवार तक का समय चाहिए",
    world: {},
    expect: {
      handoff: { app: "email", to: "dr.mehta@iitb.ac.in", text: ["dbms", { anyOf: ["शुक्रवार", "friday"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"dr.mehta@iitb.ac.in","subject":"DBMS असाइनमेंट के लिए समय","body":"आदरणीय प्रोफ़ेसर मेहता,\\n\\nक्या मुझे DBMS असाइनमेंट जमा करने के लिए शुक्रवार, 30 अक्टूबर तक का समय मिल सकता है?\\n\\nधन्यवाद,\\nईशान"}'] },
    tags: ["email", "compose", "devanagari"],
  },
];
