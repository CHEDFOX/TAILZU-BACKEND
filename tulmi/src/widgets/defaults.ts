/**
 * QUICK ACCESS FROM OUTSIDE THE APP: what the server would send with no rules at all.
 *
 * Two Home Screen and Lock Screen widgets (iOS WidgetKit, Android home widgets) draw what GET /v1/widgets/now answers:
 *
 *   From your people   the latest few things from family and friends: shared, given to you, said to you
 *   Needs you          a bot's question with its answers, a yes it waits for, a task given to you, each with its buttons
 *
 * Everything they show is decided here and sent with the rows, already worded: which widgets and sections are on, which kinds
 * of row and in what order, how many rows each size shows, every label and empty line and where its button goes, the colours,
 * the SF Symbol and Android drawable per kind, how a time is written, the Lock Screen's wording, how often to ask again, which
 * buttons a kind of row has (their labels, order and styles) and whether each answers in place (the widget's own narrow token,
 * src/widgets/token.ts) or opens the app. The native code keeps today's values only as fallbacks for a phone that has not
 * fetched yet; a new kind of row or button is data here, not an app update.
 *
 * The control plane's "widgets" surface edits this object per person (platform, language, named users, a share, a date window,
 * an experiment) before a request reads it; removing the rule restores it. Kept free of imports so the console can preview it.
 *
 * The notification side (which push kind gets which category, push.<kind>.category) is the push engine's (push/defaults.ts);
 * the categories' buttons and the Home Screen quick actions are the app's bootstrap knobs (push.categories, app.quickActions.*).
 */
export interface WidgetsPayload {
  flags: Record<string, unknown>;
  labels: Record<string, string>;
}

/** A line in English and Hinglish: the key holds the English, key + ".hg" the Hinglish. */
const both = (key: string, en: string, hg: string): Record<string, string> => ({ [key]: en, [`${key}.hg`]: hg });

/**
 * The X0 widget's words (docs/widget-glance-v2.md): what the widget draws (x0.word.*), a bot's fill-in line when it gave none (x0.fill.*,
 * slots {bot} {task}), the week, the Lock Screen's lines, and the situation lines (x0.sit.<situation>.<part>; part is morning, afternoon,
 * evening, night or "any", the fallback; slots {name} {bot} {task} {n}).
 */
