/**
 * The boards' day for Spaces (Aanya's Home with Mom and Rohan, and Dev's Studio), as routes/bots/botsSpaces.ts answers it: the spaces, one
 * space whole, shared things, payment requests, tasks, invites, the chats and one chat; and the new Spaces' reads (GET /spaces?full=1,
 * a space's feed, Work in space). Used by tests/bots-bots-data.ts (sampleApi), tests/spaces-screens.test.ts and
 * tests/spaces-family-screens.test.ts, and so by the render check.
 *
 * There are no roles: the server answers every member with the same fixed set (MEMBER), its admin (the maker) with ALL, `roles: []`.
 */
import { FIXED_NOW } from "../src/experience/bots/fixtures.js";

const A = "/v1/botsapp/bots";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MEMBER = ["share", "bots", "addBots", "tasks", "plan", "approve", "askPay", "message", "groups", "activity"];
const ALL = ["invite", "remove", "manage", "share", "bots", "addBots", "tasks", "plan", "approve", "askPay", "message", "groups", "activity", "rename"];
const ISH = "https://api.x0bot.com";

const HOME = {
  id: "s1", name: "Home", mine: true, me: { admin: true, perms: ALL }, invite: null, roles: [], waiting: 1,
  members: [
    { userId: "u", name: "Aanya", you: true, maker: true, canApprove: true, joinedAt: Date.UTC(2026, 7, 4), perms: ALL, role: "admin", roleName: "Admin" },
    { userId: "m", name: "Mom", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 7, 4), perms: MEMBER, role: null, roleName: "Member" },
    { userId: "r", name: "Rohan", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 7, 4), perms: MEMBER, role: null, roleName: "Member" },
  ],
  bots: [{ slug: "plan", name: "Plan Ease", colour: "sea", addedBy: "Aanya", byYou: true }, { slug: "shop-bot", name: "Shop bot", colour: "sand", addedBy: "Mom", byYou: false }],
};
const STUDIO = {
  id: "s2", name: "Studio", mine: false, me: { admin: false, perms: MEMBER }, invite: null, roles: [], waiting: 0,
  members: [
    { userId: "u", name: "Aanya", you: true, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 8, 1), perms: MEMBER, role: null, roleName: "Member" },
    { userId: "d", name: "Dev", you: false, maker: true, canApprove: true, joinedAt: Date.UTC(2026, 7, 20), perms: ALL, role: "admin", roleName: "Admin" },
    { userId: "i", name: "Ishita", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 8, 3), perms: MEMBER, role: null, roleName: "Member" },
    { userId: "k", name: "Kabir", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 8, 9), perms: MEMBER, role: null, roleName: "Member" },
  ],
  bots: [{ slug: "code", name: "Xode", colour: "pine", addedBy: "Dev", byYou: false }],
};

