/**
 * The boards' day for Spaces (Aanya's Home with Mom and Rohan, and Dev's Studio), as routes/botsSpaces.ts answers it: the spaces, one
 * space whole, shared things, payment requests, tasks, invites, the chats and one chat. Used by tests/bots-bots-data.ts (sampleApi)
 * and tests/spaces-screens.test.ts, and so by the render check.
 */
import { FIXED_NOW } from "../src/experience/bots/fixtures.js";

const A = "/v1/botsapp/bots";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const FAMILY = ["invite", "share", "bots", "addBots", "tasks", "plan", "askPay", "message", "groups", "activity"];
const KID = ["share", "bots", "askPay", "message"];
const ALL = ["invite", "remove", "manage", "share", "bots", "addBots", "tasks", "plan", "approve", "askPay", "message", "groups", "activity", "rename"];
const ROLES = [
  { id: "family", name: "Family", perms: FAMILY, preset: true }, { id: "kid", name: "Kid", perms: KID, preset: true },
  { id: "guest", name: "Guest", perms: ["bots", "message"], preset: true }, { id: "r-nani", name: "Grandparent", perms: ["share", "bots", "approve", "message"], preset: false },
];
const ISH = "https://api.tailzu.space";

const HOME = {
  id: "s1", name: "Home", mine: true, me: { admin: true, perms: ALL }, invite: null, roles: ROLES, waiting: 1,
  members: [
    { userId: "u", name: "Aanya", you: true, maker: true, canApprove: true, joinedAt: Date.UTC(2026, 7, 4), perms: ALL, role: "admin", roleName: "Admin" },
    { userId: "m", name: "Mom", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 7, 4), perms: [...FAMILY, "approve"], role: null, roleName: "Just for them" },
    { userId: "r", name: "Rohan", you: false, maker: false, canApprove: false, joinedAt: Date.UTC(2026, 7, 4), perms: KID, role: "kid", roleName: "Kid" },
  ],
  bots: [{ slug: "plan", name: "Plan bot", colour: "sea", addedBy: "Aanya", byYou: true }, { slug: "shop-bot", name: "Shop bot", colour: "sand", addedBy: "Mom", byYou: false }],
};
const STUDIO = {
  id: "s2", name: "Studio", mine: false, me: { admin: false, perms: FAMILY }, invite: { code: "K7PQ2MXA", expiresAt: FIXED_NOW + 6 * DAY }, roles: ROLES.slice(0, 3), waiting: 0,
  members: [
    { userId: "u", name: "Aanya", you: true, maker: false, canApprove: false, joinedAt: Date.UTC(2026, 8, 1), perms: FAMILY, role: "family", roleName: "Family" },
    { userId: "d", name: "Dev", you: false, maker: true, canApprove: true, joinedAt: Date.UTC(2026, 7, 20), perms: ALL, role: "admin", roleName: "Admin" },
    { userId: "i", name: "Ishita", you: false, maker: false, canApprove: true, joinedAt: Date.UTC(2026, 8, 3), perms: [...FAMILY, "approve"], role: null, roleName: "Just for them" },
    { userId: "k", name: "Kabir", you: false, maker: false, canApprove: false, joinedAt: Date.UTC(2026, 8, 9), perms: FAMILY, role: "family", roleName: "Family" },
  ],
  bots: [{ slug: "code", name: "Code bot", colour: "pine", addedBy: "Dev", byYou: false }],
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
    invites: [{ code: "QW3RT7YP", link: `${ISH}${A}/invite/QW3RT7YP`, email: "nani.sharma@gmail.com", expiresAt: FIXED_NOW + 6 * DAY, roleName: "Grandparent", perms: ["share", "bots", "approve", "message"], byYou: true, by: "Aanya", mail: "queued" }],
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

/** The answers for the Spaces screens' reads. */
export function spacesApi(): Record<string, unknown> {
  return {
    [`GET ${A}/spaces`]: { you: "Aanya S.", unread: 2, spaces: [HOME, STUDIO] },
    [`GET ${A}/spaces/s1`]: DETAIL,
    [`GET ${A}/spaces/s2`]: { space: { ...STUDIO, invites: [], activity: null }, items: [], payments: [], tasks: [], you: "Aanya S.", mailReady: false },
    [`GET ${A}/tasks/given`]: { tasks: [NANI] },
    [`GET ${A}/items/i-groceries`]: { item: GROCERIES },
    [`GET ${A}/share/targets`]: { spaces: [{ id: "s1", name: "Home", canShare: true }, { id: "s2", name: "Studio", canShare: false }], people: [{ userId: "m", name: "Mom", spaces: ["Home"] }, { userId: "r", name: "Rohan", spaces: ["Home"] }] },
    [`GET ${A}/threads`]: { threads: THREADS, unread: 2 },
    [`GET ${A}/threads/contacts`]: { people: [{ userId: "m", name: "Mom", spaces: ["Home"] }, { userId: "r", name: "Rohan", spaces: ["Home"] }], groupSpaces: [{ id: "s1", name: "Home", people: [{ userId: "m", name: "Mom" }, { userId: "r", name: "Rohan" }] }] },
    [`GET ${A}/threads/th-home`]: HOME_CHAT,
  };
}