const X0_LABELS: Record<string, string> = {
  ...both("x0.word.needsYou", "Needs you", "Aapki zaroorat"),
  ...both("x0.word.ready", "Ready", "Taiyaar"),
  ...both("x0.word.ask", "Ask any bot…", "Kisi bhi bot se poocho…"),
  ...both("x0.word.brand", "X0", "X0"),
  ...both("x0.word.youDecide", "You decide", "Aap tay karo"),
  ...both("x0.word.working", "{n} working", "{n} kaam par"),
  ...both("x0.word.step", "Step {stage} of {of}", "Step {stage} / {of}"),
  ...both("x0.word.minIn", "{n} min in", "{n} min ho gaye"),
  ...both("x0.word.seePr", "See the PR", "PR dekho"),
  ...both("x0.word.done", "Done", "Ho gaya"),
  ...both("x0.word.answered", "Answered", "Jawab de diya"),
  ...both("x0.word.finish", "Open X0 to finish", "Poora karne ke liye X0 kholo"),
  ...both("x0.word.doneSeePr", "Done · See the PR", "Ho gaya · PR dekho"),
  ...both("x0.word.min", "{n} min", "{n} min"),
  ...both("x0.word.pr", "PR #{n}", "PR #{n}"),
  ...both("x0.word.sending", "Sending…", "Bhej rahe hain…"),
  ...both("x0.word.gone", "Already answered", "Jawab pehle hi de diya"),
  ...both("x0.word.failed", "Open X0 to finish", "Poora karne ke liye X0 kholo"),

  ...both("x0.fill.needs", "{bot} needs you", "{bot} ko aapki zaroorat hai"),
  ...both("x0.fill.working", "{bot} is working", "{bot} kaam kar raha hai"),
  ...both("x0.fill.done", "{bot} finished {task}", "{bot} ne {task} poora kiya"),
  ...both("x0.fill.failed", "{bot} hit a snag", "{bot} atak gaya"),
  ...both("x0.fill.idle", "Ready", "Taiyaar"),
  ...both("x0.choice.yes", "Yes", "Haan"),
  ...both("x0.choice.no", "No", "Nahi"),

  ...both("x0.week.many", "{n} things done this week", "Is hafte {n} kaam ho gaye"),
  ...both("x0.week.one", "1 thing done this week", "Is hafte 1 kaam hua"),
  ...both("x0.week.none", "A fresh week", "Naya hafta"),
  ...both("x0.week.savedH", "{n} h saved", "{n} ghante bache"),
  ...both("x0.week.savedMin", "{n} min saved", "{n} min bache"),

  ...both("x0.lock.needsMany", "{n} things need you", "{n} cheezon mein aapki zaroorat"),
  ...both("x0.lock.answer", "Open X0 to answer", "Jawab ke liye X0 kholo"),
  ...both("x0.lock.pr", "PR #{n} is ready", "PR #{n} taiyaar hai"),
  ...both("x0.lock.workingMany", "{n} bots working", "{n} bots kaam par"),

  ...both("x0.sit.firstLook.morning", "A fresh day. Your bots are ready.", "Naya din. Aapke bots taiyaar hain."),
  ...both("x0.sit.firstLook.afternoon", "Here's where your bots are.", "Dekho aapke bots kahan tak pahunche."),
  ...both("x0.sit.firstLook.evening", "Here's how your day went.", "Dekho aaj ka din kaisa raha."),
  ...both("x0.sit.firstLook.night", "All quiet. Your bots kept watch.", "Sab shaant hai. Bots ne dhyaan rakha."),
  ...both("x0.sit.moved.any", "{n} things moved since you last looked", "Pichhli baar ke baad {n} cheezein badlin"),
  ...both("x0.sit.moved.night", "{n} things moved while you were away", "Aapke peeche {n} cheezein badlin"),
  ...both("x0.sit.justFinished.any", "{bot} just finished: {task}", "{bot} ne abhi poora kiya: {task}"),
  ...both("x0.sit.justFinished.evening", "{bot} wrapped up: {task}", "{bot} ne nipta diya: {task}"),
  ...both("x0.sit.severalWorking.any", "{n} bots are on it", "{n} bots kaam par lage hain"),
  ...both("x0.sit.severalWorking.night", "{n} bots are working while you rest", "Aap aaram karo, {n} bots kaam par hain"),
  ...both("x0.sit.longJob.any", "{bot} is deep in {task}", "{bot} {task} mein laga hai"),
  ...both("x0.sit.quietLong.any", "Quiet for a while, {name}. Ask anything.", "Kaafi shaanti hai, {name}. Kuch bhi poocho."),
  ...both("x0.sit.quietLong.morning", "A quiet start, {name}. Start something new?", "Shaant subah, {name}. Kuch naya shuru karein?"),
  ...both("x0.sit.weekend.any", "It's the weekend. Your bots are here.", "Weekend hai. Aapke bots yahin hain."),
  ...both("x0.sit.weekend.morning", "Weekend morning. Take it easy.", "Weekend ki subah. Aaraam se."),
};

/** The shape version of GET /v1/widgets/now. A field is only ever added; a change of meaning raises it. */
export const WIDGETS_VERSION = 1;

