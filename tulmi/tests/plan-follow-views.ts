/**
 * Follow pages as GET /v1/botsapp/bots/plan/follow/:id answers them (botsBots/planFollow.ts FollowView), for the screen tests: the asker's
 * view of Mom's 9 pm medicine (told: every step), Mom holding Priya's 8 pm pickup on its second climb (the one-time Allow card), and Dad,
 * next on it, once told.
 */
import type { FollowView } from "../src/botsBots/planFollow.js";

const MIN = 60_000;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const MOM = "u:bbbbbbbb-0000-4000-8000-000000000002" as const;
const DAD = "u:cccccccc-0000-4000-8000-000000000003" as const;
const ME = "u:aaaaaaaa-0000-4000-8000-000000000001" as const;
const buttons = (o: Partial<FollowView["buttons"]> = {}): FollowView["buttons"] => ({ done: true, later: [], cant: false, take: false, undone: false, call: null, message: null, ...o });

const asker: FollowView = {
  id: "eeeeeeee-0000-4000-8000-0000000000a1", item: "pt:5e1f0c2e-1111-4222-8333-944445555777", kind: "todo", title: "Mom's evening medicine", when: "9 pm",
  must: true, why: "medicine", state: "told", you: "asker", n: 1, asker: { name: "You", me: true },
  holder: { key: MOM, name: "Mom", me: false, how: "app" },
  people: [{ key: MOM, name: "Mom", me: false, how: "app", cant: false }, { key: DAD, name: "Dad", me: false, how: "gone", cant: false }],
  steps: [{ at: ist(12, 21), line: "9 pm · Mom · Notification · opened 9:02 pm" }, { at: ist(12, 21, 20), line: "9:20 pm · You · Told · sent" }],
  answers: [], next: null, done: null,
  buttons: buttons({ take: true, call: { number: "+919876543210", name: "Mom" }, message: { userId: MOM.slice(2), name: "Mom" } }), ask: null,
};
const holder: FollowView = {
  id: "eeeeeeee-0000-4000-8000-0000000000a2", item: "stask:s1:t1", kind: "ask", title: "Pick Kabir up from school", when: "8 pm", must: true, why: "pickup",
  state: "open", you: "holder", n: 2, asker: { name: "Priya", me: false }, holder: { key: ME, name: "You", me: true, how: "app" },
  people: [], steps: [], answers: [], next: { at: ist(12, 20, 20), line: "If it isn't done by 8:20 pm, X0 tells Priya." }, done: null,
  buttons: buttons({ cant: true, later: [{ action: "later_15m", label: "In 15 min" }, { action: "later_tmrw", label: "Tomorrow morning" }] }), ask: { asker: "Priya" },
};
const backup: FollowView = {
  ...asker, id: "eeeeeeee-0000-4000-8000-0000000000a3", you: "backup", asker: { name: "Rahul", me: false }, people: [], steps: [],
  buttons: buttons({ take: true }),
};

export const FOLLOW_VIEWS_FOR_TESTS = { asker, holder, backup };
