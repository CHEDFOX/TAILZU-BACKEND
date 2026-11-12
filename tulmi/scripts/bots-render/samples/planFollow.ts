/**
 * FOLLOW-THROUGH (screens/bots/planFollow.ts, the item page's follow part, What pings you's Must not miss): the reads, as the follow
 * routes answer them, on the sample day (Tuesday 28 October, 7:40 pm). f1 the asker's view of Mom's evening medicine (told: every step X0
 * took), f2 Mom's own view of Priya's pickup (she holds it; the one-time Allow card), f3 the next person's view once told, f4 done. A
 * picker for who does an item (Mom, then Dad, who is not in the asker's X0 people now), and a to-do with its follow part.
 */
import { FIXED_NOW } from "../../../src/experience/bots/fixtures.js";
import type { FollowView, ItemFollow } from "../../../src/botsBots/planFollow.js";
import type { PeoplePicker } from "../../../src/botsBots/planFollowPeople.js";

const MIN = 60_000;
const FOLLOW = "/v1/botsapp/bots/plan/follow";
const T7 = FIXED_NOW - 40 * MIN; // 7:00 pm
const MOM = "u:aaaaaaaa-0000-4000-8000-00000000000m".replace("m", "1");
const DAD = "u:bbbbbbbb-0000-4000-8000-000000000002";
const ME = "u:cccccccc-0000-4000-8000-000000000003";
export const TASK_ID = "5e1f0c2e-1111-4222-8333-944445555777";

const buttons = (o: Partial<FollowView["buttons"]> = {}): FollowView["buttons"] => ({
  done: true, later: [], cant: false, take: false, undone: false, call: null, message: null, ...o,
});

const f1: FollowView = {
  id: "f1", item: `pt:${TASK_ID}`, kind: "todo", title: "Mom's evening medicine", when: "7 pm", must: true, why: "medicine", state: "told", you: "asker", n: 1,
  asker: { name: "You", me: true },
  holder: { key: MOM as FollowView["holder"]["key"], name: "Mom", me: false, how: "app" },
  people: [
    { key: MOM as FollowView["holder"]["key"], name: "Mom", me: false, how: "app", cant: false },
    { key: DAD as FollowView["holder"]["key"], name: "Dad", me: false, how: "app", cant: false },
  ],
  steps: [
    { at: T7, line: "7 pm · Mom · Notification · opened 7:02 pm" },
    { at: T7 + 5 * MIN, line: "7:05 pm · Mom · Louder notification · sent" },
    { at: T7 + 10 * MIN, line: "7:10 pm · Mom · X0 call · skipped: on another call" },
    { at: T7 + 20 * MIN, line: "7:20 pm · You · Told · sent" },
  ],
  answers: [],
  next: null, done: null,
  buttons: buttons({ take: true, call: { number: "+919876543210", name: "Mom" }, message: { userId: MOM.slice(2), name: "Mom" } }),
  ask: null,
};

const f2: FollowView = {
  id: "f2", item: "stask:s1:t1", kind: "ask", title: "Pick Kabir up from school", when: "8 pm", must: true, why: "pickup", state: "open", you: "holder", n: 1,
  asker: { name: "Priya", me: false },
  holder: { key: ME as FollowView["holder"]["key"], name: "You", me: true, how: "app" },
  people: [], steps: [], answers: [],
  next: { at: T7 + 80 * MIN, line: "If it isn't done by 8:20 pm, X0 tells Priya." }, done: null,
  buttons: buttons({ cant: true, later: [{ action: "later_15m", label: "In 15 min" }, { action: "later_1h", label: "In 1 hour" }, { action: "later_tmrw", label: "Tomorrow morning" }] }),
  ask: { asker: "Priya" },
};

const f3: FollowView = {
  ...f1, id: "f3", you: "backup", asker: { name: "Rahul", me: false }, title: "Electricity bill", kind: "due", why: "bill_today", when: "today",
  holder: { key: MOM as FollowView["holder"]["key"], name: "Mom", me: false, how: "app" }, steps: [], answers: [], people: [],
  buttons: buttons({ take: true }),
};

const f4: FollowView = {
  ...f1, id: "f4", state: "done", next: null,
  done: { by: "Mom", via: "app", at: T7 + 12 * MIN, line: "Mom said done · 7:12 pm · In X0" },
  answers: [{ at: T7 + 12 * MIN, line: "7:12 pm · Mom said done (In X0)" }],
  buttons: buttons({ done: false }),
};

export const ITEM_FOLLOW: ItemFollow = {
  allowed: true, importance: null, must: true, why: "medicine",
  people: [
    { key: MOM as ItemFollow["people"][number]["key"], name: "Mom", me: false, how: "app" },
    { key: DAD as ItemFollow["people"][number]["key"], name: "Dad", me: false, how: "gone" },
  ],
  open: { id: "f1", line: "Mom hasn't said done" },
};

const PICKER: PeoplePicker = {
  item: ITEM_FOLLOW,
  people: [
    { key: ME as PeoplePicker["people"][number]["key"], name: "You", me: true, number: false },
    { key: MOM as PeoplePicker["people"][number]["key"], name: "Mom", me: false, number: true },
    { key: "u:dddddddd-0000-4000-8000-000000000004", name: "Rahul", me: false, number: false },
  ],
  spaces: true, numbers: true, invite: { screen: "bots.space.invite", params: { id: "s1" } },
};

const TASK = {
  id: TASK_ID, title: "Mom's evening medicine", notes: "", list: "", due: "2026-10-28", at: T7, done: false, doneAt: null, remindMin: 0,
  from: null, source: "me", fixed: false, kind: "todo",
};

export const FOLLOW_API: Record<string, unknown> = {
  [`GET ${FOLLOW}/f1`]: f1,
  [`GET ${FOLLOW}/f2`]: f2,
  [`GET ${FOLLOW}/f3`]: f3,
  [`GET ${FOLLOW}/f4`]: f4,
  [`GET ${FOLLOW}/people?kind=task&id=${TASK_ID}`]: PICKER,
  [`GET /v1/botsapp/calendar/tasks/${TASK_ID}`]: { task: TASK },
  [`GET /v1/botsapp/bots/plan/details?kind=task&id=${TASK_ID}&tz=330`]: { before: [], moves: [], follow: ITEM_FOLLOW },
};