const GROCERIES = {
  id: "i-groceries", kind: "list", title: "Groceries", spaceId: "s1", threadId: null, by: "Mom", byYou: false, at: FIXED_NOW - 3 * HOUR, updatedAt: FIXED_NOW - 40 * MIN,
  access: "edit", canEdit: true, canRemove: true, summary: "2 of 5 done", text: "", url: "", note: "For the week", place: "", when: "", who: "", bot: "", file: null,
  list: [{ id: "l1", text: "Chakki atta · 5 kg", done: true }, { id: "l2", text: "Toor dal · 1 kg", done: true }, { id: "l3", text: "Milk · 1 L × 7", done: false }, { id: "l4", text: "Tomato, onion, palak", done: false }, { id: "l5", text: "Paneer · 400 g", done: false }],
};
const ITEMS = [
  GROCERIES,
  { id: "i-trip", kind: "trip", title: "Trip to Pune", spaceId: "s1", threadId: null, by: "You", byYou: true, at: FIXED_NOW - DAY, updatedAt: FIXED_NOW - DAY, access: "edit", canEdit: true, canRemove: true,
    summary: "5 of 8 done", text: "", url: "", note: "", place: "Pune", when: "14–16 Nov", who: "You + Rohan", bot: "", file: null, list: [{ id: "p1", text: "Rohan's inhaler", done: true }, { id: "p2", text: "Aadhaar for check-in", done: false }] },
  { id: "i-hotel", kind: "file", title: "Hotel_Shanti_Residency_booking.pdf", spaceId: "s1", threadId: null, by: "You", byYou: true, at: FIXED_NOW - 2 * DAY, updatedAt: FIXED_NOW - 2 * DAY, access: "view", canEdit: false, canRemove: true,
    summary: "Hotel_Shanti_Residency_booking.pdf", text: "", url: "", note: "", place: "", when: "", who: "", bot: "", list: [],
    file: { name: "Hotel_Shanti_Residency_booking.pdf", mime: "application/pdf", bytes: 96_000, kind: "pdf", url: `${ISH}${A}/items/i-hotel/file?v=u&exp=1&sig=x` } },
];
const PAYMENTS = [
  { id: "p-groceries", amountPaise: 124_000, payee: "Fresh Basket", vpa: "freshbasket@okaxis", note: "This week's groceries", status: "waiting", at: FIXED_NOW - 30 * MIN, askedBy: "Rohan", byYou: false,
    decidedBy: "", decidedAt: null, paidAt: null, upi: null, canDecide: true, canCancel: false, canMarkPaid: false },
  { id: "p-fees", amountPaise: 250_000, payee: "Little Feet Football", vpa: "littlefeet@okhdfcbank", note: "Football coaching, November", status: "paid", at: FIXED_NOW - 6 * DAY, askedBy: "Rohan", byYou: false,
    decidedBy: "Mom", decidedAt: FIXED_NOW - 6 * DAY, paidAt: FIXED_NOW - 5 * DAY, upi: null, canDecide: false, canCancel: false, canMarkPaid: false },
];
const CAKE = {
  id: "t-cake", spaceId: "s1", spaceName: "Home", kind: "task", title: "Pick up the cake for Mom", notes: "The eggless one, from Theobroma", place: "Koramangala", at: Date.UTC(2026, 9, 29, 13, 0), end: null, allDay: false,
  setBy: "You", byYou: true, people: [{ userId: "r", name: "Rohan", you: false, status: "todo", note: "" }], mine: null, done: false, canRemove: true,
};
const NANI = {
  id: "t-nani", spaceId: "s1", spaceName: "Home", kind: "plan", title: "Call Nani", notes: "", place: "", at: Date.UTC(2026, 9, 29, 5, 30), end: Date.UTC(2026, 9, 29, 6, 0), allDay: false,
  setBy: "Mom", byYou: false, people: [{ userId: "u", name: "Aanya", you: true, status: "todo", note: "" }], mine: { status: "todo", note: "" }, done: false, canRemove: false,
};
const DETAIL = {
  space: {
    ...HOME,
    // The space's own code: GET /spaces/:id gives it to the admin only, already shown 3-3.
    code: "7KQ-29D",
    invites: [{ code: "QW3RT7YP", link: `${ISH}${A}/invite/QW3RT7YP`, email: "nani.sharma@gmail.com", expiresAt: FIXED_NOW + 6 * DAY, roleName: "Member", perms: MEMBER, byYou: true, by: "Aanya", mail: "queued" }],
    activity: [
      { id: "a1", kind: "pay", text: "Rohan asked for ₹1,240 to Fresh Basket for This week's groceries", at: FIXED_NOW - 30 * MIN, by: "Rohan" },
      { id: "a2", kind: "shared", text: "Mom shared Groceries", at: FIXED_NOW - 3 * HOUR, by: "Mom" },
      { id: "a3", kind: "task", text: "Aanya S. gave Pick up the cake for Mom to Rohan", at: FIXED_NOW - 4 * HOUR, by: "You" },
    ],
  },
  items: ITEMS, payments: PAYMENTS, tasks: [NANI, CAKE], you: "Aanya S.", mailReady: false,
};

