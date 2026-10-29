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
    },

    // How a row's time is written: "relative" (the widget counts: "4 min"), "clock" (the widget writes the time: "6:30 pm"), or
    // "server" (the words below, as of the fetch).
    "widgets.time": "relative",

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

    // THE LOOK: the widgets' ink (today's, as the Month draws it), the buttons' styles, and each kind's symbol, drawable and colour
    // (no colour: the ink).
    "widgets.look": {
      colors: { ground: "#0F0D0B", pale: "#F3E2C6", mark: "#F3E2C6", accent: "#F3E2C6" },
      alpha: { dim: 0.52, rule: 0.13 },
      styles: {
        primary: { fg: "#0F0D0B", bg: "#F3E2C6" },
        secondary: { fg: "#F3E2C6", bg: "#F3E2C621" },
        destructive: { fg: "#FFB4A8", bg: "#FFB4A821" },
      },
      kinds: {
        message: { icon: "bubble.left.fill", androidIcon: "tailzu_wi_chat" },
        shared: { icon: "square.and.arrow.up", androidIcon: "tailzu_wi_share" },
        task: { icon: "checkmark.circle", androidIcon: "tailzu_wi_task" },
        plan: { icon: "calendar", androidIcon: "tailzu_wi_plan" },
        question: { icon: "questionmark.bubble", androidIcon: "tailzu_wi_bot" },
        approval: { icon: "hand.raised", androidIcon: "tailzu_wi_bot" },
      },
      people: { icon: "person.2.fill", androidIcon: "tailzu_wi_spaces" },
      needs: { icon: "exclamationmark.bubble", androidIcon: "tailzu_wi_bot" },
    },
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
    "widgets.people.tag.shared": "",
    "widgets.people.tag.message": "",

    "widgets.needs.title": "Needs you",
    "widgets.needs.lock": "{n} things need you",
    "widgets.needs.lockOne": "1 thing needs you",
    "widgets.needs.lockNone": "Nothing needs you",
    "widgets.needs.empty.title": "All clear",
    "widgets.needs.empty.body": "Nothing needs you right now.",
    "widgets.needs.empty.cta": "Open X0 Bot",
    "widgets.needs.from": "From {name}",
    "widgets.needs.done": "Done",
    "widgets.needs.sent": "Sent",
    "widgets.needs.working": "Sending…",
    "widgets.needs.failed": "Open X0 Bot to finish",
    "widgets.needs.gone": "Already answered",

    // Who a bot's row is from (a connected app's yes belongs to the built-in whose skills name the app, else X0 itself).
    "widgets.who.code": "Code bot",
    "widgets.who.plan": "Plan bot",
    "widgets.who.travel": "Travel bot",
    "widgets.who.tailzu": "X0",

    "widgets.action.yes": "Yes",
    "widgets.action.no": "No",
    "widgets.action.done": "Done",
    "widgets.action.open": "Open",

    "widgets.time.now": "now",
    "widgets.time.min": "{n}m",
    "widgets.time.hour": "{n}h",
    "widgets.time.day": "{n}d",
  },
};
