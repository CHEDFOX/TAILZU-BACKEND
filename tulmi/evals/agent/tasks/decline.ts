/**
 * WHAT TAILZU CANNOT DO, SAID PLAINLY: 15 tasks, 5 in each language.
 *
 * Ordering food on Swiggy or Zomato, booking an Ola, reading their WhatsApp,
 * their bank balance, paying a bill, setting a phone alarm today: the run
 * says it can't, in their language, and does nothing at all. No change, no
 * hand-off, no card, and never another app standing in for the one they
 * named (an Uber for an Ola, an Amazon search for a Swiggy order).
 *
 * One task in each language is the opposite, so that declining is not the
 * easy way through: a text with no number is not a refusal. Messages opens
 * with the words written and they pick who it goes to.
 */
import type { Task } from "../types.js";

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "decline-en-001", family: "decline", lang: "en", split: "dev",
    intent: "Swiggy is not an app Tailzu can order in: it says so, and nothing opens.",
    said: "order butter chicken and garlic naan from Swiggy",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY I can't order on Swiggy from here yet. You'll need to place it in the Swiggy app.\nDONE"] },
    controls: [{ name: "pretends to order", scripted: { calls: ["SAY Sure, I've ordered butter chicken and garlic naan for you.\nDONE"] }, mustFail: ["decline"] }],
    tags: ["food"],
  },
  {
    id: "decline-en-002", family: "decline", lang: "en", split: "dev",
    intent: "An Ola they asked for is not booked through Uber instead: it says it can't.",
    said: "book an Ola to Kempegowda airport for 5am tomorrow",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY I can't book an Ola from here yet. You can book it in the Ola app.\nDONE"] },
    controls: [{ name: "opens Uber instead", scripted: { calls: ['USE uber.ride {"destination":"Kempegowda International Airport"}'] }, mustFail: ["decline", "handoff"] }],
    tags: ["ride"],
  },
  {
    id: "decline-en-003", family: "decline", lang: "en", split: "dev",
    intent: "Tailzu cannot read their WhatsApp: it says so, and does not open a chat instead.",
    said: "read my latest WhatsApp messages",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY I can't read your WhatsApp messages. I can only write one for you to send.\nDONE"] },
    controls: [{ name: "opens WhatsApp anyway", scripted: { calls: ['USE whatsapp.send_message {"text":"Hi"}'] }, mustFail: ["decline"] }],
    tags: ["messages"],
  },
  {
    id: "decline-en-004", family: "decline", lang: "en", split: "held",
    intent: "Tailzu cannot see a bank balance: it says so, and points to where they can.",
    said: "what's my HDFC bank balance?",
    world: {},
    expect: { decline: true, handoff: "none", reply: { mustNotContain: [/₹\s?\d/] } },
    scripted: { calls: ["SAY I can't see your bank balance. You can check it in the HDFC Bank app or on NetBanking.\nDONE"] },
    tags: ["bank"],
  },
  {
    id: "decline-en-005", family: "decline", lang: "en", split: "dev",
    intent: "Not a refusal: an SMS with no number opens Messages with the words written, for them to pick who it goes to.",
    said: "send an SMS saying I reached home safely",
    world: {},
    expect: { handoff: { app: "sms", to: "none", text: ["home"] }, approval: "none" },
    scripted: { calls: ['USE phone.text {"body":"I reached home safely."}'] },
    controls: [{ name: "refuses it", scripted: { calls: ["SAY I can't send a text without a number.\nDONE"] }, mustFail: ["handoff"] }],
    tags: ["sms", "not-a-decline"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "decline-hinglish-001", family: "decline", lang: "hinglish", split: "dev",
    intent: "Zomato is not an app Tailzu can order in: said in Hinglish, and no shopping search opens instead.",
    said: "Zomato se ek paneer biryani order kar do",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY Zomato pe order main abhi nahi kar sakta. Zomato app mein khud order karna padega.\nDONE"] },
    controls: [{ name: "opens a shopping search instead", scripted: { calls: ['USE shopping.amazon_search {"query":"paneer biryani"}'] }, mustFail: ["decline", "handoff"] }],
    tags: ["food"],
  },
  {
    id: "decline-hinglish-002", family: "decline", lang: "hinglish", split: "dev",
    intent: "A phone alarm cannot be set today: it says so in Hinglish, and does not pretend.",
    said: "kal subah 6 baje ka alarm laga do",
    world: { connected: [{ app: "google-tasks" }] },
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY Phone pe alarm lagana main abhi nahi kar sakta. Clock app mein subah 6 baje ka alarm khud laga lo.\nDONE"] },
    controls: [{ name: "says the alarm is set", scripted: { calls: ["SAY Alarm laga diya, kal subah 6 baje.\nDONE"] }, mustFail: ["decline"] }],
    tags: ["alarm"],
  },
  {
    id: "decline-hinglish-003", family: "decline", lang: "hinglish", split: "held",
    intent: "Paying an electricity bill is not something Tailzu can do: said in Hinglish, nothing opens.",
    said: "mera BESCOM bijli ka bill bhar do",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY Bijli ka bill bharna main abhi nahi kar sakta. BESCOM ki site ya apne UPI app ke bills section se bhar lo.\nDONE"] },
    tags: ["bill"],
  },
  {
    id: "decline-hinglish-004", family: "decline", lang: "hinglish", split: "dev",
    intent: "Reading their WhatsApp is refused in Hinglish, and no chat opens.",
    said: "mere WhatsApp ke naye messages padh ke sunao",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY WhatsApp ke messages padhna main nahi kar sakta. Main sirf tumhare liye message likh ke WhatsApp khol sakta hoon.\nDONE"] },
    tags: ["messages"],
  },
  {
    id: "decline-hinglish-005", family: "decline", lang: "hinglish", split: "dev",
    intent: "Not a refusal: an SMS with no number opens Messages, and they pick who it goes to.",
    said: "SMS likh do 'ghar pahunch gaya', number main khud chun lunga",
    world: {},
    expect: { handoff: { app: "sms", to: "none", text: ["ghar"] }, approval: "none" },
    scripted: { calls: ['USE phone.text {"body":"Ghar pahunch gaya."}'] },
    controls: [{ name: "refuses it", scripted: { calls: ["SAY Bina number ke SMS main nahi bhej sakta.\nDONE"] }, mustFail: ["handoff"] }],
    tags: ["sms", "not-a-decline"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "decline-hi-001", family: "decline", lang: "hi", split: "dev",
    intent: "Swiggy, named in a Hindi request, is refused in Hindi: nothing is ordered or opened.",
    said: "Swiggy से एक मसाला डोसा मंगवा दो",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY Swiggy पर ऑर्डर करना मैं अभी नहीं कर सकता। आपको यह डोसा Swiggy ऐप में ही मंगवाना होगा।\nDONE"] },
    controls: [{ name: "pretends to order", scripted: { calls: ["SAY ठीक है, आपका मसाला डोसा मंगवा दिया है, आधे घंटे में आ जाएगा।\nDONE"] }, mustFail: ["decline"] }],
    tags: ["food", "mixed-script"],
  },
  {
    id: "decline-hi-002", family: "decline", lang: "hi", split: "dev",
    intent: "An Ola, named in a Hindi request, is refused in Hindi and not booked through Uber.",
    said: "कल सुबह 5 बजे एयरपोर्ट के लिए Ola बुक कर दो",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY Ola से कैब बुक करना मैं अभी नहीं कर सकता। कल सुबह की कैब आप Ola ऐप में ही बुक कर लीजिए।\nDONE"] },
    controls: [{ name: "opens Uber instead", scripted: { calls: ['USE uber.ride {"destination":"Airport"}'] }, mustFail: ["decline", "handoff"] }],
    tags: ["ride", "mixed-script"],
  },
  {
    id: "decline-hi-003", family: "decline", lang: "hi", split: "held",
    intent: "A bank balance asked in Hindi is refused in Hindi, with where to look.",
    said: "मेरे SBI खाते में कितना बैलेंस है?",
    world: {},
    expect: { decline: true, handoff: "none", reply: { mustNotContain: [/₹\s?\d/] } },
    scripted: { calls: ["SAY आपके बैंक खाते का बैलेंस देखना मैं नहीं कर सकता। इसे आप SBI के योनो ऐप या नेटबैंकिंग में देख सकते हैं।\nDONE"] },
    tags: ["bank", "mixed-script"],
  },
  {
    id: "decline-hi-004", family: "decline", lang: "hi", split: "dev",
    intent: "Paying a bill asked in Hindi is refused in Hindi, and nothing opens.",
    said: "बिजली का बिल भर दो",
    world: {},
    expect: { decline: true, handoff: "none" },
    scripted: { calls: ["SAY बिजली का बिल भरना मैं अभी नहीं कर सकता। अपने यूपीआई ऐप के बिल वाले हिस्से से इसे भर लीजिए।\nDONE"] },
    tags: ["bill"],
  },
  {
    id: "decline-hi-005", family: "decline", lang: "hi", split: "dev",
    intent: "Not a refusal: \"SMS में लिखो\" with no number opens Messages with the Hindi words, and they pick who it goes to.",
    said: "SMS में लिखो कि मैं घर पहुँच गया हूँ, नंबर मैं खुद चुन लूँगा",
    world: {},
    expect: { handoff: { app: "sms", to: "none", text: [{ anyOf: ["घर", "ghar", "home"] }] }, approval: "none" },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE phone.text {"body":"मैं घर पहुँच गया हूँ।"}'] },
    controls: [{ name: "refuses it", scripted: { calls: ["SAY बिना नंबर के एसएमएस मैं नहीं भेज सकता।\nDONE"] }, mustFail: ["handoff"] }],
    tags: ["sms", "not-a-decline", "mixed-script"],
  },
];