const THREADS = [
  { id: "th-home", kind: "space", name: "Home", spaceId: "s1", spaceName: "Home", people: [{ userId: "u", name: "Aanya", you: true }, { userId: "m", name: "Mom", you: false }, { userId: "r", name: "Rohan", you: false }],
    last: { text: "Mom: Dinner at 8, everyone home?", at: FIXED_NOW - 12 * MIN }, unread: 2, muted: false, canPost: true, why: "" },
  { id: "th-mom", kind: "direct", name: "Mom", spaceId: null, spaceName: "", people: [{ userId: "u", name: "Aanya", you: true }, { userId: "m", name: "Mom", you: false }],
    last: { text: "Aanya: Shared Groceries", at: FIXED_NOW - 2 * HOUR }, unread: 0, muted: false, canPost: true, why: "" },
  { id: "th-diwali", kind: "group", name: "Diwali party", spaceId: "s2", spaceName: "Studio", people: [{ userId: "u", name: "Aanya", you: true }, { userId: "i", name: "Ishita", you: false }, { userId: "k", name: "Kabir", you: false }],
    last: { text: "Kabir: I'll bring the diyas", at: FIXED_NOW - DAY }, unread: 0, muted: true, canPost: true, why: "" },
];
const HOME_CHAT = {
  thread: { ...THREADS[0], unread: 0 }, more: true, before: FIXED_NOW - 3 * HOUR,
  messages: [
    { id: "msg1", from: { userId: "m", name: "Mom", you: false }, text: "Shared the grocery list. Add what you need.", at: FIXED_NOW - 3 * HOUR, files: [], item: { id: "i-groceries", kind: "list", title: "Groceries" } },
    { id: "msg2", from: { userId: "r", name: "Rohan", you: false }, text: "", at: FIXED_NOW - 50 * MIN, files: [{ id: "f-cake", name: "cake.jpg", mime: "image/jpeg", bytes: 240_000, kind: "image", url: `${ISH}${A}/threads/th-home/files/msg2/f-cake?v=u&exp=1&sig=x` }], item: null },
    { id: "msg3", from: { userId: "u", name: "Aanya", you: true }, text: "That one. Eggless please!", at: FIXED_NOW - 45 * MIN, files: [], item: null },
    { id: "msg4", from: { userId: "m", name: "Mom", you: false }, text: "Dinner at 8, everyone home?", at: FIXED_NOW - 12 * MIN, files: [], item: null },
  ],
};

// ===================================================================== the new Spaces (GET /spaces?full=1, a feed, Work in space)

/** GET /spaces?full=1 once Aanya is in spaces: each with its last line and what is new; Kabir's invitation and his request for Home. */
export const FULL_JOINED = {
  you: "Aanya S.", unread: 3,
  spaces: [
    { ...HOME, invited: 1, last: { from: "Mom", text: "Dinner at 8? Bring the dahi", at: FIXED_NOW - 12 * MIN }, unread: 2 },
    { ...STUDIO, last: { from: "Dev", text: "Shared a Xode project with you", at: FIXED_NOW - DAY }, unread: 1 },
  ],
  invitations: [{ code: "GYM4BUDD", spaceId: "s3", spaceName: "Gym Buddies", by: "Kabir", people: 4, expiresAt: FIXED_NOW + 6 * DAY }],
  requests: [{ id: "rq-ishita", spaceId: "s1", spaceName: "Home", name: "Ishita", at: FIXED_NOW - 20 * MIN }],
  asked: [], draft: null,
};
/** Meera's first time: no space yet, Aanya's invitation waiting for her email. */
export const FULL_FIRST = {
  you: "Meera", unread: 0, spaces: [],
  invitations: [{ code: "SHARMA22", spaceId: "s9", spaceName: "Sharma Family", by: "Aanya", people: 3, expiresAt: FIXED_NOW + 6 * DAY }],
  requests: [], asked: [{ id: "rq-mine", code: "7KQ-29D", at: FIXED_NOW - HOUR }], draft: null,
};
/** Calling her people: two invites already sent from the draft, before it has a name. */
export const FULL_CREATE = {
  you: "Meera", unread: 0, spaces: [], invitations: [], requests: [], asked: [],
  draft: { id: "d1", name: null, invites: [
    { code: "MEERA001", email: "meera@example.in", at: FIXED_NOW - 2 * MIN, mail: "sent" },
    { code: "ROHAN001", email: "rohan@example.in", at: FIXED_NOW - MIN, mail: "queued" },
  ] },
};
/** The moment after Done: Home made, two people invited. */
export const FULL_MADE = { ...FULL_JOINED, spaces: [{ ...HOME, invited: 2, last: null, unread: 0 }], invitations: [], requests: [] };

