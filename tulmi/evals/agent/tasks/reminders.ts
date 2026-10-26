/**
 * REMINDERS, AND WHAT DAY AND TIME IT IS: 24 tasks, 8 in each language.
 *
 * A reminder today is a Google Task: the day as its `due`, and a time they
 * said in its notes ("At 09:00"), because Google Tasks keeps no time
 * (src/connectors/google/tasks.ts). That is what is graded, with the day
 * read off the frozen clock (Monday 26 October 2026, 10:30 in India), and
 * with the claim the code cannot keep forbidden: nothing here rings, so the
 * run never says it will remind them.
 *
 * A reminder that must ring at a time ("in 20 minutes", "at 5 sharp") or
 * repeat ("every Monday") needs M2's reminders, so those carry `xfail` and
 * are graded the way M2 will want them: nothing written to Google Tasks for
 * it, and the time or the repeat said back. Today's best answer, a Google
 * Task, fails `unchanged`, which is the gap they stand for.
 *
 * The questions about the date and the time need no app at all: they are
 * answered from the Now line, and nothing is changed.
 */
import type { Task } from "../types.js";

const TASKS_APP = { connected: [{ app: "google-tasks" as const }] };

/** What the run must never promise: Google Tasks keeps a day and rings at nothing. */
const NO_RING_EN = [/i(['’]| wi)ll remind you/i, /alarm (is )?set/i, /will (ring|alert you)/i];
const NO_RING_HG = [/yaad dila (dunga|doonga|dungi)/i, /yaad dilaunga/i, /alarm (laga|set kar) (diya|dunga)/i];
const NO_RING_HI = ["याद दिला दूँगा", "याद दिला दूंगा", "याद दिलाऊँगा", "अलार्म लगा दिया"];

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "reminders-en-001", family: "reminders", lang: "en", split: "dev",
    intent: "A reminder for tomorrow at a time is a task due tomorrow with the time in its notes, after a yes, and never a promise to ring.",
    said: "remind me tomorrow at 9am to call mummy",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "mummy", due: "2026-10-27", notes: { anyOf: [/\b0?9:00\b/, /\b9\s?am\b/i] } }],
      approval: { required: true, preview: "mummy" },
      reply: { mustNotContain: NO_RING_EN },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Call Mummy","due":"tomorrow 9am"}'] },
    controls: [{
      name: "promises to ring",
      scripted: { calls: ['SAY I\'ll remind you at 9 tomorrow.\nUSE google-tasks.add_task {"title":"Call Mummy","due":"tomorrow 9am"}'] },
      mustFail: ["reply"],
    }],
    tags: ["time", "tomorrow"],
  },
  {
    id: "reminders-en-002", family: "reminders", lang: "en", split: "dev",
    intent: "\"This evening at 6\" is today, at 18:00.",
    said: "remind me this evening at 6 to pick up the cake from Theobroma",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "cake", due: "2026-10-26", notes: { anyOf: [/\b18:00\b/, /\b6(:00)?\s?pm\b/i] } }],
      approval: { required: true, preview: "cake" },
      reply: { mustNotContain: NO_RING_EN },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Pick up the cake from Theobroma","due":"today 6pm"}'] },
    tags: ["time", "today"],
  },
  {
    id: "reminders-en-003", family: "reminders", lang: "en", split: "dev",
    intent: "A weekday with no time is a task due that day, this week.",
    said: "remind me on Friday to pay the society maintenance",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "maintenance", due: "2026-10-30" }],
      approval: { required: true, preview: "maintenance" },
      reply: { mustNotContain: NO_RING_EN },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Pay the society maintenance","due":"friday"}'] },
    tags: ["weekday"],
  },
  {
    id: "reminders-en-004", family: "reminders", lang: "en", split: "held",
    intent: "\"Tonight at 12:30\" is after midnight: the task is due tomorrow, at 00:30.",
    said: "remind me tonight at 12:30 to file the GST return",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "gst", due: "2026-10-27", notes: { anyOf: [/\b00:30\b/, /\b12:30\s?am\b/i] } }],
      approval: { required: true, preview: "gst" },
      reply: { mustNotContain: NO_RING_EN },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"File the GST return","due":"tomorrow 12:30am"}'] },
    controls: [{
      name: "reads tonight as today",
      scripted: { calls: ['USE google-tasks.add_task {"title":"File the GST return","due":"today 12:30am"}'] },
      mustFail: ["world"],
    }],
    tags: ["time", "past-midnight"],
  },
  {
    id: "reminders-en-005", family: "reminders", lang: "en", split: "dev",
    intent: "The date of a weekday this week, from the Now line, with no app touched.",
    said: "what's the date this Friday?",
    world: TASKS_APP,
    expect: { reply: { mustContain: [{ allOf: ["30", "oct"] }] } },
    scripted: { calls: ["SAY This Friday is 30 October 2026.\nDONE"] },
    tags: ["date", "no-app"],
  },
  {
    id: "reminders-en-006", family: "reminders", lang: "en", split: "held",
    intent: "The time in another city, worked out from India's: Dubai is an hour and a half behind.",
    said: "what time is it in Dubai right now?",
    world: {},
    expect: { reply: { mustContain: [{ anyOf: [/(?<![\d:])0?9:00/, /(?<![\d:])9\s?(am|a\.m\.)/i, /\bnine\b/i] }] } },
    scripted: { calls: ["SAY It's 9:00 am in Dubai right now.\nDONE"] },
    tags: ["time", "no-app"],
  },
  {
    id: "reminders-en-007", family: "reminders", lang: "en", split: "dev",
    intent: "A reminder in 20 minutes must ring at 10:50. Until M2 it can only be a Google Task for the day, which never rings, so it is graded as M2 will want it: nothing in Google Tasks, and the time said back.",
    said: "remind me in 20 minutes to take the milk off the stove",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: ["10:50", "10.50"] }] } },
    xfail: { until: "M2", why: "reminder-alert" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Take the milk off the stove","due":"today 10:50am"}'] },
    tags: ["time", "alert"],
  },
  {
    id: "reminders-en-008", family: "reminders", lang: "en", split: "dev",
    intent: "A reminder every Monday must repeat. Google Tasks keeps one day, so until M2 it is graded as M2 will want it: nothing in Google Tasks, and the repeat said back.",
    said: "remind me every Monday at 10 to send the weekly report to Vikram",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: ["every monday", "mondays", "each monday"] }] } },
    xfail: { until: "M2", why: "recurring" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Send the weekly report to Vikram","due":"next monday 10am","notes":"Every Monday"}'] },
    tags: ["recurring"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "reminders-hinglish-001", family: "reminders", lang: "hinglish", split: "dev",
    intent: "\"Kal subah 7 baje\" is tomorrow at 07:00, kept in the task's notes.",
    said: "kal subah 7 baje gym jaane ka reminder laga do",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "gym", due: "2026-10-27", notes: { anyOf: [/\b07:00\b/, /\b7\s?(am|baje)\b/i] } }],
      approval: { required: true, preview: "gym" },
      reply: { mustNotContain: NO_RING_HG },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Gym jaana","due":"tomorrow 7am"}'] },
    controls: [{
      name: "drops the time",
      scripted: { calls: ['USE google-tasks.add_task {"title":"Gym jaana","due":"tomorrow"}'] },
      mustFail: ["world"],
    }],
    tags: ["time", "tomorrow"],
  },
  {
    id: "reminders-hinglish-002", family: "reminders", lang: "hinglish", split: "held",
    intent: "\"Parso\" is the day after tomorrow; the tool does not read it, so the planner must give the date.",
    said: "parso shaam 4 baje bijli ka bill bharna hai, yaad dila dena",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["bijli", "bill", "electricity"] }, due: "2026-10-28", notes: { anyOf: [/\b16:00\b/, /\b4\s?(pm|baje)\b/i] } }],
      approval: { required: true, preview: { anyOf: ["bijli", "bill", "electricity"] } },
      reply: { mustNotContain: NO_RING_HG },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Bijli ka bill bharna","due":"28 oct 4pm"}'] },
    controls: [{
      name: "reads parso as kal",
      scripted: { calls: ['USE google-tasks.add_task {"title":"Bijli ka bill bharna","due":"tomorrow 4pm"}'] },
      mustFail: ["world"],
    }],
    tags: ["time", "parso"],
  },
  {
    id: "reminders-hinglish-003", family: "reminders", lang: "hinglish", split: "dev",
    intent: "\"Aaj raat 9 baje\" is today at 21:00.",
    said: "aaj raat 9 baje mummy ko dawai dene ka reminder",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["dawai", "dawa", "medicine"] }, due: "2026-10-26", notes: { anyOf: [/\b21:00\b/, /\b9\s?(pm|baje)\b/i] } }],
      approval: { required: true, preview: { anyOf: ["dawai", "dawa", "medicine"] } },
      reply: { mustNotContain: NO_RING_HG },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Mummy ko dawai dena","due":"today 9pm"}'] },
    tags: ["time", "today"],
  },
  {
    id: "reminders-hinglish-004", family: "reminders", lang: "hinglish", split: "dev",
    intent: "A weekday with no time, said inside a sentence about something else, is a task due that Saturday.",
    said: "Saturday ko Rohit ka birthday hai, usko wish karna yaad dilana",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: "rohit", due: "2026-10-31" }],
      approval: { required: true, preview: "rohit" },
      reply: { mustNotContain: NO_RING_HG },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Rohit ko birthday wish karna","due":"saturday"}'] },
    tags: ["weekday"],
  },
  {
    id: "reminders-hinglish-005", family: "reminders", lang: "hinglish", split: "dev",
    intent: "Days until a date they gave, counted from the Now line, answered in Hinglish.",
    said: "Diwali 8 November ko hai, kitne din bache hain?",
    world: {},
    expect: { reply: { mustContain: [/\b13\b/] } },
    scripted: { calls: ["SAY Diwali mein abhi 13 din bache hain.\nDONE"] },
    controls: [{
      name: "answers in plain English",
      scripted: { calls: ["SAY There are 13 days left until Diwali.\nDONE"] },
      mustFail: ["language"],
    }],
    tags: ["date", "no-app"],
  },
  {
    id: "reminders-hinglish-006", family: "reminders", lang: "hinglish", split: "dev",
    intent: "The time in Dubai, in Hinglish.",
    said: "Dubai mein abhi kitne baje hain?",
    world: {},
    expect: { reply: { mustContain: [{ anyOf: [/(?<![\d:])9 baje/i, /(?<![\d:])0?9:00/, /(?<![\d:])9\s?am\b/i] }] } },
    scripted: { calls: ["SAY Dubai mein abhi subah ke 9 baje hain.\nDONE"] },
    tags: ["time", "no-app"],
  },
  {
    id: "reminders-hinglish-007", family: "reminders", lang: "hinglish", split: "dev",
    intent: "\"Aadhe ghante baad\" must ring at 11:00; until M2 it is graded as M2 will want it: nothing in Google Tasks, and the time said back.",
    said: "aadhe ghante baad yaad dila dena ki cooker band karna hai",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: [/\b11:00\b/, /\b11 baje\b/i, /\b11\s?am\b/i] }] } },
    xfail: { until: "M2", why: "reminder-alert" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Cooker band karna","due":"today 11am"}'] },
    tags: ["time", "alert"],
  },
  {
    id: "reminders-hinglish-008", family: "reminders", lang: "hinglish", split: "dev",
    intent: "\"Har Sunday\" must repeat; until M2 it is graded as M2 will want it: nothing in Google Tasks, and the repeat said back.",
    said: "har Sunday subah 8 baje paudhon ko paani dene ka reminder set kar do",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: ["har sunday", "every sunday", "har ravivar", "har itwaar"] }] } },
    xfail: { until: "M2", why: "recurring" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Paudhon ko paani dena","due":"sunday 8am","notes":"Har Sunday"}'] },
    tags: ["recurring"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "reminders-hi-001", family: "reminders", lang: "hi", split: "dev",
    intent: "A Hindi reminder that names Google Tasks in Latin letters reaches it: tomorrow, 09:00 in its notes, said in Hindi.",
    said: "Google Tasks में कल सुबह 9 बजे मम्मी को फ़ोन करने का रिमाइंडर डालो",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["मम्मी", "mummy", "mom"] }, due: "2026-10-27", notes: { anyOf: [/\b0?9:00\b/, /9\s?बजे/] } }],
      approval: { required: true, preview: { anyOf: ["मम्मी", "mummy", "mom"] } },
      reply: { mustNotContain: NO_RING_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"मम्मी को फ़ोन करना","due":"tomorrow 9am"}'] },
    tags: ["time", "tomorrow", "mixed-script"],
  },
  {
    id: "reminders-hi-002", family: "reminders", lang: "hi", split: "dev",
    intent: "A weekday said in Hindi (शुक्रवार) is that Friday, with Google Tasks named in Latin letters.",
    said: "Google Tasks में शुक्रवार को सोसाइटी का मेंटेनेंस भरने का रिमाइंडर डाल दो",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["मेंटेनेंस", "सोसाइटी", "maintenance"] }, due: "2026-10-30" }],
      approval: { required: true, preview: { anyOf: ["मेंटेनेंस", "सोसाइटी", "maintenance"] } },
      reply: { mustNotContain: NO_RING_HI },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"सोसाइटी का मेंटेनेंस भरना","due":"friday"}'] },
    tags: ["weekday", "mixed-script"],
  },
  {
    id: "reminders-hi-003", family: "reminders", lang: "hi", split: "dev",
    intent: "A reminder said wholly in Devanagari, naming no app, reaches no app today; M2's Devanagari rules route it to Google Tasks.",
    said: "गुरुवार को गैस सिलेंडर बुक करना याद दिलाना",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["गैस", "सिलेंडर", "gas", "cylinder"] }, due: "2026-10-29" }],
      approval: { required: true, preview: { anyOf: ["गैस", "सिलेंडर", "gas", "cylinder"] } },
      reply: { mustNotContain: NO_RING_HI },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"गैस सिलेंडर बुक करना","due":"thursday"}'] },
    tags: ["weekday", "devanagari"],
  },
  {
    id: "reminders-hi-004", family: "reminders", lang: "hi", split: "held",
    intent: "\"परसों\" in Devanagari, naming no app: no app today; M2 routes it, and the planner must give the date.",
    said: "परसों बिजली का बिल भरना है, याद दिला देना",
    world: TASKS_APP,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["बिजली", "बिल", "bijli", "electricity"] }, due: "2026-10-28" }],
      approval: { required: true, preview: { anyOf: ["बिजली", "बिल", "bijli", "electricity"] } },
      reply: { mustNotContain: NO_RING_HI },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"बिजली का बिल भरना","due":"28 oct"}'] },
    tags: ["parso", "devanagari"],
  },
  {
    id: "reminders-hi-005", family: "reminders", lang: "hi", split: "dev",
    intent: "Today's date, from the Now line, answered in Devanagari.",
    said: "आज कौन सी तारीख है?",
    world: TASKS_APP,
    expect: { reply: { mustContain: [{ anyOf: ["26", "२६"] }, { anyOf: ["अक्टूबर", "october", "oct"] }] } },
    scripted: { calls: ["SAY आज सोमवार है, छब्बीस अक्टूबर, यानी 26 अक्टूबर 2026।\nDONE"] },
    controls: [{
      name: "answers in English",
      scripted: { calls: ["SAY Today is Monday, 26 October 2026.\nDONE"] },
      mustFail: ["language"],
    }],
    tags: ["date", "no-app"],
  },
  {
    id: "reminders-hi-006", family: "reminders", lang: "hi", split: "held",
    intent: "Days until a date said in Hindi, from the Now line.",
    said: "दीवाली 8 नवंबर को है, कितने दिन बचे हैं?",
    world: {},
    expect: { reply: { mustContain: [{ anyOf: [/\b13\b/, "१३", "तेरह"] }] } },
    scripted: { calls: ["SAY दीवाली आने में अब तेरह यानी 13 दिन बचे हैं।\nDONE"] },
    tags: ["date", "no-app"],
  },
  {
    id: "reminders-hi-007", family: "reminders", lang: "hi", split: "dev",
    intent: "\"शाम ठीक 5 बजे\", and it must ring: until M2 it is graded as M2 will want it, nothing in Google Tasks and the time said back.",
    said: "Google Tasks में आज शाम ठीक 5 बजे क्लाइंट को कॉल करने का रिमाइंडर डालो, उस वक़्त बजना चाहिए",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: [/5\s?बजे/, /\b17:00\b/, /\b5:00\b/, "पाँच बजे", "५ बजे"] }] } },
    xfail: { until: "M2", why: "reminder-alert" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"क्लाइंट को कॉल करना","due":"today 5pm"}'] },
    tags: ["time", "alert", "mixed-script"],
  },
  {
    id: "reminders-hi-008", family: "reminders", lang: "hi", split: "dev",
    intent: "\"हर सोमवार\" must repeat; until M2 it is graded as M2 will want it: nothing in Google Tasks, and the repeat said back.",
    said: "Google Tasks में हर सोमवार सुबह 10 बजे टीम रिपोर्ट भेजने का रिमाइंडर लगाओ",
    world: TASKS_APP,
    expect: { unchanged: true, reply: { mustContain: [{ anyOf: ["हर सोमवार", "every monday"] }] } },
    xfail: { until: "M2", why: "recurring" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"टीम रिपोर्ट भेजना","due":"next monday 10am","notes":"हर सोमवार"}'] },
    tags: ["recurring", "mixed-script"],
  },
];
