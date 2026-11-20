/**
 * THE ACTIVITIES TAB, as the boards' day has it (Aanya, Tuesday 28 October): what the render check draws
 * (docs/talk-door.md, screens/bots/activities.ts).
 *
 * Written to show the one thing the screen exists for — that a piece of work can have MORE THAN ONE bot on it, drawn
 * joined — alongside the shapes that only have one: a job running on its own, a missed call, a finished thing.
 */
const N = Date.UTC(2026, 9, 28, 9, 12);
const H = 3_600_000;

const TRAVEL = { slug: "travel", name: "Travel bot", color: "#3f7d8c" };
const PLAN = { slug: "plan", name: "Plan Ease", color: "#b08a3e" };
const CODE = { slug: "code", name: "Xode", color: "#5f7d4f" };
const MAIL = { slug: "mail", name: "Mail", color: "#b89b72" };
const X0 = { slug: "tailzu", name: "X0", color: "#0a0a0a" };

export const ACTIVITIES_API: Record<string, unknown> = {
  "GET /v1/botsapp/activities": {
    schedules: [
      { id: "r1", bot: X0, task: "Sum up my week", when: "Every Friday at 5 pm", next: "Fri 30 Oct at 5 pm", paused: false },
      { id: "r2", bot: MAIL, task: "File what came in overnight", when: "Every day at 7 am", next: "Tomorrow at 7 am", paused: false },
    ],
    now: [
      // TWO BOTS ON ONE PIECE OF WORK: the whole reason this screen is not a list of events.
      {
        id: "s:1", title: "Three days in Goa", line: "1 thing needs your yes · Found what you asked for",
        bots: [TRAVEL, PLAN], state: "needs", at: N - H,
        open: { screenId: "bots.travel" },
      },
      {
        id: "s:2", title: "Cart rounds 99.5 down", line: "3 of 7 done · writing the tests",
        bots: [CODE], state: "working", at: N - 2 * H,
        open: { screenId: "bots.code.job", params: { id: "job-cart-rounding" } },
      },
      {
        id: "r:call:c1", title: "Missed call from X0", line: "Leave by 10:20 for Riya's mehendi",
        bots: [PLAN], state: "needs", at: N - 5 * H,
      },
    ],
    done: [
      { id: "s:3", title: "Reply to the caterer", line: "Sent · and filed under Wedding", bots: [MAIL, X0], state: "done", at: N - 20 * H },
      { id: "r:job:j2", title: "Add slot times to the booking page", line: "Opened a pull request", bots: [CODE], state: "done", at: N - 30 * H },
      { id: "s:4", title: "Salon on Saturday", line: "On your calendar", bots: [PLAN], state: "done", at: N - 40 * H },
    ],
  },
};

/** Nothing on yet: what a new account's second tab says. */
export const ACTIVITIES_EMPTY_API: Record<string, unknown> = {
  "GET /v1/botsapp/activities": { schedules: [], now: [], done: [] },
};
