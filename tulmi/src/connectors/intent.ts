/**
 * WHAT THE PERSON WANTS DONE, READ FROM THEIR WORDS, BEFORE ANY APP IS CHOSEN.
 *
 * The router (router.ts) used to score every connected app by the words it
 * shares with what was said. One everyday word was enough to pick an app
 * ("tell me a joke" went to WhatsApp, "the notion of time" to Notion), a word
 * inside a request beat the request ("remind me to call mom" went to the
 * phone), and naming an app counted no more than any other word. This reads
 * the request first, by rules, in English and Hinglish:
 *
 *   1. the app they NAMED: "in Notion", "on telegram", "via zapier",
 *      "whatsapp Neha", "gpay 300", "notion mein". A name that is also an
 *      everyday word (notion, linear, granola, otter, fireflies, threads,
 *      make) counts only when it is framed as an app ("in notion", "my
 *      notion", "notion pe", "a linear issue"), never in "the notion of".
 *      Apps Tailzu cannot reach (Swiggy, Ola, Outlook...) are named too, so
 *      the planner says so instead of using something else.
 *   2. a WRAPPING request: "remind me to...", "yaad dila do", "todo:", "add X
 *      to my list", "note this down", "jot down". What is inside is what to
 *      remember, so an app named in it ("remind me to text Riya on
 *      WhatsApp") is not the app to use.
 *   3. a COMMAND at the start: message, email, call, pay, a route, a ride,
 *      hotels, shopping, play. A word in the middle is not one ("how much tax
 *      do I pay" is not a payment).
 *   4. the THING it is about: an event at a time, a to-do, a note, a doc, a
 *      sheet, a form, homework, an issue, a meeting's notes, a booking link.
 *   5. otherwise a QUESTION about the world or the screen ("what's the
 *      capital of", "explain", "summarize this page") is no app at all.
 *
 * An app named counts only where the person says where the thing goes, never
 * inside the thing itself (namedFor()): not in what a message says ("message
 * Rahul to check his gmail", "text mom I booked the uber"), not in what an
 * expense was for ("spent 250 on uber, log it"), not in a question about the
 * apps ("is evernote worth it", "jira or linear?"). The words are read after
 * common misspellings are put right ("remmind", "calender", "tmrw"), and
 * an event can be named by its time alone ("my 5pm", "tmrw's 9am").
 *
 * It also reads the verb (create, read, move, delete, complete...), which
 * orders an app's tools, and, for our own apps, the one tool the words name
 * (a text rather than a call, a place search rather than directions).
 *
 * Plain patterns: this runs on every step and must be free and the same every
 * time. Which connected app does the job is the router's (router.ts JOB_APPS).
 */
import { namePattern } from "../experience/assistantName.js";

/** Its own name, however it was heard ("x0", "x zero", "ex oh"…), as a pattern for the lowercased request. */
const OWN_NAME = namePattern();

export type Job =
  | "calendar" | "booking-links" | "tasks" | "notes" | "wiki" | "docs" | "sheets" | "forms" | "classroom"
  | "issues" | "code" | "boards" | "meeting-notes"
  | "message" | "sms" | "email" | "call" | "pay" | "directions" | "places" | "ride" | "hotels" | "shopping"
  | "play" | "video-search";

export type Verb = "read" | "free" | "create" | "move" | "delete" | "complete" | "append" | "send";

/** An app named outright. */
export interface Named {
  /** How it is said to the person: "Todoist", "Slack". */
  label: string;
  /** The catalog ids that are this app, best first; empty when Tailzu has no such app. */
  ids: readonly string[];
  /** The words that named it, for an app of the person's own that answers to them ("slack"). */
  phrase: string;
  /** Named as the way to do it: "via zapier", "use composio to". */
  via: boolean;
  /** Where in the words it was named. */
  at: number;
  /** The tool its name picks within its app ("on flipkart" is flipkart_search). */
  tool?: string;
  /** The jobs it does beyond its ids' (JOB_APPS): "remind me in TickTick" names a tasks app, "on Slack" a message one. */
  jobs?: readonly Job[];
  /** Said as where it goes or is: "in X", "on X", "my X", "X pe", "X's", "X page". */
  framed: boolean;
  /** Said as the way to send or do it: "on X", "via X", "X pe", or its name as the verb ("whatsapp Neha"). */
  channel: boolean;
  /** Where the person keeps their things (Notion, Linear, an app they added), not a hand-off or an app Tailzu cannot reach. */
  workspace: boolean;
}

/** An app the person added by link, named by its name: read like any other app named. */
export interface OwnApp { id: string; names: readonly string[] }

export interface Intent {
  job: Job | null;
  verb: Verb | null;
  /** Our own tool the words name, when they name one: phone.text, maps.search, play.spotify. */
  tool?: string;
  /** Apps named outright that do this job, in the order said. */
  named: Named[];
  /** A question about the world or the screen: no app. */
  guarded: boolean;
  /** A second thing asked in the same breath ("... and block it on my calendar"). */
  more?: Intent[];
}

// ------------------------------------------------------------------ words

const DAYS = "today|tonight|tomorrow|tmrw|tmr|yesterday|kal|aaj|parso|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thurs?|fri|sat|sun|weekend|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar|itvaar|itwar";
const MONTHS = "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";
const DAY = new RegExp(`\\b(?:${DAYS})\\b|\\b(?:this|next|coming) (?:week|month|weekend)\\b|\\b(?:is|iss|agle|agla) (?:hafte|hafta|mahine|mahina)\\b|\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\b|\\b(?:${MONTHS}) \\d{1,2}(?:st|nd|rd|th)?\\b|\\bthe \\d{1,2}(?:st|nd|rd|th)\\b`);
const CLOCK = /\b\d{1,2}(?::\d{2})? ?(?:am|pm)\b|\bat \d{1,2}(?::\d{2})?\b|\b\d{1,2}(?::\d{2})? ?baje\b|\b\d{1,2}:\d{2}\b|\b\d{1,2} ?o'? ?clock\b|\b(?:noon|midnight|subah|shaam|sham|raat|dopahar|morning|afternoon|evening)\b/;
const EVENT = /\b(?:meetings?|appointments?|appt|lunch|dinner|breakfast|brunch|coffee|stand-?ups?|stand up|sync|interview|dentist|doctor|birthday|anniversary|party|events?|session|demo|review|1:1|one on one|catch ?up|webinar|workshop|wedding|deep work|focus time|class|call with|(?:a|the|my) call|(?:ke )?saath (?:call|meeting|baat|lunch|dinner))\b/;
const CREATE_EVENT = /\b(?:schedule|set up|block|invite)\b|\bbook (?:a |an )?(?:slot|time|session|appointment|meeting|call)\b/;
/** A time said as a thing: "my 5pm", "tmrw's 9am", "the 4 o'clock". An event named by its hour, never an alarm or a train. */
const SLOT = new RegExp(`(?:\\b(?:my|the|this|that|(?:${DAYS})'s) (?:\\d{1,2}(?::\\d{2})? ?(?:am|pm)|\\d{1,2} ?o'? ?clock|\\d{1,2}:\\d{2}|noon)\\b|\\b\\d{1,2}(?::\\d{2})? ?baje (?:wali|wala|waali|waala)\\b)(?! ?(?:alarm|timer|flight|train|bus|medicine|meds|pills?|dose|show|movie)s?\\b)`);
/** A place to go: a word that says it is one ("MG road", "the railway station", "the airport"), never "the fastest way to learn python". */
const PLACE = "(?:the |my )?(?:[a-z0-9'.-]+ ){0,3}?(?:road|rd|street|marg|nagar|mall|station|airport|market|colony|sector|layout|metro|hospital|office|home|house|park|beach|temple|mandir|masjid|church|gurudwara|university|college|school|campus|cafe|restaurant|hotel|stadium|junction|chowk|bazaa?r|gate|terminal|port|bus stand|bus stop|centre|center|bridge|lake|fort|palace|pump|branch|atm|bank|clinic|gym|theatre|theater|cinema|plaza|tower|complex|apartments?|society|city|town|village)\\b";
/** Something to do, not somewhere to go: "the best way to clean my house", "to make money from home". */
const TO_DO = "(?!(?:clean|make|learn|cook|earn|lose|gain|save|study|build|grow|fix|write|read|start|stop|remove|keep|be|do|deal|handle|decorate|organi[sz]e|paint|sell|buy|rent|heat|cool|light|furnish|insure|work|sleep|relax|eat|drink|pack|prepare|teach|explain|find|search|book|set|run|use|manage|protect|secure|wash|dry)\\b)";
const TO_PLACE = new RegExp(`\\b(?:fastest|quickest|shortest|best|easiest) (?:way|route|path) (?:to get )?to ${TO_DO}${PLACE}|\\bhow (?:far|long) (?:is it |does it take |will it take )?(?:to (?:get to |drive to |walk to |reach ))?(?:is )?${PLACE}|\\bhow far is .{1,40}? from (?:here|me|my (?:home|office|place|house))\\b`);
/** Hinglish for "put it in": "call rakh do", "meeting fix kar do". */
const RAKH = /\b(?:rakh do|rakho|rakh de|rakhna|rakh lo|fix kar do|fix karo|set kar do|set karo)\b/;