export const WIDGETS_DEFAULTS: WidgetsPayload = {
  flags: {
    // The kill switches: the whole endpoint, each widget, and answering in place (off: every button opens the app).
    "widgets.enabled": true,
    "widgets.people.enabled": true,
    "widgets.needs.enabled": true,
    "widgets.token.enabled": true,

    // How long a widget's own token lives (it can only answer this person's own needs-you and tick their own tasks), and how many
    // phones may hold one at a time (the oldest is revoked past it). The app asks for a new one well before it runs out.
    "widgets.token.ttlMin": 1440,
    "widgets.token.maxPerUser": 5,
    // The app asks again once this share of a token's life has gone.
    "widgets.token.renewAt": 0.5,

    // How often the widget asks for a new timeline on its own (the app also redraws it every time it fetches), and how often the
    // app may fetch (on launch, on coming to the front, after a push, after an answer).
    "widgets.refreshSec": 900,
    "widgets.fetchSec": 60,

    // Where a row's tap goes: the base and each kind's screen ({…} filled from the row). tulmi:// opens the app straight away;
    // https://app.x0bot.com/s/ (the app's own links) works too.
    "widgets.link.base": "tulmi://screen/",
    "widgets.links": {
      message: "bots.thread?id={threadId}",
      shared: "bots.space.item?item={itemId}",
      task: "bots.space.tasks?id={spaceId}",
      plan: "bots.space.tasks?id={spaceId}",
      question: "bots.code.job?id={jobId}",
      approval: "bots.approve?task={taskId}",
      people: "bots.spaces",
      needs: "bots.tasks",
      peopleEmpty: "bots.spaces",
      needsEmpty: "bots.home",
      // The X0 widget (glance v2): a built-in bot's page, a person's own bot's page, Activity.
      botBuiltin: "bots.{slug}",
      bot: "bots.bot?slug={slug}",
      activity: "bots.activity",
    },

    // How a row's time is written: "minutes" (the widget counts in whole minutes, hours, days, in the widgets.time.* words sent
    // as the answer's timeWords: "now", "4m", never seconds), "relative" (the widget counts in the phone's own words; an iOS build
    // before minutes ticks the seconds), "clock" (the widget writes the time: "6:30 pm"), or "server" (the words below, as of the
    // fetch). A build that does not know a style writes the server's words.
    "widgets.time": "minutes",

    // FROM YOUR PEOPLE. The kinds of row, in the order they win when "sort" is "kind" ("time": newest first, whatever the kind).
    "widgets.people.kinds": ["message", "task", "plan", "shared"],
    "widgets.people.sort": "time",
    // Rows sent at most, and rows each size draws (lock: the Lock Screen's, which by default shows the count line only).
    "widgets.people.max": 8,
    "widgets.people.limits": { small: 2, medium: 3, large: 6, lock: 0, android: 4 },
    // Nothing older than this many days; "new" is this many hours (a message still unread is new whatever its age).
    "widgets.people.windowDays": 14,
    "widgets.people.newHours": 24,
    // A message's words on the Home Screen widget (never on the Lock Screen; iOS redacts them while locked). Off: "Sam sent a message".
    "widgets.people.messageText": true,
    // The kinds whose words are private: drawn on an unlocked Home Screen, redacted while the phone is locked (StandBy, Always-On).
    "widgets.people.private": ["message"],
    // A muted chat's messages.
    "widgets.people.includeMuted": false,
    // How many chats are looked into for their newest message.
    "widgets.people.chats": 8,

    // NEEDS YOU. The kinds of row and their order, the rows each size draws, the buttons each kind has and how each answers.
    "widgets.needs.kinds": ["question", "approval", "task", "plan"],
    "widgets.needs.sort": "kind",
    "widgets.needs.max": 6,
    // Needs you's words are private whatever the kind (a question can say a lot): redacted while the phone is locked.
    "widgets.needs.private": ["question", "approval", "task", "plan"],
    "widgets.needs.limits": { small: 1, medium: 2, large: 4, lock: 0, android: 3 },
    // A bot's question shows at most this many of its answers as buttons (more: the row opens the app).
    "widgets.needs.optionsMax": 2,
    // A yes a connected app waits for answers in place only at these risks (connectors/risk.ts); "destructive" and "pay" open the
    // app. The same rule holds for a notification's buttons.
    "widgets.needs.inPlaceRisks": ["read", "write", "send"],
    // Per kind: the buttons, in order. `id` is what POST /v1/widgets/act is sent; `label` a literal, else the label
    // widgets.action.<id>, else (a0, a1…) the question's own answer; `style` primary | secondary | destructive; `icon` an SF
    // Symbol, `androidIcon` a drawable.
    "widgets.needs.actions": {
      question: [{ id: "a0", style: "primary" }, { id: "a1", style: "secondary" }],
      approval: [{ id: "yes", style: "primary" }, { id: "no", style: "secondary" }],
      task: [{ id: "done", style: "primary", icon: "checkmark", androidIcon: "tailzu_wi_check" }],
      plan: [{ id: "done", style: "primary", icon: "checkmark", androidIcon: "tailzu_wi_check" }],
    },
    // Per kind: "inPlace" (the widget answers with its own token, the app stays shut) or "open" (the button opens the row in the app).
    "widgets.needs.modes": { question: "inPlace", approval: "inPlace", task: "inPlace", plan: "inPlace" },

    // Where a button posts.
    "widgets.act.path": "/v1/widgets/act",

    // THE LOOK: the app's own palette (experience/bots/palette.ts), by role, for each theme: `colors` the dark one, `light` the
    // light one (pale is the ink; meta a label's grey; line the hairlines, a border; surface an avatar's disc). The buttons'
    // styles, dark and light: a primary one ink-filled with the ground's words, a secondary one a line-grey ring with ink words
    // (colour belongs to bots alone, so nothing here is red or green). Each kind's symbol and drawable, and a colour only if a
    // rule gives one (no colour: the ink). The mark (tailzu_widget_mark) is the app icon's bot. The Android widgets read all of
    // it; the iOS widgets from this release draw the same palette natively, and older builds of both read colors and styles.
    "widgets.look": {
      colors: { ground: "#0A0A0A", pale: "#FFFFFF", mark: "#FFFFFF", accent: "#FFFFFF", meta: "#A3A3A3", line: "#262626", surface: "#171717" },
      light: { ground: "#FFFFFF", pale: "#0A0A0A", mark: "#0A0A0A", accent: "#0A0A0A", meta: "#5C5C5C", line: "#E6E6E6", surface: "#F5F5F5" },
      alpha: { dim: 0.64, rule: 0.15 },
      styles: {
        primary: { fg: "#0A0A0A", bg: "#FFFFFF" },
        secondary: { fg: "#FFFFFF", bg: "#00000000", border: "#262626" },
        destructive: { fg: "#FFFFFF", bg: "#00000000", border: "#262626" },
      },
      lightStyles: {
        primary: { fg: "#FFFFFF", bg: "#0A0A0A" },
        secondary: { fg: "#0A0A0A", bg: "#00000000", border: "#E6E6E6" },
        destructive: { fg: "#0A0A0A", bg: "#00000000", border: "#E6E6E6" },
      },
      kinds: {
        message: { icon: "bubble.left.fill", androidIcon: "tailzu_wi_chat" },
        shared: { icon: "square.and.arrow.up", androidIcon: "tailzu_wi_share" },
        task: { icon: "checkmark.circle", androidIcon: "tailzu_wi_task" },
        plan: { icon: "calendar", androidIcon: "tailzu_wi_plan" },
        question: { icon: "questionmark.bubble", androidIcon: "tailzu_widget_mark" },
        approval: { icon: "hand.raised", androidIcon: "tailzu_widget_mark" },
      },
      people: { icon: "person.2.fill", androidIcon: "tailzu_widget_mark" },
      needs: { icon: "exclamationmark.bubble", androidIcon: "tailzu_widget_mark" },
    },

    // THE X0 WIDGET (GET /v1/shell/glance?v=2, src/widgets/glance.ts; docs/widget-glance-v2.md). Off: the route answers the quiet case.
    "x0.enabled": true,
    // Bots sent at most (the rest is `more`), and what needs the person (oldest first) with up to this many answers as buttons.
    "x0.bots.max": 8,
    "x0.needs.max": 3,
    "x0.needs.choicesMax": 3,
    // Kinds whose words never show on a locked phone (a bot also marks a question private itself). A connected app's yes says personal
    // things (an event, a message); a Code bot's question is about code.
    "x0.needs.private": ["approval"],
    // A finished job is "the last thing done" for this long after it ended, until the person opens it.
    "x0.done.windowMin": 120,
    // The widget's next useful refresh: sooner while a bot is working.
    "x0.refreshSec": 900,
    "x0.refreshSec.working": 300,
    // Fetches closer together than this are one look (the summary's "since you last looked" stays put while the app refreshes).
    "x0.lookGapMin": 10,
    "x0.links": { ask: "tulmi://screen/bots.ask", home: "tulmi://", mic: "tulmi://screen/bots.ask?voice=1" },
    // The situation lines (situation.ts): a job is long past this many minutes; quiet is this many days with nothing; things moved
    // counts from this many.
    "x0.situation.longJobMin": 30,
    "x0.situation.quietDays": 3,
    "x0.situation.movedMin": 2,
    // The AI digest (WIDGET_DIGEST on the server, digest.ts): from this many changes, waited for this long before the situation line
    // is sent instead (the line is still written, for the next fetch), at most this many paise a line.
    "x0.digest.min": 3,
    "x0.digest.waitMs": 2500,
    "x0.digest.maxPaise": 5,
  },
  labels: {
    "widgets.people.title": "From your people",
    "widgets.people.lock": "{n} new from your people",
    "widgets.people.lockOne": "1 new from your people",
    "widgets.people.lockNone": "Nothing new from your people",
    "widgets.people.empty.title": "Your people, here",
    "widgets.people.empty.body": "Make a space for family and friends. What they share shows up here.",
    "widgets.people.empty.cta": "Make a space",
    "widgets.people.line.shared": "{name} shared {title}",
    "widgets.people.line.task": "{name}: {title}",
    "widgets.people.line.plan": "{name}: {title}",
    "widgets.people.line.message": "{name}: {text}",
    "widgets.people.line.messageHidden": "{name} sent a message",
    "widgets.people.tag.task": "task",
    "widgets.people.tag.plan": "plan",
    // The kind's word after the name. Shared says so: a row drawn as its name, tag and title reads "Riya shared · Weekend plan".
    "widgets.people.tag.shared": "shared",
    "widgets.people.tag.message": "",

    "widgets.needs.title": "Needs you",
    "widgets.needs.lock": "{n} things need you",
    "widgets.needs.lockOne": "1 thing needs you",
    "widgets.needs.lockNone": "Nothing needs you",
    "widgets.needs.empty.title": "All clear",
    "widgets.needs.empty.body": "Nothing needs you right now.",
    "widgets.needs.empty.cta": "Open X0",
    "widgets.needs.done": "Done",
    "widgets.needs.sent": "Sent",
    "widgets.needs.working": "Sending…",
    "widgets.needs.failed": "Open X0 to finish",
    "widgets.needs.gone": "Already answered",
    // A row's one button when its answers do not fit (the small widget): it opens the row.
    "widgets.needs.answer": "Answer",

    // Who a bot's row is from (a connected app's yes belongs to the built-in whose skills name the app, else X0 itself).
    "widgets.who.code": "Code bot",
    "widgets.who.plan": "Plan bot",
    "widgets.who.travel": "Travel bot",
    "widgets.who.tailzu": "X0",

    "widgets.action.yes": "Yes",
    "widgets.action.no": "No",
    "widgets.action.done": "Done",
    "widgets.action.open": "Open",

    // A time, as the server writes it ("server") and as the widgets count it ("minutes", sent as timeWords).
    "widgets.time.now": "now",
    "widgets.time.min": "{n}m",
    "widgets.time.hour": "{n}h",
    "widgets.time.day": "{n}d",

    // THE X0 WIDGET'S WORDS, English and (".hg") Hinglish, chosen by the app's language.
    ...X0_LABELS,
  },
};