/** Inside Home, as Aanya (its admin): the feed, a message to Mom and a plan shared with her, and one between Mom and Rohan. */
export const FEED = {
  space: { id: "s1", name: "Home", admin: true, adminName: "Aanya", consented: true, threadId: "th-home" },
  people: [{ userId: "u", name: "Aanya", you: true, admin: true }, { userId: "m", name: "Mom", you: false, admin: false }, { userId: "r", name: "Rohan", you: false, admin: false }],
  more: true, before: FIXED_NOW - 3 * HOUR,
  messages: [
    { id: "f1", at: FIXED_NOW - 60 * MIN, from: { userId: "m", name: "Mom", you: false }, to: null, text: "Dinner at 8? Bring the dahi", files: [], thing: null, item: null },
    { id: "f2", at: FIXED_NOW - 50 * MIN, from: { userId: "r", name: "Rohan", you: false }, to: null, text: "Can someone drop me at practice tomorrow?", files: [], thing: null, item: null },
    { id: "f3", at: FIXED_NOW - 40 * MIN, from: { userId: "u", name: "Aanya", you: true }, to: { userId: "m", name: "Mom", you: false }, text: "Your check-up is Friday 7:40, I'll drive you", files: [], thing: null, item: null },
    { id: "f4", at: FIXED_NOW - 39 * MIN, from: { userId: "u", name: "Aanya", you: true }, to: { userId: "m", name: "Mom", you: false }, text: "",
      files: [], item: null, thing: { grantId: "g1", bot: "plan", botName: "Plan Ease", ownerId: "u", id: "e:doctor@2026-11-14", title: "Doctor, knee check-up", line: "Fri, 7:40 pm" } },
    { id: "f5", at: FIXED_NOW - 20 * MIN, from: { userId: "m", name: "Mom", you: false }, to: { userId: "r", name: "Rohan", you: false }, text: "Practice is at 5. Take your water bottle.", files: [], thing: null, item: null },
  ],
  payments: [{ id: "p-groceries", amountPaise: 124_000, payee: "Fresh Basket", vpa: "freshbasket@okaxis", note: "This week's groceries", status: "waiting", at: FIXED_NOW - 30 * MIN, askedBy: "Rohan", byYou: false,
    decidedBy: "", decidedAt: null, paidAt: null, upi: null, canDecide: true, canCancel: false, canMarkPaid: false }],
  tasks: [] as unknown[],
};
/** The same feed as Rohan sees it (a member): Mom's message to him is a plain one; his own to Mom says "To Mom". */
export const FEED_ROHAN = {
  ...FEED,
  space: { ...FEED.space, admin: false },
  people: FEED.people.map((p) => ({ ...p, you: p.userId === "r" })),
  messages: [
    { id: "f5", at: FIXED_NOW - 20 * MIN, from: { userId: "m", name: "Mom", you: false }, to: { userId: "r", name: "Rohan", you: true }, text: "Practice is at 5. Take your water bottle.", files: [], thing: null, item: null },
    { id: "f6", at: FIXED_NOW - 10 * MIN, from: { userId: "r", name: "Rohan", you: true }, to: { userId: "m", name: "Mom", you: false }, text: "Okay Mom", files: [], thing: null, item: null },
  ],
};

