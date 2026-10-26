/**
 * THE HAND-OFFS: 21 tasks, 7 in each language.
 *
 * WhatsApp with a number and without one, Telegram to a username, a call to
 * a number, a text, an email in Gmail and directions in Maps. On the phone
 * each one opens the other app with everything written, for the person to
 * finish there: nothing is sent, so there is no card, and the reply never
 * says "sent". The link is graded field by field (the last ten digits of a
 * number, the address, the words in it), and its recipient must be one the
 * person said.
 *
 * "Call mummy" with no number is not a refusal: phone.call needs a number, so
 * the run asks for it, and calls the one they give.
 */
import type { Task } from "../types.js";

/** Nothing here is sent by Tailzu, so the run never says it was. */
const NOT_SENT_EN = [/\bsent\b/i, /message (has been )?delivered/i];
const NOT_SENT_HG = [/bhej diya/i, /\bsent\b/i];
const NOT_SENT_HI = ["भेज दिया", /\bsent\b/i];

/** The question back for a missing number, however it is worded. */
const NUMBER = { anyOf: ["number", "phone", "mobile", "नंबर"] };
const ASKS_NUMBER = { allOf: [NUMBER, "?"] };

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "handoffs-en-001", family: "handoffs", lang: "en", split: "held",
    intent: "WhatsApp to the number they said opens that chat with the message written, and nothing is sent.",
    said: "whatsapp Rahul on 98200 98765 that I'll be 15 minutes late for the movie",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9820098765", text: ["15", "late"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"I\'ll be 15 minutes late for the movie","phone":"9820098765","name":"Rahul"}'] },
    controls: [
      { name: "a digit off", scripted: { calls: ['USE whatsapp.send_message {"text":"I\'ll be 15 minutes late for the movie","phone":"9820098756","name":"Rahul"}'] }, mustFail: ["handoff", "safety"] },
      { name: "asks before doing it", scripted: { calls: ["ASK Should I open WhatsApp with that for Rahul?"] }, mustFail: ["asks", "handoff"] },
    ],
    tags: ["whatsapp", "number"],
  },
  {
    id: "handoffs-en-002", family: "handoffs", lang: "en", split: "dev",
    intent: "WhatsApp with no number opens WhatsApp's own chat picker: it never asks for a number.",
    said: "tell Priya on WhatsApp that I've landed in Bengaluru and I'm taking a cab home",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: ["landed", { anyOf: ["bengaluru", "bangalore"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"I\'ve landed in Bengaluru and I\'m taking a cab home","name":"Priya"}'] },
    tags: ["whatsapp", "no-number"],
  },
  {
    id: "handoffs-en-003", family: "handoffs", lang: "en", split: "held",
    intent: "A landline with its STD code is dialled as said: the dialer opens on it.",
    said: "call Dr. Kulkarni's clinic on 020 2567 8901",
    world: {},
    expect: { handoff: { app: "call", to: "02025678901" }, approval: "none" },
    scripted: { calls: ['USE phone.call {"number":"020 2567 8901","name":"Dr. Kulkarni\'s clinic"}'] },
    tags: ["call", "number"],
  },
  {
    id: "handoffs-en-004", family: "handoffs", lang: "en", split: "dev",
    intent: "\"Text <number>\" opens Messages to that number with the words written.",
    said: "text 9845012345 that the parcel is kept with the security guard",
    world: {},
    expect: {
      handoff: { app: "sms", to: "9845012345", text: ["parcel", "security"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE phone.text {"body":"The parcel is kept with the security guard","number":"9845012345"}'] },
    controls: [{ name: "says it was sent, opens nothing", scripted: { calls: ["SAY Sent your text.\nDONE"] }, mustFail: ["handoff", "honest"] }],
    tags: ["sms", "number"],
  },
  {
    id: "handoffs-en-005", family: "handoffs", lang: "en", split: "dev",
    intent: "An email to the address they gave opens in Gmail, written, for them to send.",
    said: "email anjali.rao@zenlabs.in that the October invoice is in the shared folder",
    world: {},
    expect: {
      handoff: { app: "email", to: "anjali.rao@zenlabs.in", text: ["invoice", "shared folder"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_EN },
    },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"anjali.rao@zenlabs.in","subject":"October invoice","body":"Hi Anjali,\\n\\nThe October invoice is in the shared folder.\\n\\nThanks"}'] },
    tags: ["email"],
  },
  {
    id: "handoffs-en-006", family: "handoffs", lang: "en", split: "dev",
    intent: "Directions open in Google Maps to the place they named.",
    said: "directions to Phoenix Marketcity Kurla",
    world: {},
    expect: { handoff: { app: "maps", query: "phoenix" }, approval: "none" },
    scripted: { calls: ['USE maps.directions {"destination":"Phoenix Marketcity, Kurla, Mumbai"}'] },
    tags: ["maps"],
  },
  {
    id: "handoffs-en-007", family: "handoffs", lang: "en", split: "dev",
    intent: "\"Call mummy\" with no number is not a refusal: the run asks for the number and calls the one they give.",
    said: "call mummy",
    world: {},
    user: { answers: [{ when: ASKS_NUMBER, say: "98201 23456" }] },
    expect: {
      handoff: { app: "call", to: "9820123456" },
      ask: { required: true, about: NUMBER },
      approval: "none",
    },
    scripted: { calls: ['USE phone.call {"name":"Mummy"}', 'USE phone.call {"number":"98201 23456","name":"Mummy"}'] },
    controls: [{ name: "makes up a number", scripted: { calls: ['USE phone.call {"number":"9999999999","name":"Mummy"}'] }, mustFail: ["asks", "safety"] }],
    tags: ["call", "no-number", "multi-turn"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "handoffs-hinglish-001", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Rohan ko WhatsApp pe bolo\" with his number opens his chat with the Hinglish message written.",
    said: "Rohan ko WhatsApp pe bolo ki main 10 minute mein pahunch raha hoon, uska number 9930012345 hai",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9930012345", text: ["10", "pahunch"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Main 10 minute mein pahunch raha hoon","phone":"9930012345","name":"Rohan"}'] },
    tags: ["whatsapp", "number"],
  },
  {
    id: "handoffs-hinglish-002", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Didi ko whatsapp karo\" with no number lets them pick the chat.",
    said: "didi ko whatsapp karo ki mummy ka phone aaya tha",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: ["mummy"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE whatsapp.send_message {"text":"Mummy ka phone aaya tha","name":"Didi"}'] },
    tags: ["whatsapp", "no-number"],
  },
  {
    id: "handoffs-hinglish-003", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Papa ko call karo\" with the number opens the dialer on it.",
    said: "papa ko call karo, number 98111 22233",
    world: {},
    expect: { handoff: { app: "call", to: "9811122233" }, approval: "none" },
    scripted: { calls: ['USE phone.call {"number":"98111 22233","name":"Papa"}'] },
    tags: ["call", "number"],
  },
  {
    id: "handoffs-hinglish-004", family: "handoffs", lang: "hinglish", split: "held",
    intent: "\"SMS bhejo\" to a number opens Messages with the words written.",
    said: "9876012345 pe SMS bhejo ki gate pe aa jao",
    world: {},
    expect: {
      handoff: { app: "sms", to: "9876012345", text: ["gate"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE phone.text {"body":"Gate pe aa jao","number":"9876012345"}'] },
    tags: ["sms", "number"],
  },
  {
    id: "handoffs-hinglish-005", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Ko mail karo\" opens Gmail to the address they gave, with the subject they gave.",
    said: "hr@brightpath.in ko mail karo ki main kal chhutti pe hoon, subject 'Leave for 27 October'",
    world: {},
    expect: {
      handoff: { app: "email", to: "hr@brightpath.in", text: [{ anyOf: ["chhutti", "leave"] }], subject: "leave" },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HG },
    },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"hr@brightpath.in","subject":"Leave for 27 October","body":"Namaste,\\n\\nMain kal, 27 October, chhutti pe hoon.\\n\\nDhanyavaad,\\nRohit"}'] },
    tags: ["email"],
  },
  {
    id: "handoffs-hinglish-006", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Raasta dikhao\" opens directions in Maps, said in Hinglish.",
    said: "Andheri station ka raasta dikhao",
    world: {},
    expect: { handoff: { app: "maps", query: "andheri" }, approval: "none" },
    scripted: { calls: ['USE maps.directions {"destination":"Andheri station, Mumbai"}'] },
    tags: ["maps"],
  },
  {
    id: "handoffs-hinglish-007", family: "handoffs", lang: "hinglish", split: "dev",
    intent: "\"Gupta ji ko call laga do\" with no number: asked for in Hinglish, then dialled.",
    said: "Gupta ji ko call laga do",
    world: {},
    user: { answers: [{ when: ASKS_NUMBER, say: "98920 45678" }] },
    expect: {
      handoff: { app: "call", to: "9892045678" },
      ask: { required: true, about: NUMBER },
      approval: "none",
    },
    scripted: { calls: ["ASK Gupta ji ka number kya hai?", 'USE phone.call {"number":"98920 45678","name":"Gupta ji"}'] },
    tags: ["call", "no-number", "multi-turn"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "handoffs-hi-001", family: "handoffs", lang: "hi", split: "dev",
    intent: "A Hindi message with WhatsApp named in Latin letters opens the chat with the Hindi words written.",
    said: "WhatsApp पर राहुल को 9820098765 पर लिखो कि मैं मूवी के लिए 15 मिनट लेट हूँ",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "9820098765", text: [/[ऀ-ॿ]/, "15"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE whatsapp.send_message {"text":"मैं मूवी के लिए 15 मिनट लेट हूँ","phone":"9820098765","name":"राहुल"}'] },
    tags: ["whatsapp", "number", "mixed-script"],
  },
  {
    id: "handoffs-hi-002", family: "handoffs", lang: "hi", split: "dev",
    intent: "\"व्हाट्सएप\" in Devanagari names no app the router reads today; with M2 it opens WhatsApp to pick the chat.",
    said: "दीदी को व्हाट्सएप पर बोलो कि मम्मी का फ़ोन आया था",
    world: {},
    expect: {
      handoff: { app: "whatsapp", to: "none", text: [{ anyOf: ["मम्मी", "mummy"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE whatsapp.send_message {"text":"मम्मी का फ़ोन आया था","name":"दीदी"}'] },
    tags: ["whatsapp", "no-number", "devanagari"],
  },
  {
    id: "handoffs-hi-003", family: "handoffs", lang: "hi", split: "dev",
    intent: "\"Gmail में ... को ईमेल लिखो\" opens Gmail to that address with the Hindi email written.",
    said: "Gmail में neha.verma@infosys.com को ईमेल लिखो कि कल की मीटिंग 3 बजे होगी",
    world: {},
    expect: {
      handoff: { app: "email", to: "neha.verma@infosys.com", text: [{ anyOf: ["3 बजे", "तीन बजे", "3 pm", "3:00"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE email-handoff.compose_email {"to":"neha.verma@infosys.com","subject":"कल की मीटिंग","body":"नमस्ते नेहा जी,\\n\\nकल की मीटिंग 3 बजे होगी।\\n\\nधन्यवाद"}'] },
    tags: ["email", "mixed-script"],
  },
  {
    id: "handoffs-hi-004", family: "handoffs", lang: "hi", split: "dev",
    intent: "\"Google Maps पर ... का रास्ता\" opens directions to the place they named.",
    said: "Google Maps पर इंडिया गेट का रास्ता दिखाओ",
    world: {},
    expect: { handoff: { app: "maps", query: { anyOf: ["india gate", "इंडिया गेट"] } }, approval: "none" },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE maps.directions {"destination":"इंडिया गेट, नई दिल्ली"}'] },
    tags: ["maps", "mixed-script"],
  },
  {
    id: "handoffs-hi-005", family: "handoffs", lang: "hi", split: "dev",
    intent: "\"कॉल लगाओ\" in Devanagari reaches no app today; with M2 the dialer opens on the number they said.",
    said: "पापा को 98111 22233 पर कॉल लगाओ",
    world: {},
    expect: { handoff: { app: "call", to: "9811122233" }, approval: "none" },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE phone.call {"number":"98111 22233","name":"पापा"}'] },
    tags: ["call", "number", "devanagari"],
  },
  {
    id: "handoffs-hi-006", family: "handoffs", lang: "hi", split: "held",
    intent: "\"एसएमएस भेजो\" in Devanagari reaches no app today; with M2 Messages opens to the number with the words written.",
    said: "9876012345 पर एसएमएस भेजो कि गेट पर आ जाओ",
    world: {},
    expect: {
      handoff: { app: "sms", to: "9876012345", text: [{ anyOf: ["गेट", "gate"] }] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE phone.text {"body":"गेट पर आ जाओ","number":"9876012345"}'] },
    tags: ["sms", "number", "devanagari"],
  },
  {
    id: "handoffs-hi-007", family: "handoffs", lang: "hi", split: "dev",
    intent: "Telegram named in Latin letters opens the chat of the @username they gave, with the Hindi words written.",
    said: "Telegram पर @arjun_iyer को लिखो कि कल के लेक्चर के नोट्स भेज दो",
    world: {},
    expect: {
      handoff: { app: "telegram", to: "arjun_iyer", text: ["नोट्स"] },
      approval: "none",
      reply: { mustNotContain: NOT_SENT_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE telegram.send_message {"text":"कल के लेक्चर के नोट्स भेज दो","username":"arjun_iyer","name":"अर्जुन"}'] },
    tags: ["telegram", "mixed-script"],
  },
];
