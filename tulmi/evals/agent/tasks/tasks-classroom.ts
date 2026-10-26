/**
 * GOOGLE TASKS AND GOOGLE CLASSROOM: 18 tasks, 6 in each language.
 *
 * Tasks: a to-do added with or without a day, what is due today, this week
 * or overdue (read from the list, nothing changed), and one ticked off by its
 * title after a card. Classroom is read only: what homework is due this week
 * and whether it is turned in, and the latest announcement in one class.
 *
 * Each list is seeded so that the right answer leaves something out (a task
 * due next week, homework due after the week), and the reply is graded on
 * both what it says and what it must not.
 */
import type { SeedCourse, SeedTask, Task, WorldSeed } from "../types.js";

const tasksWith = (tasks: SeedTask[]): WorldSeed => ({ connected: [{ app: "google-tasks" }], google: { taskLists: [{ title: "My Tasks", tasks }] } });
const classroomWith = (courses: SeedCourse[]): WorldSeed => ({ connected: [{ app: "google-classroom" }], google: { courses } });

/** Ananya's list in Bengaluru: one due today, one overdue, one next week, one with no day. */
const ANANYA = tasksWith([
  { id: "t_elec", title: "Pay electricity bill", due: "2026-10-26" },
  { id: "t_ins", title: "Renew car insurance", due: "2026-10-25" },
  { id: "t_goa", title: "Book Goa tickets", due: "2026-11-02" },
  { id: "t_pan", title: "Link PAN with Aadhaar" },
]);

/** Rohit's list in Lucknow, in Hinglish. */
const ROHIT = tasksWith([
  { id: "t_doodh", title: "Doodh wale ka hisaab", due: "2026-10-26" },
  { id: "t_gas", title: "Gas cylinder book karna", due: "2026-10-24" },
  { id: "t_gift", title: "Didi ka gift lena", due: "2026-10-29" },
  { id: "t_cycle", title: "Cycle ki service", due: "2026-11-04" },
]);

/** Sunita's list in Jaipur, in Hindi. */
const SUNITA = tasksWith([
  { id: "t_sabzi", title: "सब्ज़ी लाना", due: "2026-10-26" },
  { id: "t_bijli", title: "बिजली का बिल भरना", due: "2026-10-26" },
  { id: "t_doodh", title: "दूध का बिल भरना", due: "2026-10-23" },
  { id: "t_dadi", title: "दादी को फ़ोन करना", due: "2026-10-29" },
]);