/** Plan Ease's Work in space for Aanya, Home's admin: Mom and Rohan; a note Mom left on Aanya's dentist visit. */
export const WORK_PLAN = {
  bot: "plan", botName: "Plan Ease", seenBy: [],
  spaces: [{ spaceId: "s1", spaceName: "Home", admin: true, people: [
    { userId: "m", name: "Mom", how: "admin", line: "All their plans" }, { userId: "r", name: "Rohan", how: "admin", line: "All their plans" },
  ] }],
  notesOnMine: [{ itemId: "e:dentist", title: "Dentist", by: "Mom", text: "I'll come with you", at: FIXED_NOW - 2 * HOUR, spaceId: "s1" }],
};
const DOCTOR = "e:doctor@2026-11-14";
/** Mom's plans, as Aanya (the admin) sees them, and her doctor's visit. */
export const WORK_PERSON = {
  space: { id: "s1", name: "Home" }, person: { userId: "m", name: "Mom", how: "admin", line: "All their plans" },
  items: [
    { id: "e:satsang@2026-11-16", title: "Satsang at Shanti's", line: "Sun 16 Nov · 5 pm", at: FIXED_NOW + 5 * DAY },
    { id: DOCTOR, title: "Doctor, knee check-up", line: "Fri 14 Nov · 7:40 pm", at: FIXED_NOW + 3 * DAY },
  ],
};
export const WORK_ITEM = {
  bot: "plan", botName: "Plan Ease", id: DOCTOR, title: "Doctor, knee check-up", line: "Fri 14 Nov · 7:40 pm", at: FIXED_NOW + 3 * DAY,
  owner: { userId: "m", name: "Mom", you: false }, space: { id: "s1", name: "Home" }, how: "admin",
  detail: { when: "Fri 14 Nov · 7:40 pm", place: "Dr. Rao's clinic, Indiranagar", day: "2026-11-14", time: "19:40" },
  notes: [{ id: "wn1", by: "Rohan", you: false, text: "I'll drive you there.", at: FIXED_NOW - HOUR }],
  can: { time: true, note: true },
};