const UPI_ID = /(?:^|[\s,(:])[a-z0-9][a-z0-9._-]*@[a-z]{2,}(?![a-z0-9.@-])/;
const EMAIL_ADDR = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;

/** What a request starts with before its verb: "hey", "please", "can you", "haan,". */
const LEAD = new RegExp(`^(?:(?:hey|hi|hello|ok|okay|so|and|also|then|now|actually|please|pls|plz|kindly|just|quickly|can you|could you|would you|will you|can u|could u|i want you to|i need you to|i want to|i'd like to|i need to|help me|${OWN_NAME}|blip|ji|haan|han|ha|yes|yeah|yep|no|nahi|arre|arey|accha|acha|achha|oh|um|uh|bhai|yaar)\\b[ ,!.]*)+`);

// ------------------------------------------------------------------ verbs

/** A to-do ticked off: "tick it off", "cross off buy milk", "check that off", "mark X as done". */
const TICK_OFF = /\btick(?:ed)?(?: [a-z']+){0,3} off\b|\btick kar\b|\b(?:cross|strike)(?:ed)?(?: [a-z']+){0,3} off\b|\bcheck(?:ed)? (?:it |that |this |them )?off\b|\bmark(?:ed)?\b.{0,40}\b(?:as )?(?:done|complete|completed|finished)\b/;
const V_COMPLETE = new RegExp(`${TICK_OFF.source}|\\bho gaya\\b|\\bho gya\\b|\\bhogaya\\b|\\b(?:is|as) done\\b|\\bcomplete (?:the|my)\\b|\\bfinished\\b`);
const V_DELETE = /\b(?:cancel|delete|remove|erase|scrap|call off|hata|hatao|hata do|mita do|nikal do)\b|\b(?:drop|clear) (?:the|my|this|that|out|tomorrow's|today's)\b/;
const V_MOVE = /\b(?:move|push|shift|reschedule|re-schedule|prepone|postpone|bump|badal do|aage kar|peeche kar)\b|\bchange (?:it|that|the time)\b|\bmake it (?:at )?\d|\b\d{1,2}(?::\d{2})? ?(?:am|pm|baje)? (?:kar do|karo|kar dena)\b/;
/** A change to a thing already there, which tools call update or edit: "close the bug", "rename my page", "assign ENG-12". Said of a thing, never "the latest update". */
const V_UPDATE = /\b(?:update|edit|change|rename|re-?assign|assign|close|resolve|re-?open|modify|transition)\b (?=(?:the|my|our|this|that|it|its|his|her|their|[a-z]+-\d+|\d)\b)/;
const V_FREE = /\b(?:free|available|availability|khaali|khali)\b/;
const V_READ_START = /^(?:what|what's|whats|which|when|who|how many|how much|any|is there|are there|do i|did i|have i|show|list|see|check|find|search|look|get|read|pull up|tell me|summari[sz]e)\b/;
const V_READ = /\b(?:kya|dikhao|dikha do|batao|bata do|kitni|kitne|kab|dhoondo|dhundo|show me|look up|what's|whats|what is)\b/;
// Not bare "new": "the new date" is no create.
const V_CREATE = /\b(?:add|put|create|make|schedule|set up|setup|plan|write|draft|start|banao|bana do|bana de|daal do|daalo|dal do|likh do|likho|likh de|jod do|note|jot|remind|file|raise|open|invite|block|save)\b|^comment on\b|\b(?:leave|post|drop) (?:a |my )?comment\b/;

/** The verb of a request, when it says one. A change outranks a look: "cancel what's on at 3" cancels. */
export function verbOf(t: string): Verb | null {
  const h = head(t);
  if (V_COMPLETE.test(t)) return "complete";
  if (V_DELETE.test(t)) return "delete";
  if (V_MOVE.test(t) || V_UPDATE.test(t)) return "move";
  if (V_FREE.test(t)) return "free";
  if (V_READ_START.test(h) || V_READ.test(t)) return "read";
  if (V_CREATE.test(t)) return "create";
  return null;
}

/** A tool's verb, from its name: create_event, todoist-mark-task-completed, transitionJiraIssue. */
export function toolVerb(name: string): Verb | null {
  const w = new Set(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const has = (...xs: string[]) => xs.some((x) => w.has(x));
  if (has("free", "available", "availability", "slots", "busy")) return "free";
  if (has("complete", "completed", "done", "finish", "mark")) return "complete";
  if (has("delete", "cancel", "remove", "archive", "trash")) return "delete";
  if (has("move", "reschedule", "update", "edit", "change", "transition", "shift")) return "move";
  if (has("append", "log")) return "append";
  if (has("create", "add", "new", "make", "insert", "write", "compose", "draft", "book", "post", "save", "start", "quick")) return "create";
  if (has("send", "share", "reply")) return "send";
  if (has("list", "get", "search", "find", "fetch", "read", "query", "show", "whats", "my", "announcements")) return "read";
  return null;
}

// ------------------------------------------------------------------ the apps people name

interface Product {
  label: string;
  re: RegExp;
  ids: readonly string[];
  /** Does other apps' jobs for them, so "via X" / "use X to" names the way, not the thing. */
  hub?: boolean;
  tool?: string;
  /** The jobs it does beyond its ids': an app Tailzu cannot reach, or one it reaches through another (Slack). */
  jobs?: readonly Job[];
  /** A channel the person talks on, not a place they keep things, though reached through a hub (Slack). */
  channelApp?: boolean;
}

const BEFORE = "(?:in|on|into|onto|to|from|via|using|use|through|with|my|our|mere|meri|mera)";
const AFTER = "(?:pe|par|pr|mein|me|se)";
/** A name that is also an everyday word: only when it is framed as an app. */
const framed = (name: string, nouns: string) =>
  new RegExp(`\\b${BEFORE} ${name}\\b|\\b${name} ${AFTER}\\b|\\b${name}'s\\b|\\b${name} (?:${nouns})\\b`);

/**
 * Longest names first: "youtube music" before "youtube", "google calendar"
 * before anything with "calendar" in it. A matched name is taken out of the
 * words before the next is looked for.
 */
const PRODUCTS: readonly Product[] = [
  { label: "Google Calendar", re: /\bgoogle calendar\b|\bgcal\b/, ids: ["google-calendar"] },
  { label: "Google Tasks", re: /\bgoogle tasks?\b/, ids: ["google-tasks"] },
  { label: "Google Docs", re: /\bgoogle docs?\b/, ids: ["google-docs"] },
  { label: "Google Sheets", re: /\bgoogle sheets?\b/, ids: ["google-sheets"] },
  { label: "Google Forms", re: /\bgoogle forms?\b/, ids: ["google-forms"] },
  { label: "Google Classroom", re: /\bgoogle classroom\b/, ids: ["google-classroom"] },
  { label: "Google Maps", re: /\bgoogle maps?\b/, ids: ["maps"] },
  { label: "Google Pay", re: /\bgoogle pay\b|\bg ?pay\b/, ids: ["upi"] },
  { label: "YouTube Music", re: /\b(?:youtube|yt) music\b/, ids: ["play"], tool: "youtube_music" },
  // Two apps: play it (the play hand-off's YouTube), or search it (YouTube's search). The job says which.
  { label: "YouTube", re: /\byou ?tube\b|\byt\b/, ids: ["play", "youtube"], tool: "youtube" },
  { label: "Spotify", re: /\bspotify\b/, ids: ["play"], tool: "spotify" },
  { label: "Notion", re: framed("notion", "pages?|docs?|database|workspace|wiki|notes?"), ids: ["notion"] },
  { label: "Linear", re: framed("linear", "issues?|tickets?|projects?|cycles?|teams?|boards?"), ids: ["linear"] },
  { label: "GitHub", re: /\bgit ?hub\b/, ids: ["github"] },
  { label: "Jira", re: /\bjira\b/, ids: ["atlassian"] },
  { label: "Confluence", re: /\bconfluence\b/, ids: ["atlassian"] },
  { label: "Atlassian", re: /\batlassian\b/, ids: ["atlassian"] },
  { label: "Asana", re: /\basana\b/, ids: ["asana"] },
  { label: "Zapier", re: /\bzapier\b/, ids: ["zapier"], hub: true },
  // Tailzu reaches Slack only through Zapier. Not "slack off", "cut me some slack".
  { label: "Slack", re: /(?<!\bsome |\ba little |\bany )\bslack\b(?! off\b)/, ids: ["zapier"], jobs: ["message"], channelApp: true },
  { label: "Todoist", re: /\btodoist\b|\bto doist\b/, ids: ["todoist"] },
  { label: "Calendly", re: /\bcalendly\b/, ids: ["calendly"] },
  { label: "Cal.com", re: /\bcal\.com\b|\bcalcom\b|\bcal dot com\b/, ids: ["calcom"] },
  { label: "Granola", re: framed("granola", "notes?|meetings?|transcripts?"), ids: ["granola"] },
  { label: "Otter", re: framed("otter", "notes?|meetings?|transcripts?|recordings?|summary"), ids: ["otter"] },
  { label: "Fireflies", re: framed("fire ?flies", "recaps?|notes?|meetings?|transcripts?|summary"), ids: ["fireflies"] },
  { label: "Evernote", re: /\bever ?note\b/, ids: ["evernote"] },
  { label: "ClickUp", re: /\bclick ?up\b/, ids: ["clickup"] },
  { label: "Trello", re: /\btrello\b/, ids: ["trello"] },
  { label: "Airtable", re: /\bair ?table\b/, ids: ["airtable"] },
  { label: "Monday.com", re: /\bmonday\.com\b|\bmonday dot com\b/, ids: ["monday"] },
  { label: "Make", re: /\bmake\.com\b|\bmake dot com\b|\bintegromat\b|\b(?:in|on|via|using|use|through|my) make\b|\bmake scenarios?\b/, ids: ["make"], hub: true },
  { label: "Composio", re: /\bcomposio\b/, ids: ["composio"], hub: true },
  { label: "Pipedream", re: /\bpipe ?dream\b/, ids: ["pipedream"], hub: true },
  { label: "Gmail", re: /\bg ?mail\b/, ids: ["email-handoff"] },
  // Said as the way: "let the client know by email", "tell her over sms".
  { label: "Email", re: /\b(?:on|by|via|over|through) e-?mail\b/, ids: ["email-handoff"] },
  { label: "SMS", re: /\b(?:on|by|via|over|through) (?:sms|text message)\b/, ids: ["phone"], tool: "text" },
  { label: "WhatsApp", re: /\bwhats ?app\b/, ids: ["whatsapp"] },
  { label: "Telegram", re: /\btelegram\b/, ids: ["telegram"] },
  { label: "UPI", re: /\bupi\b|\bphone ?pe\b|\bpaytm\b|\bbhim\b/, ids: ["upi"] },
  { label: "Uber", re: /\buber\b/, ids: ["uber"] },
  { label: "Amazon", re: /\bamazon\b/, ids: ["shopping"], tool: "amazon_search" },
  { label: "Flipkart", re: /\bflipkart\b/, ids: ["shopping"], tool: "flipkart_search" },
  { label: "Threads", re: framed("threads", "posts?"), ids: ["threads"] },
  { label: "Booking.com", re: /\bbooking\.com\b|\bbooking dot com\b/, ids: ["booking"] },
  // Apps Tailzu has no way into: named, so nothing else stands in for them.
  { label: "Swiggy", re: /\bswiggy\b/, ids: [], jobs: ["shopping"] },
  { label: "Zomato", re: /\bzomato\b/, ids: [], jobs: ["shopping"] },
  { label: "Ola", re: /\bola\b/, ids: [], jobs: ["ride"] },
  { label: "Rapido", re: /\brapido\b/, ids: [], jobs: ["ride"] },
  { label: "Outlook", re: /\boutlook\b/, ids: [], jobs: ["calendar", "email"] },
  { label: "Microsoft Teams", re: /\bmicrosoft teams\b|\bms teams\b|\b(?:on|in|via|over) teams\b|\bteams (?:pe|par)\b/, ids: [], jobs: ["message", "calendar"] },
  { label: "Apple Calendar", re: /\bapple calendar\b|\bical\b/, ids: [], jobs: ["calendar"] },
  { label: "Instagram", re: /\binstagram\b|\binsta\b/, ids: [], jobs: ["message"] },
  { label: "Facebook", re: /\bfacebook\b|\bfb messenger\b/, ids: [], jobs: ["message"] },
  { label: "LinkedIn", re: /\blinked ?in\b/, ids: [], jobs: ["message"] },
  { label: "X", re: /\btwitter\b|\btweet\b/, ids: [] },
  { label: "Discord", re: /\bdiscord\b/, ids: [], jobs: ["message"] },
  { label: "Signal", re: /\b(?:on|in|via) signal\b/, ids: [], jobs: ["message"] },
  { label: "Snapchat", re: /\bsnapchat\b|\bsnap chat\b/, ids: [], jobs: ["message"] },
  { label: "Google Keep", re: /\bgoogle keep\b/, ids: [], jobs: ["notes", "tasks"] },
  { label: "Apple Notes", re: /\bapple notes\b/, ids: [], jobs: ["notes"] },
  { label: "OneNote", re: /\bone ?note\b/, ids: [], jobs: ["notes"] },
  { label: "Microsoft To Do", re: /\bmicrosoft to ?do\b/, ids: [], jobs: ["tasks"] },
  { label: "TickTick", re: /\btick ?tick\b/, ids: [], jobs: ["tasks"] },
  { label: "Google Drive", re: /\bgoogle drive\b/, ids: [], jobs: ["docs", "sheets"] },
  { label: "Dropbox", re: /\bdropbox\b/, ids: [], jobs: ["docs"] },
  { label: "Blinkit", re: /\bblinkit\b/, ids: [], jobs: ["shopping"] },
  { label: "Zepto", re: /\bzepto\b/, ids: [], jobs: ["shopping"] },
  { label: "BigBasket", re: /\bbig ?basket\b/, ids: [], jobs: ["shopping"] },
  { label: "Myntra", re: /\bmyntra\b/, ids: [], jobs: ["shopping"] },
  { label: "Netflix", re: /\bnetflix\b/, ids: [], jobs: ["play"] },
  { label: "Hotstar", re: /\bhotstar\b/, ids: [], jobs: ["play"] },
];

/** The ids of every app a product name can stand for: what the router may take as named. */
export const NAMED_IDS: ReadonlySet<string> = new Set(PRODUCTS.flatMap((p) => p.ids));

/** Where content starts, after a message's verb: "message Rahul on telegram THAT I'm late". */
const CONTENT = /\b(?:that|saying|ki|to say)\b|:/;

/** Hand-offs: they open another app to send, call, pay or go, and keep nothing of the person's. */
const HANDOFF_JOBS: readonly Job[] = ["message", "sms", "email", "call", "pay", "directions", "places", "ride", "hotels", "shopping", "play", "video-search"];

const CHANNEL_BEFORE = /\b(?:on|in|via|using|use|through|over|with)\s*$/;
const CHANNEL_AFTER = /^\s*(?:pe|par|pr|se|mein|me)\b/;
const FRAME_BEFORE = /\b(?:in|on|into|onto|to|from|via|using|use|through|with|over|my|our|mere|meri|mera)\s*$/;
/** "notion page", "jira ticket", "trello board": the app said as where a thing is. */
const APP_NOUN = /^(?:'s\b|\s+(?:pages?|docs?|database|workspace|wiki|notes?|notebooks?|issues?|tickets?|projects?|boards?|cards?|bases?|tables?|tasks?|lists?|channels?|account|repos?|inbox|calendar|events?|transcripts?|recordings?|meetings?|scenarios?|workflows?|zaps?|links?|bookings?|messages?|chats?|dms?|groups?|posts?)\b)/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name the person gave an app, as words that may be said with or without a plural "s". */
const ownName = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return words.length ? new RegExp(`\\b${words.map((w) => `${escapeRe(w)}s?`).join("[^a-z0-9]+")}\\b`) : null;
};

function findNamed(t: string, from = 0, until = t.length, own: readonly OwnApp[] = []): Named[] {
  // An email address or a UPI ID is not a name: "rahul@gmail.com" names no Gmail.
  let s = t.replace(EMAIL_ADDR, (m) => " ".repeat(m.length)).replace(/[a-z0-9._-]+@[a-z]+/g, (m) => " ".repeat(m.length));
  s = " ".repeat(from) + s.slice(from, until) + " ".repeat(Math.max(0, t.length - until));
  // Where the request starts after its "hey" or "can you": a name there is said as the verb ("whatsapp Neha").
  const lead = t.length - head(t).length;
  const out: Named[] = [];
  // The person's own apps first: "Slack Bot" is theirs before it is Slack.
  const all: Array<Product & { own?: boolean }> = [
    ...own.flatMap((a) => a.names.map(ownName).filter((re): re is RegExp => !!re).map((re) => ({ label: a.names[0]!, re, ids: [a.id], own: true }))),
    ...PRODUCTS,
  ];
  for (const p of all) {
    const m = new RegExp(p.re.source, "g");
    let hit: RegExpExecArray | null;
    while ((hit = m.exec(s))) {
      const at = hit.index;
      const lead1 = BEFORE_RE.exec(hit[0])?.[0].length ?? 0;
      const core = hit[0].slice(lead1).replace(AFTER_RE, "");
      const coreAt = at + lead1;
      const pre = t.slice(Math.max(0, coreAt - 24), coreAt);
      const post = t.slice(coreAt + core.length, coreAt + core.length + 24);
      const via = !!p.hub && (/\b(?:via|using|use|through|with)\s*$/.test(pre));
      const channel = via || CHANNEL_BEFORE.test(pre) || CHANNEL_AFTER.test(post) || coreAt === lead || /,\s*$/.test(pre);
      const framed = channel || FRAME_BEFORE.test(pre) || APP_NOUN.test(post) || /'s$/.test(core);
      const handoff = p.ids.some((id) => HANDOFF_JOBS.some((j) => JOB_APPS[j].includes(id)));
      if (!out.some((o) => o.label === p.label)) {
        out.push({
          label: p.label, ids: p.ids, phrase: core.trim(), via, at, framed, channel,
          workspace: !!p.own || (p.ids.length > 0 && !handoff && !p.channelApp),
          ...(p.tool ? { tool: p.tool } : {}), ...(p.jobs ? { jobs: p.jobs } : {}),
        });
      }
      s = s.slice(0, at) + " ".repeat(hit[0].length) + s.slice(at + hit[0].length);
      m.lastIndex = at + hit[0].length;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
const BEFORE_RE = new RegExp(`^${BEFORE} `);
const AFTER_RE = new RegExp(` ${AFTER}$`);

// ------------------------------------------------------------------ the request

/**
 * The misspellings people type and speech-to-text writes for the words the
 * rules read, put right before anything is read: "remmind", "calender",
 * "wats on tmrw", "shedule", "set a remainder", "w/".
 */
const TYPOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:remmind|remaind|remidn|reminde|rmind|remnd|reimnd|remiind)\b/g, "remind"],
  [/\b(?:remider|reminer|remindr|reminderr|remaindr|remidner|reminedr)\b/g, "reminder"],
  [/\b(set|add|put|create|keep|lagao|laga do) (a |an )?remainder\b/g, "$1 $2reminder"],
  [/\b(?:calender|calander|calandar|calendr|calener|calnder|calandr|calneder)\b/g, "calendar"],
  [/\b(?:wats|whts|wht's|wat's|whta's|whta)\b/g, "whats"],
  [/\bwat\b/g, "what"],
  [/\b(?:tomorow|tommorow|tommorrow|tomorrw|tomrow|tmorrow|tomoro|2moro|2morrow|tmw)\b/g, "tomorrow"],
  [/\b(?:shedule|schedual|scedule|shcedule|schdule|schedle|schedul)\b/g, "schedule"],
  [/\b(?:meetign|meting|meetin|meeitng)\b/g, "meeting"],
  [/\b(?:apointment|appointmnet|appoinment|appointmnt|apointmnt)\b/g, "appointment"],
  [/(^|\s)w\/\s?(?=[a-z])/g, "$1with "],
];

/** The words, lowercased, with quotes made plain, misspellings put right and spaces made single. */
export function normalize(s: string): string {
  let t = s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, "\"");
  for (const [re, to] of TYPOS) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

/** The request without its "hey", "please" or "can you". */
function head(t: string): string {
  return t.replace(LEAD, "").trim();
}

/** Each part of the words that could start a command: the whole, and what follows a comma or a full stop. */
function heads(t: string): string[] {
  return [t, ...t.split(/[,;]|\.\s/).slice(1)].map((x) => head(x.trim())).filter(Boolean);
}
const starts = (t: string, re: RegExp) => heads(t).some((h) => re.test(h));

interface Read { job: Job; verb: Verb | null; tool?: string; weak?: boolean; content?: number }

/**
 * Asked to be reminded, said any way: "remind me to...", "yaad dila do", "set
 * a reminder", "make sure I don't forget to...", "don't let me forget...",
 * "bhool na jaun". Never "remind me what we said".
 */
const REMIND = /\bremind(?:er)? me\b(?! (?:what|who|how|where|why|which|of)\b)|\bremind (?!me\b)[a-z]+ to\b|\byaad (?:dila|dilana|dila do|dila dena|dilado|dilaana|karwa|karwana|rakhna|kara do)\b|\bset (?:a |an )?reminder\b|\breminder\b(?! (?:app|list)s?\b)|\b(?:make sure|ensure|make certain) (?:that )?i (?:don'?t|do not|never) forget\b|\b(?:make sure|ensure) (?:that )?i remember\b|\bdon'?t let me forget\b|\bbhool na jaa?un?\b|\bbhoolna (?:mat|nahi)\b|\bmujhe yaad rah(?:e|na)\b/;

/** "remind me to...", "todo:", "add X to my list", "note this down": the whole request, whatever is in it. */
function wrapper(t: string): Read | null {
  const remind = REMIND.exec(t);
  if (remind && !/\b(?:show|list|what|which|see|dikhao|delete|remove|cancel)\b[^.]*\breminders\b/.test(t)) {
    // "delete the dentist reminder", "show me tomorrow's reminder": a reminder already there, changed or looked at.
    if (remind[0] === "reminder") {
      const before = verbOf(t.slice(0, remind.index));
      if (before === "delete" || before === "complete" || before === "move" || before === "read") return { job: "tasks", verb: before };
      if (/^\s*(?:is |as )?(?:done|complete|completed|finished|ho gaya)\b/.test(t.slice(remind.index + remind[0].length))) return { job: "tasks", verb: "complete" };
    }
    return { job: "tasks", verb: "create", content: remind.index };
  }
  const todo = /^(?:to-?do|todo)\s*:|\badd (?:this |it |that )?to (?:my |the )?(?:to-?do|todo|to do)(?: list)?\b|\badd .{1,60}? to (?:my |the )?(?:to-?do |todo |to do |shopping |grocery )?list\b|\b(?:add|create|make|new) (?:a |an )?(?:new )?(?:task|to-?do|todo)\b|\btask (?:bana do|banao|bana de|add karo|add kar do|daal do)\b|\blist (?:mein|me|main) (?:daal|add|likh|jod)\w*/.exec(t);
  if (todo) return { job: "tasks", verb: "create", content: todo.index };
  const note = /\b(?:take|make|add|write|create) (?:a |an )?(?:quick |new |short )?note\b|\bnote (?:this|it|that|these)\b|\bnote down\b|^note\s*:|\bnote to (?:self|myself)\b|\bnotes? for myself\b|\bjot(?: (?:this|it|that|these))? down\b|\bjot\b|\bnote (?:bana|banao|bana do|likh|likho|likh do|kar lo|kar do)\b|\bsave (?:this|it|that) as a note\b/.exec(t);
  // In Docs a note is a new doc, not one of Tailzu's notes saved there.
  if (note) return { job: "notes", verb: "create", tool: "create_doc", content: note.index };
  return null;
}

/** Not a person to message: "tell the truth", "message passing", "text editor". */
const NOT_SAID_TO = "(?!me\\b|us\\b|it\\b|myself\\b|passing\\b|queues?\\b|brokers?\\b|bus\\b|formats?\\b|boards?\\b|box\\b|templates?\\b|ids?\\b|limits?\\b|length\\b|history\\b|editor\\b|field\\b|the (?:truth|time|difference|story|world)\\b|a (?:joke|story|lie)\\b|jokes?\\b|stories\\b|lies\\b|apart\\b|fortunes?\\b|whether\\b|if\\b|how\\b|what\\b|why\\b|which\\b)";
/** Subject pronouns and articles: after a recipient they start what is said ("tell mom I'm late", "email Priya the deck"). */
const SAID_STARTS = "to|i|i'm|im|i'll|i've|i'd|we|we're|we'll|we've|you|you're|u|ur|it's|he|he's|she|she's|they|they're|there's|the|a|an|this|that|these|those|my|our|your|his|her|their|if|whether|for|about";
const RECIPIENT_WORD = "(?!(?:on|in|via|at|over|through|using|with|from|pe|par|ko|and|to|that|saying|about|for|the|a|an|me|us|it|myself)\\b)[a-z0-9@._'-]+";
const AFTER_RECIPIENT = new RegExp(`^(?:message|msg|text|tell|ping|whatsapp|inform|wish|ask|e-?mail|mail) (?:(?:the|my|our|his|her|their) )?${RECIPIENT_WORD}(?: ${RECIPIENT_WORD})?? (?=(?:${SAID_STARTS})\\b)|^let (?!me\\b|us\\b|it\\b)[a-z' ]{1,30}? know\\b(?: (?:on|via|over|through|using) [a-z0-9.]+)? ?`);

/**
 * Where what a message or an email says starts, when it starts right after
 * who it is for: "message Rahul | to check his gmail", "text mom | I booked
 * the uber", "email the team | the notion doc link", "let dad know | I landed".
 */
function afterRecipient(t: string): number | undefined {
  const h = head(t);
  const m = AFTER_RECIPIENT.exec(h);
  return m ? t.length - h.length + m[0].length : undefined;
}

/** A command at the start of the request (or of a part after a comma), or a Hinglish one with its verb at the end. */
function command(t: string): Read | null {
  // What a message says starts after its verb: "Priya ki mummy ko telegram pe bolo" has no content before "ko".
  const marked = (from = 0) => { const r = new RegExp(CONTENT.source, "g"); r.lastIndex = from; const m = r.exec(t); return m ? m.index : undefined; };
  const contentAt = (from = 0) => { const a = marked(from), b = afterRecipient(t); return a === undefined ? b : b === undefined ? a : Math.min(a, b); };
  const hinglishVerb = (re: RegExp) => { const m = re.exec(t); return m ? m.index : -1; };
  // Money: a UPI ID anywhere, or a payment said as one.
  if (UPI_ID.test(t) || starts(t, /^(?:pay|paytm|phonepe)\b(?! (?:attention|off|for itself|scales?|grades?|bands?|slips?|structure|gaps?|rise|raise|cuts?|day|period|range|package|parity|per click|as you go|wall|stubs?)\b)/)
    || starts(t, /^(?:send|transfer) (?:rs\.? ?|₹ ?|inr ?)?\d[\d,]*(?:\.\d+)? ?(?:rs|rupees|rupaye|rupay|bucks|inr)?\b.{0,30}\bto\b/)
    || /\b\d[\d,]* ?(?:rs|rupees|rupaye|rupay|₹)? ?(?:bhej|bhejo|bhej do|bhej de|transfer kar)/.test(t) || /\bpaise bhej|\b(?:send|transfer) money\b/.test(t)) {
    return { job: "pay", verb: "send" };
  }
  // A text on the phone: "sms", "text message", or "text" to a number.
  if (starts(t, /^(?:sms|text message)\b|^send (?:a |an )?(?:sms|text message)\b|^text (?:\+?\d[\d -]{6,})/) || /\bsms (?:karo|kar do|bhejo)\b/.test(t)) {
    return { job: "sms", verb: "send", tool: "text", content: contentAt() };
  }
  const koMail = hinglishVerb(/\bko (?:e-?mail|mail) (?:karo|kar do|kardo|bhejo|bhej do|likho|likh do)\b/);
  if (starts(t, /^(?:e-?mail|mail) (?!is\b|id\b|address\b|marketing\b|campaigns?\b|templates?\b|etiquette\b|formats?\b|signatures?\b|newsletters?\b|lists?\b|tips\b|writing\b|security\b|servers?\b|providers?\b|subject lines?\b|vs\b)/) || starts(t, /^(?:write|draft|compose|send|shoot|prepare) (?:a |an |the )?(?:quick |short |formal |new )?(?:e-?mail|mail)\b/)
    || koMail >= 0 || starts(t, /^(?:reply|respond) to .{0,40}\b(?:e-?mail|mail)\b/)) {
    return { job: "email", verb: "send", content: contentAt(Math.max(0, koMail)) };
  }
  // A person to call: not "call it a day", "call me back", "call off the meeting", "call this function".
  if (starts(t, /^(?:call|ring|dial|phone)\b(?! it a (?:day|night)\b)(?! me\b)(?! (?:off|out)\b)(?! back(?:\s*$| later\b| in\b| when\b| after\b))(?! (?:this|that|these|those|the|a|an|my) (?:function|method|api|endpoint|script|hook|callback|command|procedure|subroutine|service|lambda|macro)s?\b)/)
    || starts(t, /^(?:make|place) a (?:phone )?call to\b/) || starts(t, /^give (?!me\b|us\b)(?:[a-z']+ ){1,3}?a (?:quick )?(?:call|ring|buzz|phone call)\b/)
    || /\bko (?:call|phone|fone|ring) (?:karo|kar do|kardo|lagao|laga do|kar)\b/.test(t)) {
    return { job: "call", verb: "send", tool: "call" };
  }
  const koSay = hinglishVerb(/\bko (?:ek )?(?:[a-z]+ (?:pe|par) )?(?:message|msg|whatsapp|text|bol|bolo|bol do|bol de|bolna|bata|batao|bata do|bata de|batana|keh do|kaho|keh de|inform karo)\b/);
  if (starts(t, new RegExp(`^(?:message|msg|whatsapp|text|ping|tell|inform|reply to|respond to|wish) ${NOT_SAID_TO}`))
    || starts(t, /^let (?!me\b|us\b|it\b)[a-z' ]{1,30}? know\b/) || starts(t, /^drop (?:[a-z]+ )?(?:a )?(?:message|msg|text|line)\b|^drop (?:a )?(?:quick )?note to\b/)
    || starts(t, /^send (?:a |an )?(?:quick |short |small )?(?:message|msg|whatsapp|telegram|slack|dm|text)\b|^send [a-z]+ (?:a |an )?(?:message|msg|text|whatsapp)\b|^send (?:a |an )?(?:quick |short |small )?(?:note|line) to\b/)
    || starts(t, new RegExp(`^ask (?!(?:me|you|for|about|if|whether|why|how|what|when|where|who|which|google|siri|alexa|chatgpt|claude|${OWN_NAME}|a|an|questions?)\\b)(?:(?:the|my|our) )?[a-z0-9'.-]+(?: [a-z0-9'.-]+)? (?:to|if|whether|for|about|when|ki|ke)\\b`))
    || koSay >= 0) {
    return { job: "message", verb: "send", content: contentAt(Math.max(0, koSay)) };
  }
  if (starts(t, /^(?:directions?|navigate|navigation|show me the way|get directions)\b|^route (?:to|from|me)\b/)
    || starts(t, /^(?:take|drive|guide) me\b(?! (?:through|thru|seriously|back to when|for granted|for a fool|as|with|step by step|on how|how)\b)/)
    || starts(t, /^(?:cycle|cycling|bike|biking|walk|walking|driving|drive|transit|bus|metro) (?:route|directions?|path) to\b/)
    // Not "how do I get to level 5", "the next level in my career".
    || /\bhow (?:do|can|should|would) (?:i|we) (?:get|go|reach) (?:to|there)\b(?! (?:the )?(?:next|top|bottom|end|point|root|heart|level|stage|round|chapter|page|step|grade|rank|tier|boss|zero|inbox|sleep|know|\d)\b)|\bhow to (?:get|go|reach) to\b(?! (?:the )?(?:next|top|level|stage|round|chapter|step|grade|rank|\d)\b)/.test(t)
    || TO_PLACE.test(t)
    || (/\b(?:rasta|raasta|rastaa)\b/.test(t) && !/\b(?:problems?|issues?|samasya|masl[ae]|masla|solution|dikkat|pareshani|zindagi|life|career)\b/.test(t))) {
    return { job: "directions", verb: "read", tool: "directions" };
  }
  if (/\b(?:near me|nearby|nearest|closest|around me|near here|aas ?paas|paas mein)\b/.test(t)) return { job: "places", verb: "read", tool: "search" };

  if (/\b(?:book|get|call|order|need)(?: me)? (?:a |an )?(?:cab|taxi|ride|auto)\b|\b(?:cab|taxi|auto) (?:book|bula|chahiye|karo|kar do|to)\b/.test(t)) return { job: "ride", verb: "create" };
  // A stay somewhere, some time: not "is hotel management a good career".
  if ((/\bhotels?\b(?! (?:management|industry|business|chain|career|jobs?|course|degree|staff|manager|school)\b)|\bhostels?\b|\bresorts?\b|\bhomestays?\b|\bplaces? to stay\b|\brooms? (?:in|dikhao|chahiye|book)\b|\bmein .{0,30}\brooms?\b/.test(t))
    && (/\b(?:in|near|at|around|close to|mein|me|for|book|find|show|search|look(?:ing)? for|get|need|want|cheap|budget|dikhao|chahiye|stay|nights?|raat)\b/.test(t) || DAY.test(t))) {
    return { job: "hotels", verb: "read" };
  }
  // Something to buy: not "order these names alphabetically", "order of operations".
  if ((starts(t, /^(?:buy|order|shop for|purchase)\b(?! (?:of|these|this|that|them|it|the (?:list|names|rows|items|columns|results|data|steps|words|cards))\b)/)
      && !/\b(?:alphabetically|chronologically|numerically|ascending|descending|in order|by (?:date|name|size|price|length|time|age|number|value))\b/.test(t))
    || /\b(?:mangwa do|mangwao|mangwana|mangao|manga do|kharido|kharid do|kharidna|order karo|order kar do)\b/.test(t)) {
    // Amazon unless they named Flipkart (its name picks the tool).
    return { job: "shopping", verb: "read", tool: "amazon_search" };
  }
  if (/\bsearch (?:on )?you ?tube\b|\byou ?tube (?:pe|par|mein|me|on)? ?.{0,40}\b(?:dhoondo|dhundo|search|dikhao|find)\b|\bvideos? (?:dhoondo|dhundo|dikhao)\b|\bfind (?:me )?(?:some )?you ?tube videos?\b/.test(t)) {
    return { job: "video-search", verb: "read" };
  }
  // Music or a video: not "play a role", "play the devil's advocate", "play it cool".
  if (starts(t, /^(?:play|put on|stream|listen to|bajao|chalao)\b(?! (?:is|was|are|means|meaning|with|along|a game|games?|a role|a part|cricket|football|badminton|chess|tennis|ludo|cards|the (?:devil|role|part|victim|fool|field|game|card|odds)|devil'?s|it (?:safe|cool|by ear|down|straight)|dumb|fair|hard to get|by the rules|catch|tricks?|pranks?|favou?rites|dead|nice|smart|god|hooky|truant)\b)(?!\s*$)/)
    || /\b(?:bajao|baja do|bajado|sunao|suna do|chalao|chala do)\b/.test(t)) {
    // YouTube unless they named YouTube Music or Spotify (their name picks the tool).
    return { job: "play", verb: "read", tool: "youtube" };
  }
  if (/\bfind (?:me )?(?:some |a few |a )?videos? (?:on|about|of|for)\b/.test(t)) return { job: "play", verb: "read", tool: "youtube" };
  return null;
}

/** A meeting of any kind, and the words before one: "the notes from monday's standup", "yesterday's sync". */
const MEETING = "(?:meetings?|calls?|stand-?ups?|stand up|syncs?|reviews?|retros?|retrospectives?|1:1s?|one on ones?|interviews?|demos?|catch ?ups?|sessions?|webinars?|workshops?|huddles?|check-?ins?|kick-?offs?|offsites?)";
const BEFORE_MEETING = `(?:(?:the|my|our|that|last|this|yesterday's|today's|tomorrow's|(?:${DAYS})'s|[a-z]+'s) )*(?:[a-z]+ ){0,2}?`;
// "the minutes of the meeting", never "postpone it by 30 minutes".
const MEETING_NOTES = new RegExp(`\\b(?:meeting notes?|(?:the|meeting) minutes|minutes (?:of|from)|notes? (?:from|of|for|on) ${BEFORE_MEETING}${MEETING})\\b`);

/** The request without what it says or names in quotes, and without what follows a colon: the words a verb is read from. */
const plain = (t: string) => t.replace(/(^|[\s(])(['"])[^'"]{1,80}?\2(?=$|[\s,.!?;:)])/g, (m, a: string) => a + " ".repeat(m.length - a.length)).replace(/:(?!\d)[\s\S]*$/, "");

/** What the request is about, wherever the words are. In order: the narrower thing first. */
function about(t: string): Read | null {
  const v = verbOf(plain(t));
  // Booking links: before anything with "book" or "meeting" in it.
  if (/\b(?:booking|scheduling|calendly|meeting) links?\b|\blink to book\b|\bbook (?:a )?(?:time|slot|call|meeting) with me\b|\bbooked (?:time |a slot |a call |a meeting )?with me\b|\b(?:my|what|any|upcoming) bookings\b|\bbookings? (?:do i have|today|tomorrow|this week)\b/.test(t)) {
    return { job: "booking-links", verb: /\blinks?\b/.test(t) ? "create" : v };
  }
  // A meeting's notes turned into a Doc, before a meeting's notes asked about.
  const asDoc = /\b(?:docs?|document|google doc)\b/;
  if (MEETING_NOTES.test(t) && asDoc.test(t)) return { job: "docs", verb: "create", tool: "save_note" };
  if (/\btranscripts?\b|\baction items?\b|\brecap\b|\bwhat did (?:[a-z']+ ){1,3}?(?:decide|say|discuss|agree|talk about|conclude|mention)\b|\bwhat was (?:decided|discussed|said|agreed)\b|\bkya (?:decide|discuss|baat|tay|tey) hu(?:a|i|wa)\b|\bsummar(?:y|ize|ise)(?: of)? (?:my |the |that |our |last |yesterday's |today's |this )*(?:meeting|call|stand-?up|sync|review)\b|\bmeeting notes\b|\b(?:takeaways|key points|decisions|highlights) (?:from|of) (?:the |my |our |that |last |yesterday's |today's |this )*(?:[a-z]+ )?(?:meeting|call|stand-?up|sync|review)\b/.test(t)
    || (MEETING_NOTES.test(t) && v !== "create")) {
    return { job: "meeting-notes", verb: "read" };
  }
  if (/\bwrite ?up\b/.test(t) || /\b(?:write|create|make|draft|start|prepare|new|banao|bana do|likho|likh do)\b(?: (?:a|an|ek|the|new|my))*(?: [a-z0-9']+){0,3}? (?:doc|docs|document|google doc)\b/.test(t) || /\b(?:doc|document) (?:banao|bana do|likho|likh do)\b/.test(t)) {
    return { job: "docs", verb: "create", tool: "create_doc" };
  }
  if (/\b(?:spread ?sheets?|sheets?|expenses?|kharcha|kharche|hisaab|hisab|budget)\b/.test(t) || /^log (?:rs\.? ?|₹ ?)?\d/.test(head(t))
    || /^(?:add|log|spent|paid) (?:rs\.? ?|₹ ?)?\d[\d,]*(?:\.\d+)? (?:rs |rupees |rupaye |bucks )?(?:for|on)\b/.test(head(t))) {
    if (/\b(?:start|create|make|new|set up|banao|bana do|open a new)\b.{0,30}\b(?:sheet|spreadsheet)\b/.test(t)) return { job: "sheets", verb: "create" };
    // An amount to put in outranks a look: "spent 300 on lunch, add it to the sheet".
    if (/\d/.test(t) && /\b(?:add|log|put|daal|dal|likh|likho|jod|spent|paid|enter)\w*/.test(t)) return { job: "sheets", verb: "append" };
    if (/\b(?:how much|kitna|kitne|total|dikhao|show|what's in|whats in|what is in|read|batao|summary)\b/.test(t)) return { job: "sheets", verb: "read" };
    return { job: "sheets", verb: "append" };
  }
  if (/\b(?:quiz(?:zes)?|surveys?|polls?|questionnaires?|rsvp|sign-?up form|feedback form|forms?)\b/.test(t)) {
    if (/\b(?:answered|responses?|replies|replied|responded|results|filled(?: (?:in|out|up))?|submitted|signed up|kitne logon|kitno ne|bhara|votes?)\b/.test(t)
      || /\b(?:anyone|anybody|everyone|people|who|how many)\b.{0,30}\b(?:repl(?:y|ied)|respond(?:ed)?|answer(?:ed)?|fill(?:ed)?|submit(?:ted)?|voted?)\b/.test(t)) return { job: "forms", verb: "read" };
    if (/\b(?:make|create|start|build|set up|banao|bana do|new|prepare)\b/.test(t)) return { job: "forms", verb: "create" };
  }
  if (/\b(?:homework|assignments?|classwork|coursework|padhai|announcements?|classroom|turn(?:ed)? in)\b|\b(?:teacher|sir|ma'?am|miss|prof(?:essor)?) (?:posted|post|said|shared|uploaded)\b|\bmy class(?:es)?\b|\b(?:physics|maths?|chemistry|biology|bio|english|hindi|history|geography|science|economics|accounts|computer) class\b/.test(t)) {
    // Something the class was told: "did sir post anything", "what did the teacher share". Homework asked about is what is due.
    if (/\bannouncements?\b/.test(t) || (/\b(?:posted|post|shared|said|uploaded)\b/.test(t) && !/\b(?:homework|assignments?|classwork|due)\b/.test(t))) return { job: "classroom", verb: "read", tool: "announcements" };
    if (/\bmy classes\b/.test(t) && !/\b(?:due|homework|assignments?)\b/.test(t)) return { job: "classroom", verb: "read", tool: "my_classes" };
    return { job: "classroom", verb: "read", tool: "whats_due" };
  }
  if (/\bpull requests?\b|\bprs?\b|\brepos?\b|\brepositor(?:y|ies)\b|\bcommits?\b(?! to\b)/.test(t)) return { job: "code", verb: v };
  if (/\b(?:create|file|open|raise|log|report|add|close|resolve|fix|assign|update|move|reopen|new)\b(?: (?:a|an|the|new|this|that|my))?(?: [a-z0-9'-]+){0,3}? (?:issues?|tickets?|bugs?)\b/.test(t)
    || /\b(?:my|our|open|assigned|pending) (?:[a-z]+ )?(?:issues|tickets|bugs)\b|\b(?:my|our|the) (?:[a-z]+ )?(?:issue|ticket|bug)s? (?:about|for|on|regarding)\b/.test(t)
    || /\b(?:issue|ticket|bug)s?:|\b(?:sprint|backlog|epics?)\b|\bthis cycle\b|\bassigned to me\b|\b(?:issue|ticket|bug) (?:banao|bana do|kholo|daal do)\b/.test(t)) {
    // "log a bug", "report a bug": a new one.
    return { job: "issues", verb: v ?? (/\b(?:log|report|file|raise|open)\b/.test(t) ? "create" : null) };
  }
  if (/\bcards?\b.{0,40}\bboards?\b|\bboards?\b.{0,40}\bcards?\b|\bkanban\b/.test(t)) return { job: "boards", verb: v };
  if (/\bwiki\b|\bknowledge base\b/.test(t)) return { job: "wiki", verb: v };
  if (/\b(?:my|in my|search my|find my|from my|mere|meri|mera) notes?\b|\bnotes? (?:mein|me|main) (?:daal|likh|add|jod|save)\w*|\bnotebooks?\b/.test(t)) return { job: "notes", verb: v ?? "read" };
  // To-dos.
  if (TICK_OFF.test(t)) return { job: "tasks", verb: "complete" };
  if (/\bto-?dos?\b|\bto do list\b|\btasks?\b|\breminders?\b|\b(?:my|the|on my|to my|from my) list\b|\blist (?:mein|me|se|par|pe|main)\b|\b(?:shopping|grocery|groceries) list\b|\b(?:aaj|kal|mere|meri|pending|baaki|baki|saare|sab)(?: ke| ka| ki)? kaam\b|\bkaam (?:add|daal|likh|jod|hata|ho gaya|list)\b|\bwala kaam\b/.test(t)) {
    return { job: "tasks", verb: v ?? "create" };
  }
  // The calendar.
  if (/\b(?:am i|are we|is [a-z]+|are you) (?:free|available|busy)\b|\bdo i have (?:time|a free slot|any free time|a gap)\b|\bfree (?:hoon|hu|hun|ho|hai)\b|\bfind (?:me )?(?:a |an |some )?(?:free|open) (?:hour|slot|time|window|\d+ ?min\w*)\b|\bfree (?:slots?|hours?|windows?)\b|\bwhen am i free\b|\bmy (?:free time|availability)\b|\bkhaa?li\b/.test(t)) {
    return { job: "calendar", verb: "free" };
  }
  // The person's calendar, not the word: "on my calendar", "calendar mein", never "the history of the calendar".
  if (/\b(?:my |mere |meri |mera |our |on (?:the )?|to (?:the )?|from (?:the )?|in (?:the )?|off (?:the )?)calendars?\b|\bcalendars? (?:mein|me|pe|par|se)\b/.test(t)) {
    return { job: "calendar", verb: v ?? "read" };
  }
  if (new RegExp(`\\b(?:what's|whats|what is) on (?:for )?(?:${DAYS}|this|next|my (?:calendar|schedule|agenda))\\b|\\b(?:what's|whats|what is) on\\s*[?.!]*$`).test(t)
    || new RegExp(`\\bwhat do i have\\b(?: on)?(?: (?:${DAYS}|this|next))?|\\bdo i have anything\\b|\\bwhat(?:'s| is) my (?:schedule|agenda|day|plan)\\b|\\bmy (?:schedule|agenda)\\b|\\bschedule (?:batao|dikhao|kya hai)\\b|\\b(?:aaj|kal|parso)(?: ka| ki| ke)? (?:schedule|agenda|plan)\\b`).test(t)
    || /\b(?:next|upcoming|my|meri|mere|agli|kitni|any|how many|what) (?:[a-z]+ )?meetings?\b|\bmeetings? (?:do i have|hain|hai)\b|\bwhen(?:'s| is) my next\b/.test(t)) {
    return { job: "calendar", verb: v ?? "read" };
  }
  const when = DAY.test(t) || CLOCK.test(t);
  // "give me a recipe for dinner tonight" asks for something; "dinner with Neha tonight" is an event.
  const asking = QUESTION.test(head(t)) || ASKING.test(head(t));
  if (/\b(?:move|push|shift|reschedule|prepone|postpone|bump)\b/.test(t) && (EVENT.test(t) || when)) return { job: "calendar", verb: "move" };
  if (V_DELETE.test(t) && (EVENT.test(t) || SLOT.test(t))) return { job: "calendar", verb: "delete" };
  // An event named by its hour: "change my 5pm to 6pm", "is my 5pm still on?", "can you cancel tmrw's 9am".
  if (SLOT.test(t)) return { job: "calendar", verb: v ?? "read" };
  if ((EVENT.test(t) && when && (!asking || /^(?:add|put|schedule|set up|block|invite|create|book)\b/.test(head(t)))) || (CREATE_EVENT.test(t) && when) || /\bblock (?:\d+|an?|some) (?:hours?|hrs?|mins?|minutes?)\b/.test(t)
    || (RAKH.test(t) && when && /\b(?:call|meeting|meet|baat|session|appointment|class)\b/.test(t))) {
    return { job: "calendar", verb: v === "read" || v === "free" ? v : v ?? "create" };
  }
  // "move it to 6", "cancel the 3pm one": a change to something already in view.
  if (/\b(?:move|push|shift|reschedule|prepone|postpone|cancel|delete)\b.{0,24}\b(?:it|one|that|this)\b(?! (?:file|folder|page|tab|window|text|line|paragraph|image|photo|picture|slide|cell|row|column|word|sentence|code|function|email|message|app)s?\b)/.test(t)) return { job: "calendar", verb: v, weak: true };
  // "add pick up dry cleaning tomorrow": a thing to do on a day, with no event and no hour.
  if (/^(?:add|put)\b/.test(head(t)) && DAY.test(t) && !CLOCK.test(t)) return { job: "tasks", verb: "create" };
  return null;
}

/** A question about the world, or a request about the screen in front of them: no app. */
const QUESTION = /^(?:what|what's|whats|who|who's|whose|whom|which|why|how|when|where|is|are|was|were|does|do|did|can|could|should|would|will|explain|define|describe|tell me|meaning|translate|calculate|solve|summari[sz]e|fun facts?|facts?)\b/;
// "make it more formal" is the screen; "make it friday" (after "add dentist tomorrow at 4") is the request before it.
const SCREEN = new RegExp(`\\b(?:this|these|that) (?:page|form|text|email|mail|message|video|doc|document|article|post|tab|window|screen|paragraph|sentence|line|word|image|picture|photo|pdf|site|website|chart|table|code|function|method|loop|file|cell|row|column|slide|names?|numbers?|items?|words?|values?|entries|lines)\\b|\\bthese [a-z]+s\\b|^(?:scroll|click|tap|press|type|select|copy|paste|zoom|undo|redo|go back|close (?:this|it)|open (?:this|it)|rewrite|rephrase|shorten|fix (?:this|it)|fill (?:this|it|in))\\b|^make (?:it|this|that) (?!\\d|at\\b|on\\b|for\\b|(?:${DAYS})\\b|next\\b|this (?:week|month|weekend)\\b|the \\d)`);
/**
 * A question about the world that no app answers, even with an app's word in
 * it: "why is my calendar app slow", "is it rude to call after 9pm", "what is
 * a linear equation". Not "how do I get to...": that is a route.
 */
const GENERAL = /^(?:why|how come|explain|define|describe|meaning of|fun facts?|what is an? |what does|what do you|who (?:is|was|are|were|invented|wrote|won|made|discovered)\b|is it\b|how do(?:es)? (?:i|you|we|one|it|they|people)\b(?! (?:get|go|reach) (?:to|there)\b))/;
/** Telling, not asking: "the hotel was great", "my uber driver was rude", "I love spotify". */
const STATEMENT = /^(?:(?:the|my|this|that|our|his|her|their|it|he|she|they)(?: [a-z0-9']+){0,3} (?:was|were|is|are|went|looks?|seems?|feels?|got|has been|had been)\b|i (?:love|loved|like|liked|hate|hated|enjoy|enjoyed|miss|missed|think|thought|feel|felt|guess)\b)/;
/** Asking for something to be made up or said, not done in an app. */
const ASKING = /^(?:give me|suggest|recommend|tell me|explain|ideas? for|i'm|i am|i was|i think|i feel|my [a-z]+ (?:is|was|are)|write (?:me )?(?:a |an )?(?:poem|story|essay|joke|song|caption|tweet|bio|speech|letter)\b)/;
const IDIOM = /\bcall it a (?:day|night)\b|\btell me (?:a )?(?:joke|story)\b/;
/** Putting what is on the screen in order: no app keeps things sorted for them ("order these by date", "sort the list alphabetically"). */
const SORT = /^(?:sort|order|arrange|rearrange|re-?order|rank)\b.*\b(?:alphabetically|chronologically|numerically|ascending|descending|in order|a to z|by (?:date|name|size|price|length|time|age|number|value|priority))\b/;

/** Whether a named app is one for this job: "remind me in google tasks" is, "remind me to text Riya on WhatsApp" is not. */
const fits = (n: Named, job: Job) => n.via || n.ids.some((id) => doesJob(id, job)) || !!n.jobs?.includes(job);

/** Asked to send or share something: an app said as the way ("on telegram") is where it goes. */
const SEND = /^(?:send|share|forward|post|text|message|msg|whatsapp|mail|e-?mail|ping|drop)\b/;

/** Apps compared or weighed, not used: "is evernote still worth it", "jira or linear, which is better", "should I switch from asana to clickup". */
const COMPARE = /\b(?:vs\.?|versus|compare|comparison|compared to|better than|worse than|which (?:one )?is better|worth it|worth (?:paying|buying|using|getting|the money)|pros and cons|difference between|alternatives? (?:to|for))(?![a-z])/;
const COMPARE_ASKED = /\b(?:better|best|worse|worth|switch(?:ing)? (?:from|to)|(?:move|moving|migrate|migrating) (?:from|to)|recommend)\b/;

/**
 * Which of the apps named count, for what was read. Where the thing goes, not
 * what it is about:
 *   - what to remember ("remind me to text Riya on WhatsApp"): only an app for that job;
 *   - a message, an email, a call, a payment, a ride: an app for that job, or one said
 *     as the way ("on telegram", "via zapier"), and only before what is said;
 *   - a thing kept somewhere (an expense, a note, an event, an issue): an app for that
 *     job, or a place the person keeps things, never a hand-off or an app it was spent
 *     on ("spent 250 on uber, log it"), unless they asked to send it there ("send the
 *     notes from classroom on telegram");
 *   - a question with no job: only an app said as where ("what's in my notion");
 *   - nothing read: an app said as the way outranks one only mentioned.
 */
function namedFor(t: string, read: Read | null, kind: "wrap" | "command" | "about" | null, own: readonly OwnApp[]): Named[] {
  if (kind === "wrap") return findNamed(t, 0, t.length, own).filter((n) => fits(n, read!.job));
  const all = findNamed(t, 0, read?.content ?? t.length, own);
  if (kind === "command") return all.filter((n) => fits(n, read!.job) || n.channel);
  if (kind === "about") return all.filter((n) => fits(n, read!.job) || n.workspace || (n.channel && SEND.test(head(t))));
  if (QUESTION.test(head(t))) return all.filter((n) => n.framed);
  return all.some((n) => n.channel) ? all.filter((n) => n.channel || n.workspace) : all;
}

function readLine(line: string, own: readonly OwnApp[] = []): Intent & { weak?: boolean } {
  const t = normalize(line);
  const h = head(t);
  if (GENERAL.test(h) || SORT.test(h)) return { job: null, verb: null, named: [], guarded: true };
  // A statement is no request, unless it says a thing is done ("the dentist task is done"); after a
  // request it may be the answer to a question ("her email is priya@acme.com"), so it is weak.
  if (STATEMENT.test(h) && !/[,;]/.test(t) && !V_COMPLETE.test(t)) return { job: null, verb: null, named: [], guarded: true, weak: true };
  const wrap = wrapper(t);
  const cmd = wrap ? null : command(t);
  const read = wrap ?? cmd ?? about(t);
  // Apps weighed against each other, or asked about: answered as a question, never "connect X".
  const anyNamed = !wrap && !cmd ? findNamed(t, 0, t.length, own) : [];
  const asked = QUESTION.test(h) || /\?/.test(t);
  if (anyNamed.length && (COMPARE.test(t) || (COMPARE_ASKED.test(t) && asked) || (anyNamed.length > 1 && asked && /\b(?:or|ya)\b/.test(t)))) {
    return { job: null, verb: null, named: [], guarded: true };
  }
  const named = namedFor(t, read, wrap ? "wrap" : cmd ? "command" : read ? "about" : null, own);
  const job = read?.job ?? null;
  const guarded = !read && !named.length && (QUESTION.test(h) || SCREEN.test(h) || IDIOM.test(t));
  return {
    job, verb: read?.verb ?? (job ? null : verbOf(plain(t))), named, guarded,
    ...(read?.tool ? { tool: read.tool } : {}),
    ...(read?.weak ? { weak: true } : {}),
  };
}

/** The ids that do each job, best first: the person's preference when they did not name one. */
export const JOB_APPS: Readonly<Record<Job, readonly string[]>> = {
  calendar: ["google-calendar"],
  "booking-links": ["calendly", "calcom"],
  // Todoist keeps a reminder's time; Google Tasks keeps only the day.
  tasks: ["todoist", "google-tasks", "asana", "clickup"],
  notes: ["evernote", "notion", "google-docs"],
  wiki: ["notion", "atlassian"],
  docs: ["google-docs", "notion"],
  sheets: ["google-sheets", "airtable"],
  forms: ["google-forms"],
  classroom: ["google-classroom"],
  issues: ["linear", "atlassian", "github"],
  code: ["github"],
  boards: ["trello", "monday", "clickup"],
  "meeting-notes": ["granola", "fireflies", "otter"],
  // WhatsApp unless they said Telegram (or Slack, which is Zapier's, named).
  message: ["whatsapp", "telegram"],
  sms: ["phone"],
  email: ["email-handoff"],
  call: ["phone"],
  pay: ["upi"],
  directions: ["maps"],
  places: ["maps"],
  ride: ["uber"],
  hotels: ["booking"],
  shopping: ["shopping"],
  play: ["play"],
  "video-search": ["youtube"],
};

/**
 * The automation hubs that can stand in for a job, used only when the person
 * has connected no app that does it directly. Make, Composio and Pipedream
 * run what the person built in them, which Tailzu cannot see: only by name.
 */
export const JOB_HUBS: Readonly<Partial<Record<Job, readonly string[]>>> = {
  calendar: ["zapier"],
  sheets: ["zapier"],
};

export const doesJob = (id: string, job: Job) => JOB_APPS[job].includes(id) || !!JOB_HUBS[job]?.includes(id);

/** Every id some job names: a catalog app or a hand-off the router knows. */
export const KNOWN_IDS: ReadonlySet<string> = new Set([...Object.values(JOB_APPS).flat(), ...Object.values(JOB_HUBS).flat(), ...NAMED_IDS]);

/** The verb a second command starts with. */
const NEXT = "(?:also |then |please |pls )?(?:block|add|put|schedule|reschedule|email|mail|message|msg|text|tell|let|ask|inform|notify|call|ring|pay|send|book|create|make|remind|set|move|push|shift|cancel|delete|play|post|share|note|jot|whatsapp|ping|invite)\\b";
/**
 * Where a second command starts: "and" (or "aur", "then") before its verb,
 * a comma before its verb ("move the standup to 10, let the team know"), or
 * "aur" before who a Hinglish one is for ("... shift kar do aur Rohit ko bata do").
 */
const AND_THEN = new RegExp(`\\s+(?:and then|and|then|aur|phir|fir)\\s+(?=${NEXT})|\\s+aur\\s+(?=[a-z]+ (?:ko|se)\\b)|,\\s*(?=${NEXT})`);

function readClauses(line: string, own: readonly OwnApp[]): Intent & { weak?: boolean } {
  const t = normalize(line);
  const parts = t.split(AND_THEN).filter(Boolean);
  if (parts.length < 2) return readLine(t, own);
  const first = readLine(parts[0]!, own);
  // A first part that asks for nothing ("on slack, tell Arjun...", "Rahul aur Priya ko..."): one request.
  if (!first.job) return readLine(t, own);
  const more: Intent[] = [];
  for (const p of parts.slice(1)) {
    const i = readLine(p, own);
    // After "remind me to..." or "note this...", the rest is what to remember, unless it names where it goes.
    const where = i.named.length > 0 || /\bcalendar\b/.test(p);
    // A second job, an app named, or the same job with another verb ("cancel my 3pm and put a call at 5").
    if ((i.job || i.named.length) && (!wrapper(parts[0]!) || where) && (i.job !== first.job || i.named.length || (i.verb && i.verb !== first.verb))) more.push(i);
  }
  if (!more.length) return readLine(t, own);
  return { ...first, more };
}

/**
 * The intent of everything said in this ask, a line per turn (the phone sends
 * the whole ask). The last line decides; a follow-up that names no job of its
 * own ("on the 1st", "make it 5", "her email is priya@acme.com") goes on with
 * the job said before it, with its own verb when it has one ("cancel the 3pm
 * one" after "what's on tomorrow").
 */
export function readIntent(said: string, own: readonly OwnApp[] = []): Intent {
  const lines = said.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { job: null, verb: null, named: [], guarded: false };
  const per = lines.map((l) => readClauses(l, own));
  const last = per[per.length - 1]!;
  if (per.length === 1 || (last.job && !last.weak) || last.named.length || (last.guarded && !last.weak)) return strip(last);
  for (let i = per.length - 2; i >= 0; i--) {
    const before = per[i]!;
    if (!before.job && !before.named.length) continue;
    const verb = last.verb ?? before.verb;
    return strip({ ...before, verb, guarded: false, ...(last.verb && last.verb !== before.verb ? { tool: undefined } : {}) });
  }
  return strip(last);
}

function strip(i: Intent): Intent {
  const { weak: _weak, ...rest } = i as Intent & { weak?: boolean };
  const out: Intent = { ...rest };
  if (out.tool === undefined) delete out.tool;
  if (out.more) out.more = out.more.map(strip);
  return out;
}