export const TASKS: Task[] = [
  // ------------------------------------------------------------------ English
  {
    id: "tasks-classroom-en-001", family: "tasks-classroom", lang: "en", split: "dev",
    intent: "A to-do with no day is added with no day, after a yes.",
    said: "add buy Diwali diyas and rangoli colours to my to-do list",
    world: ANANYA,
    expect: {
      world: [{ kind: "task", title: { allOf: ["diya", "rangoli"] }, due: null }],
      approval: { required: true, preview: "diya" },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Buy Diwali diyas and rangoli colours"}'] },
    tags: ["add"],
  },
  {
    id: "tasks-classroom-en-002", family: "tasks-classroom", lang: "en", split: "dev",
    intent: "What is due today is read off the list; next week's task is not.",
    said: "what's due today on my to-do list?",
    world: ANANYA,
    expect: { reply: { mustContain: ["electricity"], mustNotContain: ["goa"] } },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"today"}', "SAY Just one thing today: pay the electricity bill.\nDONE"] },
    controls: [{
      name: "ticks it off when asked to read",
      scripted: { calls: ['USE google-tasks.complete_task {"task":"Pay electricity bill"}'] },
      mustFail: ["unchanged"],
    }],
    tags: ["list", "today"],
  },
  {
    id: "tasks-classroom-en-003", family: "tasks-classroom", lang: "en", split: "held",
    intent: "A task named by its title is ticked off, after a card that names it.",
    said: "mark renew car insurance as done",
    world: ANANYA,
    expect: {
      world: [{ kind: "task.done", id: "t_ins" }],
      approval: { required: true, preview: "insurance" },
    },
    scripted: { calls: ['USE google-tasks.complete_task {"task":"Renew car insurance"}'] },
    tags: ["complete"],
  },
  {
    id: "tasks-classroom-en-004", family: "tasks-classroom", lang: "en", split: "dev",
    intent: "\"Anything overdue?\" is a read: the overdue task is said, and no card is shown.",
    said: "anything overdue on my list?",
    world: ANANYA,
    expect: { approval: "none", reply: { mustContain: ["insurance"], mustNotContain: ["goa"] } },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"overdue"}', "SAY Yes, renewing the car insurance was due yesterday.\nDONE"] },
    controls: [{
      name: "ticks off the overdue task",
      scripted: { calls: ['USE google-tasks.list_tasks {"due":"overdue"}', 'USE google-tasks.complete_task {"task":"t_ins"}'] },
      mustFail: ["approval", "unchanged"],
    }],
    tags: ["list", "overdue"],
  },
  {
    id: "tasks-classroom-en-005", family: "tasks-classroom", lang: "en", split: "dev",
    intent: "Classroom's homework due this week, with whether it is turned in; next week's left out.",
    said: "what homework is due this week in Google Classroom?",
    world: classroomWith([
      { id: "c_phy", name: "Physics 11-B", work: [{ title: "Numericals on kinematics", due: "2026-10-28T23:59:00+05:30" }] },
      { id: "c_eng", name: "English Literature", work: [{ title: "Essay: My favourite festival", due: "2026-10-30", state: "TURNED_IN" }] },
      { id: "c_math", name: "Mathematics", work: [{ title: "Integration worksheet", due: "2026-11-05" }] },
    ]),
    expect: { reply: { mustContain: ["kinematics"], mustNotContain: ["integration"] } },
    scripted: { calls: ['USE google-classroom.whats_due {"days":7}', "SAY Due this week: the Physics numericals on kinematics, by Wednesday night, not turned in yet. Your English essay is already turned in.\nDONE"] },
    tags: ["classroom"],
  },
  {
    id: "tasks-classroom-en-006", family: "tasks-classroom", lang: "en", split: "dev",
    intent: "The latest announcement in the one class they named.",
    said: "any announcements from my Physics class?",
    world: classroomWith([
      { id: "c_phy", name: "Physics 11-B", announcements: [{ text: "Unit test on Friday 30 Oct, chapters 3 and 4. Bring your lab journal.", at: "2026-10-25T09:00:00+05:30" }] },
      { id: "c_chem", name: "Chemistry 11-B", announcements: [{ text: "Lab is closed on Wednesday.", at: "2026-10-25T11:00:00+05:30" }] },
    ]),
    expect: { reply: { mustContain: [{ anyOf: ["unit test", "test"] }], mustNotContain: ["lab is closed"] } },
    scripted: { calls: ['USE google-classroom.announcements {"class":"Physics"}', "SAY Your Physics teacher posted: unit test on Friday 30 October, chapters 3 and 4, and bring your lab journal.\nDONE"] },
    tags: ["classroom", "announcements"],
  },

  // ------------------------------------------------------------------ Hinglish
  {
    id: "tasks-classroom-hinglish-001", family: "tasks-classroom", lang: "hinglish", split: "dev",
    intent: "\"Kal tak\" is a to-do due tomorrow.",
    said: "kal tak passport photos print karwane hain, to-do mein daal do",
    world: ROHIT,
    expect: {
      world: [{ kind: "task", title: "passport", due: "2026-10-27" }],
      approval: { required: true, preview: "passport" },
    },
    scripted: { calls: ['USE google-tasks.add_task {"title":"Passport photos print karwana","due":"tomorrow"}'] },
    tags: ["add"],
  },
  {
    id: "tasks-classroom-hinglish-002", family: "tasks-classroom", lang: "hinglish", split: "dev",
    intent: "\"Aaj ke kaam\" is what is due today, said in Hinglish.",
    said: "aaj ke kaam kya kya hain?",
    world: ROHIT,
    expect: { reply: { mustContain: ["doodh"], mustNotContain: ["cycle"] } },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"today"}', "SAY Aaj ek kaam hai: doodh wale ka hisaab karna.\nDONE"] },
    tags: ["list", "today"],
  },
  {
    id: "tasks-classroom-hinglish-003", family: "tasks-classroom", lang: "hinglish", split: "dev",
    intent: "\"Ho gaya, tick kar do\" ticks off the task they named, after a card.",
    said: "Google Tasks mein gas cylinder wala kaam ho gaya, tick kar do",
    world: ROHIT,
    expect: {
      world: [{ kind: "task.done", id: "t_gas" }],
      approval: { required: true, preview: "gas" },
    },
    scripted: { calls: ['USE google-tasks.complete_task {"task":"Gas cylinder book karna"}'] },
    tags: ["complete"],
  },
  {
    id: "tasks-classroom-hinglish-004", family: "tasks-classroom", lang: "hinglish", split: "dev",
    intent: "\"Is hafte\" is the next seven days: an overdue task and one after the week are left out.",
    said: "is hafte kya kya due hai meri list mein?",
    world: ROHIT,
    expect: { reply: { mustContain: ["doodh", "gift"], mustNotContain: ["cycle"] } },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"week"}', "SAY Is hafte do kaam hain: aaj doodh wale ka hisaab, aur Thursday tak didi ka gift lena.\nDONE"] },
    tags: ["list", "week"],
  },
  {
    id: "tasks-classroom-hinglish-005", family: "tasks-classroom", lang: "hinglish", split: "held",
    intent: "This week's homework from Classroom, said in Hinglish, with what is still to hand in.",
    said: "Classroom pe is hafte ka homework kya hai?",
    world: classroomWith([
      { id: "c_chem", name: "Chemistry", work: [{ title: "Mole concept worksheet", due: "2026-10-29" }] },
      { id: "c_hindi", name: "Hindi", work: [{ title: "Nibandh: Mera priya tyohar", due: "2026-10-27", state: "TURNED_IN" }] },
      { id: "c_maths", name: "Maths", work: [{ title: "Trigonometry test prep", due: "2026-11-06" }] },
    ]),
    expect: { reply: { mustContain: ["mole"], mustNotContain: ["trigonometry"] } },
    scripted: { calls: ['USE google-classroom.whats_due {"days":7}', "SAY Is hafte Chemistry ki mole concept worksheet Thursday tak deni hai, abhi jama nahi hui. Hindi ka nibandh jama ho chuka hai.\nDONE"] },
    tags: ["classroom"],
  },
  {
    id: "tasks-classroom-hinglish-006", family: "tasks-classroom", lang: "hinglish", split: "dev",
    intent: "An announcement in the class they named, in Hinglish.",
    said: "Chemistry class mein koi naya announcement aaya?",
    world: classroomWith([
      { id: "c_chem", name: "Chemistry", announcements: [{ text: "Kal practical hai, lab coat zaroor laana.", at: "2026-10-26T08:30:00+05:30" }] },
      { id: "c_bio", name: "Biology", announcements: [{ text: "Herbarium file jama karne ki last date Friday hai.", at: "2026-10-25T12:00:00+05:30" }] },
    ]),
    expect: { reply: { mustContain: ["practical"], mustNotContain: ["herbarium"] } },
    scripted: { calls: ['USE google-classroom.announcements {"class":"Chemistry"}', "SAY Haan, Chemistry mein announcement aaya hai: kal practical hai, lab coat zaroor laana.\nDONE"] },
    tags: ["classroom", "announcements"],
  },

  // ------------------------------------------------------------------ Hindi
  {
    id: "tasks-classroom-hi-001", family: "tasks-classroom", lang: "hi", split: "dev",
    intent: "A Hindi to-do with Google Tasks named in Latin letters, due on Friday.",
    said: "Google Tasks में 'बच्चों की स्कूल फीस भरना' जोड़ दो, शुक्रवार तक",
    world: SUNITA,
    expect: {
      world: [{ kind: "task", title: { anyOf: ["फीस", "फ़ीस", "fees", "fee"] }, due: "2026-10-30" }],
      approval: { required: true, preview: { anyOf: ["फीस", "फ़ीस", "fees", "fee"] } },
    },
    xfail: { until: "M2", why: "hindi-words" },
    scripted: { calls: ['USE google-tasks.add_task {"title":"बच्चों की स्कूल फीस भरना","due":"friday"}'] },
    tags: ["add", "mixed-script"],
  },
  {
    id: "tasks-classroom-hi-002", family: "tasks-classroom", lang: "hi", split: "dev",
    intent: "Today's tasks read out in Hindi, the ones due later left out.",
    said: "Google Tasks में आज क्या-क्या काम बाकी हैं?",
    world: SUNITA,
    expect: { reply: { mustContain: [{ anyOf: ["सब्ज़ी", "सब्जी"] }, "बिजली"], mustNotContain: ["दादी"] } },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"today"}', "SAY आज दो काम बाकी हैं: सब्ज़ी लाना और बिजली का बिल भरना।\nDONE"] },
    tags: ["list", "today", "mixed-script"],
  },
  {
    id: "tasks-classroom-hi-003", family: "tasks-classroom", lang: "hi", split: "held",
    intent: "\"कौन से काम पुराने रह गए\" (overdue) in Devanagari reaches no app today; with M2 the overdue one is said.",
    said: "मेरी लिस्ट में कौन से काम पुराने रह गए हैं?",
    world: SUNITA,
    expect: { reply: { mustContain: ["दूध"], mustNotContain: ["दादी"] } },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-tasks.list_tasks {"due":"overdue"}', "SAY एक काम पुराना रह गया है: दूध का बिल भरना, जो तेईस अक्टूबर तक करना था।\nDONE"] },
    tags: ["list", "overdue", "devanagari"],
  },
  {
    id: "tasks-classroom-hi-004", family: "tasks-classroom", lang: "hi", split: "dev",
    intent: "\"हो गया, पूरा कर दो\" in Devanagari reaches no app today; with M2 it ticks off the task named, after a card.",
    said: "दूध का बिल भरने वाला काम हो गया, उसे पूरा कर दो",
    world: SUNITA,
    expect: {
      world: [{ kind: "task.done", id: "t_doodh" }],
      approval: { required: true, preview: "दूध" },
    },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-tasks.complete_task {"task":"दूध का बिल भरना"}'] },
    tags: ["complete", "devanagari"],
  },
  {
    id: "tasks-classroom-hi-005", family: "tasks-classroom", lang: "hi", split: "dev",
    intent: "This week's homework from Google Classroom, in Hindi, with what is still to hand in.",
    said: "Google Classroom में इस हफ़्ते कौन सा होमवर्क बाकी है?",
    world: classroomWith([
      { id: "c_sci", name: "विज्ञान", work: [{ title: "पाठ 5 के प्रश्न-उत्तर", due: "2026-10-28" }] },
      { id: "c_hin", name: "हिंदी", work: [{ title: "निबंध: मेरा प्रिय त्योहार", due: "2026-10-30", state: "TURNED_IN" }] },
      { id: "c_gan", name: "गणित", work: [{ title: "अध्याय 7 का अभ्यास", due: "2026-11-07" }] },
    ]),
    expect: { reply: { mustContain: ["विज्ञान"], mustNotContain: ["गणित"] } },
    scripted: { calls: ['USE google-classroom.whats_due {"days":7}', "SAY इस हफ़्ते विज्ञान के पाठ पाँच के प्रश्न-उत्तर बुधवार तक जमा करने हैं, वे अभी बाकी हैं। हिंदी का निबंध जमा हो चुका है।\nDONE"] },
    tags: ["classroom", "mixed-script"],
  },
  {
    id: "tasks-classroom-hi-006", family: "tasks-classroom", lang: "hi", split: "dev",
    intent: "\"फ़िज़िक्स की क्लास में नई सूचना\" in Devanagari reaches no app today; with M2 the announcement is read out.",
    said: "फ़िज़िक्स वाली क्लास में कोई नई सूचना आई है क्या?",
    world: classroomWith([
      { id: "c_phy", name: "Physics", announcements: [{ text: "शुक्रवार को यूनिट टेस्ट है, अध्याय 3 और 4।", at: "2026-10-25T09:00:00+05:30" }] },
    ]),
    expect: { reply: { mustContain: [{ anyOf: ["टेस्ट", "test"] }] } },
    xfail: { until: "M2", why: "devanagari-routing" },
    scripted: { calls: ['USE google-classroom.announcements {"class":"Physics"}', "SAY हाँ, फ़िज़िक्स में नई सूचना आई है: शुक्रवार को यूनिट टेस्ट है, अध्याय तीन और चार से।\nDONE"] },
    tags: ["classroom", "announcements", "devanagari"],
  },
];
