/**
 * TALK'S THREAD, as the boards' day has it (Aanya, Tuesday 28 October): the sample the render check draws
 * (docs/talk-door.md, screens/bots/talkDoor.ts).
 *
 * It is written to show the ONE thing the screen exists to show — that every kind of answer lands in one conversation,
 * from a different bot each time, in whatever shape that answer needs:
 *
 *   Nudj   words, and the day drawn as steps under them (src/show: the bot chose the blocks itself)
 *   Travel      words, and what the everyday tools found as cards (`did.finds`)
 *   Xode        no words at all — a job started IS the answer, and its card is the turn
 *   X0          a routine to save, which is a card and not an answer
 *   Nudj   a message that was for Mom ("@"), and a choice to tap
 *
 * Every turn carries `by`, because a thread that every bot answers in has to say which one did.
 */

const DAY = 86_400_000;
/** The boards' day, as the other samples use it (fixtures.ts FIXED_NOW). */
const N = Date.UTC(2026, 9, 28, 9, 12) + 0;

const TALK_BOT = { slug: "talk", name: "Talk", color: "#6b7280" };
const PLAN = { slug: "plan", name: "Nudj", color: "#b08a3e" };
const TRAVEL = { slug: "travel", name: "Nomaz", color: "#3f7d8c" };
const CODE = { slug: "code", name: "Xode", color: "#5f7d4f" };

/** The id a turn's drawing keeps its picks under (show/check.ts gives each one k0, k1…). */
const K0 = "k0";

/**
 * A routine's sealed draft, exactly as the door makes one (routines/service.ts openDraft: base64url JSON, no secret in
 * it — it carries only what the person said, and nothing is kept until they tap Save).
 */
const routineToken = (task: string, s: { every: string; minute: number; days?: number[] }, bot: string | null): string =>
  Buffer.from(JSON.stringify({ t: task, s, z: 330, ...(bot ? { b: bot } : {}) }), "utf8").toString("base64url");
/** "Sum up my week every Friday at 5": Friday (5) at 17:00 (1020 minutes after midnight). */
const WEEKLY = routineToken("Sum up my week", { every: "week", minute: 17 * 60, days: [5] }, "talk");

export const TALK_FINDS = "finds-goa-1";
export const TALK_JOB = "job-cart-rounding";

const turns = [
  { id: "t1", role: "me", text: "What's on tomorrow?", at: N - 3 * DAY, opens: [], approvals: [], paise: 0 },
  {
    id: "t2", role: "bot", at: N - 3 * DAY + 1, opens: [], approvals: [], paise: 11, by: PLAN,
    text: "Three things, and one of them needs leaving early.",
    show: {
      lists: "drawn",
      blocks: [
        { type: "steps", items: [
          { title: "Riya's mehendi, 11 am", note: "Leave by 10:20 — 35 min with traffic", state: "now" },
          { title: "Salon, 1 pm", note: "Indiranagar", state: "next" },
          { title: "Call the caterer", note: "Before 6 pm", state: "next" },
        ] },
      ],
    },
  },
  { id: "t3", role: "me", text: "/travel three days in Goa next month", at: N - 2 * DAY, opens: [], approvals: [], paise: 0 },
  {
    id: "t4", role: "bot", at: N - 2 * DAY + 1, opens: [], approvals: [], paise: 34, by: TRAVEL,
    text: "Mid-December is the cheapest week. Flights and two places to stay, below.",
    did: { finds: TALK_FINDS },
  },
  { id: "t5", role: "me", text: "the cart rounds 99.5 down, fix it", at: N - DAY, opens: [], approvals: [], paise: 0 },
  // NO WORDS: the job IS the answer, and its card is this turn (chat.ts keepDoor keeps a turn with nothing but a card).
  { id: "t6", role: "bot", text: "", at: N - DAY + 1, opens: [], approvals: [], paise: 6, by: CODE, did: { job: TALK_JOB } },
  { id: "t7", role: "me", text: "sum up my week every Friday at 5", at: N - 3600_000, opens: [], approvals: [], paise: 0 },
  {
    id: "t8", role: "bot", at: N - 3600_000 + 1, opens: [], approvals: [], paise: 0, by: TALK_BOT,
    text: "Every Friday at 5 pm: sum up my week. Save it as a routine?",
    // A routine is a card to save and not an answer; the sealed draft rides on the turn so the card is still there when
    // the thread is drawn again (the door makes it with no model call: docs/front-door.md).
    did: { routine: JSON.stringify({ token: WEEKLY }) },
  },
  // "@Mom": the person it was for is on the person's own turn, and the bot was told.
  { id: "t9", role: "me", text: "ask about the caterer's advance", at: N - 600_000, opens: [], approvals: [], paise: 0, forName: "Mom" },
  {
    id: "t10", role: "bot", at: N - 600_000 + 1, opens: [], approvals: [], paise: 9, by: PLAN,
    text: "I can put it to her as a task, or send it as a message. Which?",
    show: {
      blocks: [
        { type: "choice", key: K0, question: "How should it go to Mom?", multi: false, send: "Send", options: [
          { label: "As a task on her day" }, { label: "As a message now" },
        ] },
      ],
    },
  },
];