/** The answers for the Spaces screens' reads. */
export function spacesApi(): Record<string, unknown> {
  return {
    [`GET ${A}/spaces?full=1`]: FULL_JOINED,
    [`GET ${A}/spaces/s1/feed`]: FEED,
    [`GET ${A}/work/plan`]: WORK_PLAN,
    [`GET ${A}/work/plan/person?space=s1&owner=m`]: WORK_PERSON,
    [`GET ${A}/work/plan/item?space=s1&owner=m&item=${encodeURIComponent(DOCTOR)}&tz=330`]: { item: WORK_ITEM },
    [`GET ${A}/spaces`]: { you: "Aanya S.", unread: 2, spaces: [HOME, STUDIO] },
    [`GET ${A}/spaces/s1`]: DETAIL,
    [`GET ${A}/spaces/s2`]: { space: { ...STUDIO, invites: [], activity: null }, items: [], payments: [], tasks: [], you: "Aanya S.", mailReady: false },
    [`GET ${A}/tasks/given`]: { tasks: [NANI] },
    [`GET ${A}/items/i-groceries`]: { item: GROCERIES },
    [`GET ${A}/share/targets`]: { spaces: [{ id: "s1", name: "Home", canShare: true }, { id: "s2", name: "Studio", canShare: false }], people: [{ userId: "m", name: "Mom", spaces: ["Home"] }, { userId: "r", name: "Rohan", spaces: ["Home"] }] },
    [`GET ${A}/threads`]: { threads: THREADS, unread: 2 },
    [`GET ${A}/threads/contacts`]: { people: [{ userId: "m", name: "Mom", spaces: ["Home"] }, { userId: "r", name: "Rohan", spaces: ["Home"] }], groupSpaces: [{ id: "s1", name: "Home", people: [{ userId: "m", name: "Mom" }, { userId: "r", name: "Rohan" }] }] },
    [`GET ${A}/threads/th-home`]: HOME_CHAT,
    // The group's sub-bots: Mom shares her whole Plan, Rohan one Xode project; Aanya shares nothing yet.
    [`GET ${A}/spaces/s1/sharing`]: { bots: [
      { bot: "plan", sharing: [{ userId: "m", name: "Mom", you: false, mode: "all" }] },
      { bot: "notes", sharing: [] },
      { bot: "travel", sharing: [{ userId: "u", name: "Aanya", you: true, mode: "all" }] },
      { bot: "code", sharing: [{ userId: "r", name: "Rohan", you: false, mode: "some" }] },
    ] },
    // What Home's bots know: lines Mom and Rohan told them, one Aanya shared from her own space.
    [`GET ${A}/spaces/s1/memory`]: { space: { id: "s1", name: "Home" }, admin: true, lines: [
      { id: "g1", text: "Dadi is vegetarian, no onion or garlic", section: "people", by: "Mom", you: false, mine: true, at: FIXED_NOW - 2 * HOUR, shared: false },
      { id: "g2", text: "Groceries come on Sunday mornings", section: "day", by: "Rohan", you: false, mine: true, at: FIXED_NOW - DAY, shared: false },
      { id: "g3", text: "We split the rent on the 1st", section: "money", by: "Mom", you: false, mine: true, at: FIXED_NOW - 3 * DAY, shared: false },
      { id: "g4", text: "Prefers short replies, in English with a little Hindi", section: "likes", by: "you", you: true, mine: true, at: FIXED_NOW - 4 * DAY, shared: true },
    ] },
    [`GET ${A}/spaces/s1/bots/plan/shared`]: { bot: "plan", space: { id: "s1", name: "Home" }, people: [
      { userId: "u", name: "Aanya", you: true, mode: "none", items: [] },
      { userId: "m", name: "Mom", you: false, mode: "all", items: [
        { id: "e:satsang", title: "Satsang at Shanti's", line: "Event", at: FIXED_NOW + DAY + 3 * 3_600_000 },
        { id: "e:doctor", title: "Doctor, knee check-up", line: "Event", at: FIXED_NOW + 2 * DAY },
        { id: "t:pension", title: "Submit pension form", line: "To-do", at: null },
      ] },
      { userId: "r", name: "Rohan", you: false, mode: "none", items: [] },
    ] },
    [`GET ${A}/spaces/s1/bots/plan/mine`]: { bot: "plan", mode: "some", items: ["e:dentist"], own: [
      { id: "e:dentist", title: "Dentist", line: "Event", at: FIXED_NOW + DAY },
      { id: "t:passport", title: "Renew passport", line: "To-do", at: null },
    ] },
    [`GET ${A}/spaces/s1/bots/code/shared`]: { bot: "code", space: { id: "s1", name: "Home" }, people: [
      { userId: "u", name: "Aanya", you: true, mode: "none", items: [] },
      { userId: "m", name: "Mom", you: false, mode: "none", items: [] },
      { userId: "r", name: "Rohan", you: false, mode: "some", items: [{ id: "p-school", title: "school-site", line: "Working · add the results page", at: FIXED_NOW - 20 * MIN }] },
    ] },
    [`GET ${A}/spaces/s1/bots/code/mine`]: { bot: "code", mode: "none", items: [], own: [{ id: "p-shop", title: "shop", line: "Done · round the cart total", at: FIXED_NOW - DAY }] },
  };
}