/** Who "@" offers: the people Aanya shares a space with (docs/spaces.md personLook.ts). */
const people = [
  { id: "u-mom", name: "Mom", bot: { seed: "u-mom", avatar: "bot-2", color: "#8a6bb1" } },
  { id: "u-riya", name: "Riya", bot: { seed: "u-riya", avatar: "bot-5", color: "#b5654a" } },
];

/** What the everyday tools found for the Goa answer (GET /v1/everyday/finds/:id, src/everyday/types.ts FlightsCard). */
const leg = (depart: string, arrive: string, minutes: number, airline: string) => ({
  from: "BLR", to: "GOI", fromCity: "Bengaluru", toCity: "Goa", depart, arrive, minutes, stops: 0, route: ["BLR", "GOI"], airlines: [airline],
});
const finds = {
  cards: [
    {
      kind: "flights", query: "Bengaluru to Goa, 11–14 December", currency: "INR",
      source: { name: "Kiwi.com", url: "https://www.kiwi.com" },
      results: [
        {
          price: 3480, priceText: "₹3,480", cabin: "Economy", bags: { cabin: 1, checked: 0 }, url: "https://www.kiwi.com",
          out: leg("2026-12-11T06:10:00", "2026-12-11T07:20:00", 70, "IndiGo"),
          back: leg("2026-12-14T19:40:00", "2026-12-14T20:55:00", 75, "IndiGo"),
        },
        {
          price: 3910, priceText: "₹3,910", cabin: "Economy", bags: { cabin: 1, checked: 1 }, url: "https://www.kiwi.com",
          out: leg("2026-12-11T09:45:00", "2026-12-11T10:55:00", 70, "Akasa Air"),
        },
      ],
    },
  ],
};

export const TALK_API: Record<string, unknown> = {
  "GET /v1/botsapp/talk?limit=40": { turns, session: "s-talk-1", people, commands: [{ name: "new", line: "Start a new thread" }] },
  [`GET /v1/everyday/finds/${TALK_FINDS}`]: finds,
};

/**
 * TALK'S CONVERSATIONS (screens/bots/talkThreads.ts): what the head's balloons open. The newest is the one Talk is in;
 * the others are put down and pickable up, which is the whole reason the screen exists.
 */
export const TALK_THREADS_API: Record<string, unknown> = {
  "GET /v1/botsapp/bots/sessions/talk": {
    sessions: [
      { id: "s-talk-1", title: "Three days in Goa", frame: null, startedAt: N - 2 * 3600_000, touchedAt: N - 20 * 60_000 },
      { id: "s-talk-2", title: "Riya's mehendi — what to send", frame: null, startedAt: N - 30 * 3600_000, touchedAt: N - 26 * 3600_000 },
      { id: "s-talk-3", title: "The caterer's advance", frame: null, startedAt: N - 4 * DAY, touchedAt: N - 4 * DAY },
      { id: "s-talk-4", title: "Cart rounds 99.5 down", frame: null, startedAt: N - 9 * DAY, touchedAt: N - 8 * DAY },
    ],
  },
};

/** An empty thread: the starters, the two marks, and nothing else — what a new account opens the app on. */
export const TALK_EMPTY_API: Record<string, unknown> = {
  "GET /v1/botsapp/talk?limit=40": { turns: [], session: null, people, commands: [{ name: "new", line: "Start a new thread" }] },
};

/** The first visit: the welcome is due, so the bot says hello on the empty thread before the box draws in around him. */
export const TALK_WELCOME_API: Record<string, unknown> = {
  ...TALK_EMPTY_API,
  "GET /v1/bots/first-run/arrival": { due: true, kind: "first" },
  "GET /v1/you/ai-consent": { agreed: true, asked: true },
};
