/**
 * THE SAMPLES: every Bots app screen (ids.ts) with the params and the route answers that draw it the way its boards do, the boards' day
 * (Aanya, Tuesday 28 October, Xode asking about the cart's rounding). showcase.ts renders them all; one screen's answers also work for
 * render.ts: `--api "$(npx tsx -e 'import("./scripts/bots-render/samples/index.ts").then(async (m) => console.log(JSON.stringify(await m.apiFor(m.sample("bots.plan")))))')"`.
 *
 * Each area keeps its own day (they were made by the area's own render checks): tests/bots-bots-data.ts and tests/bots-codework-data.ts
 * (shared with their tests), and here shell.ts, you.ts, keybot.json (the views in src/keybot/views.ts, as served), firstrun.json and
 * code.json (Xode's projects, jobs and PRs; `variants` are the few answers a step changes). A screen gets every area's answers, its
 * own area's last, since two areas answer some of the same routes differently (/v1/files, /v1/code/jobs).
 */
import { sampleApi as botsApi } from "../../../tests/bots-bots-data.js";
import { CODEWORK_API, PROJECT, JOB_ASK, JOB_LEAD, JOB_DONE, JOB_FAILED, JOB_ANSWER, ART } from "../../../tests/bots-codework-data.js";
import { keybotApi } from "../../../tests/bots-keybot-data.js";
import { FEED_ROHAN, FULL_CREATE, FULL_FIRST, FULL_MADE } from "../../../tests/spaces-data.js";
import { SAMPLE_BOTS } from "../../../src/experience/bots/fixtures.js";
import type { FakeOpts } from "../../../src/experience/bots/fixtures.js";
import { SCREENS } from "../../../src/experience/bots/ids.js";
import { shellApi, UPI, ASK } from "./shell.js";
import { NOTIFY_FOLLOW, YOU_API } from "./you.js";
import KEYBOT_API from "./keybot.json";
import FIRSTRUN_API from "./firstrun.json";
import CODE from "./code.json";
import { CALL_API } from "./planCall.js";
import { CAPTURE_API, CIRCULAR_WORDS, PHOTO_ID, RULES_ID } from "./planCapture.js";
import { FOLLOW_API, TASK_ID } from "./planFollow.js";
import { phoneApi } from "./followPhone.js";
import { MAKE_API, MAKE_OFF_API, MAKE_PARAMS, MAKE_STATES, MADE_KEY, PLAN_DAY_API } from "./planMake.js";
import { CINEMA_FILMS, CINEMA_OVERVIEW, CINEMA_PAGE_API } from "./cinema.js";

export type Area = "shell" | "bots" | "you" | "keybot" | "firstrun" | "code" | "codework";
type Params = Record<string, string | number | boolean>;

export interface Sample {
  id: string;
  area: Area;
  /** What tells two samples of one id apart (a step), in file names and labels. */
  variant?: string;
  /** The phone's board and the window's (bots-design/project/<Name>.dc.html). */
  board?: string;
  deskBoard?: string;
  params?: Params;
  /** The window's params, when its board shows another moment than the phone's. */
  deskParams?: Params;
  /** Answers this sample adds or changes. */
  api?: Record<string, unknown>;
  /** fakeDeps overrides (the live reads every screen gets). */
  fake?: Omit<FakeOpts, "api" | "calls">;
  /** Merged into the built screen's state before drawing (a moment that is state, not params: "Plan something"'s check face). */
  state?: Record<string, unknown>;
  /** Names the build does not declare: drawn for an older build (render.ts --without). */
  without?: string[];
}

/** Xode's project and jobs in code.json. */
const P = "11111111-1111-4111-8111-111111111111";
const J_REVIEW = "7c1d2e3f-0000-4000-8000-000000000001";
const J_PLAN = "7c1d2e3f-0000-4000-8000-000000000004";
const codeVariant = (v: keyof typeof CODE.variants): Record<string, unknown> => CODE.variants[v];

const S = SCREENS;
/** The cinema bot among the person's bots (it is listed only where CINEMA=true). */
const CINEMA_FAKE = { slug: "cinema", name: "Cinema", colour: "stone", purpose: "Makes films and videos shot by shot from your idea, and pictures.", builtin: true } as (typeof SAMPLE_BOTS)[number];
export const SAMPLES: Sample[] = [
  // screens/shell.ts
  { id: S.home, area: "shell", board: "Main", deskBoard: "DeskHome" },
  // Home with the cinema bot among the first tiles: the director clapping his board (samples/cinema.ts, screens/bots/cinemaPage.ts).
  { id: S.home, area: "shell", variant: "cinema", fake: { bots: [CINEMA_FAKE, ...SAMPLE_BOTS.slice(0, 2)], jobs: [], tasks: [] } },
  // The AI permission, due: signed in, not agreed, and not answered since the wording last changed (firstRun/aiConsentCard.ts).
  { id: S.home, area: "shell", variant: "ai", api: { "GET /v1/you/ai-consent": { agreed: false, asked: false } } },
  { id: S.activity, area: "shell", board: "Activity", deskBoard: "DeskActivity" },
  { id: S.ask, area: "shell", board: "Ask", deskBoard: "DAsk", params: { message: ASK } },
  { id: S.search, area: "shell", board: "Search", deskBoard: "DSearch", params: { q: "salon" } },
  { id: S.tasks, area: "shell", board: "Tasks", deskBoard: "DTasks" },
  { id: S.approve, area: "shell", board: "Approve", deskBoard: "DApprove", params: { upi: UPI, bot: "plan" } },
  { id: S.offline, area: "shell", board: "Offline", deskBoard: "DOffline" },
  // The first day: only the built-in bots, nothing done yet.
  { id: S.empty, area: "shell", board: "EmptyHome", deskBoard: "DEmptyHome", fake: { bots: SAMPLE_BOTS.filter((b) => b.builtin), jobs: [], tasks: [] } },
  { id: S.lock, area: "shell", board: "Lock" },
  { id: S.widgets, area: "shell", board: "Widgets", deskBoard: "DWidgets" },
  { id: S.today, area: "shell", deskBoard: "DeskToday" },
  { id: S.notes, area: "shell", deskBoard: "DeskNotes" },
  { id: S.note, area: "shell", deskBoard: "DeskNote", params: { id: "n1" } },
  // screens/firstRun.ts: the first run, Welcome to Code (bots.name-it is only a blank hand-off to Home now)...
  { id: S.welcome, area: "firstrun", board: "Welcome", deskBoard: "DWelcome" },
  { id: S.signIn, area: "firstrun", board: "SignIn", deskBoard: "DSignIn" },
  { id: S.signCode, area: "firstrun", board: "SignCode", deskBoard: "DSignCode" },
  { id: S.nameIt, area: "firstrun", board: "NameIt", deskBoard: "DNameIt" },
  // ...and the pages it used to lead through, reached from the app now: Language and Plans from You, Turn on Keylessbord
  // from the keyboard card, First words after the microphone card.
  { id: S.language, area: "firstrun", board: "Language", deskBoard: "DLanguage" },
  { id: S.keyOn, area: "firstrun", board: "KeyOn", deskBoard: "DKeyOn" },
  { id: S.firstWords, area: "firstrun", board: "FirstWords", deskBoard: "DFirstWords", params: { w: 5196, s: 1876 } },
  { id: S.plans, area: "firstrun", board: "Plans", deskBoard: "DPlans" },
  // screens/you.ts
  { id: S.you, area: "you", board: "You", deskBoard: "DYou" },
  { id: S.budget, area: "you", board: "Budget", deskBoard: "DBudget" },
  { id: S.billing, area: "you", board: "Billing", deskBoard: "DBilling" },
  // screens/you/space.ts (tests/space-data.ts): no boards of their own
  { id: S.youSpace, area: "you" },
  ...["about", "day", "people", "money", "timeline"].map((id) => ({ id: S.youSpaceSection, area: "you" as const, variant: id, params: { id } })),
  { id: S.notify, area: "you", board: "Notify", deskBoard: "DNotify" },
  // What pings you with follow-through's Must not miss (and a real phone call set up, someone who may ring louder).
  { id: S.notify, area: "you", variant: "follow", api: { "GET /v1/you/notify?tz=330": NOTIFY_FOLLOW } },
  { id: S.privacy, area: "you", board: "Privacy", deskBoard: "DPrivacy" },
  { id: S.deleteAccount, area: "you", board: "DeleteAcct", deskBoard: "DDeleteAcct" },
  { id: S.apps, area: "you", board: "Apps", deskBoard: "DApps" },
  { id: S.appConnect, area: "you", board: "AppConnect", deskBoard: "DAppConnect", params: { id: "google-calendar" } },
  { id: S.settings, area: "you", deskBoard: "DeskSettings" },
  // screens/you/devicesPage.ts: no board of its own
  { id: S.devices, area: "you" },
  // screens/bots.ts
  { id: S.bot, area: "bots", board: "BotPage", deskBoard: "DBotPage", params: { slug: "gym-bot" } },
  // screens/bots/cinemaPage.ts and cinemaScreens.ts (samples/cinema.ts): the cinema bot's page, empty and with films, and one film at each step.
  { id: S.bot, area: "bots", variant: "cinema", params: { slug: "cinema" }, api: CINEMA_PAGE_API(CINEMA_OVERVIEW), fake: { bots: [...SAMPLE_BOTS, CINEMA_FAKE] } },
  { id: S.bot, area: "bots", variant: "cinema-empty", params: { slug: "cinema" }, api: CINEMA_PAGE_API({ ...CINEMA_OVERVIEW, films: [], pictures: [], cast: [], spentToday: 0 }), fake: { bots: [...SAMPLE_BOTS, CINEMA_FAKE] } },
  ...(Object.keys(CINEMA_FILMS) as (keyof typeof CINEMA_FILMS)[]).map((step) => ({
    id: S.cinemaFilm, area: "bots" as const, variant: step, params: { f: "f1" }, api: { "GET /v1/cinema/films/f1": CINEMA_FILMS[step]() }, fake: { bots: [...SAMPLE_BOTS, CINEMA_FAKE] },
  })),
  { id: S.cinemaShot, area: "bots", variant: "board", params: { f: "f1", n: "2" }, api: { "GET /v1/cinema/films/f1": CINEMA_FILMS.board() }, fake: { bots: [...SAMPLE_BOTS, CINEMA_FAKE] } },
  { id: S.cinemaShot, area: "bots", variant: "needs-you", params: { f: "f1", n: "3" }, api: { "GET /v1/cinema/films/f1": CINEMA_FILMS.filming() }, fake: { bots: [...SAMPLE_BOTS, CINEMA_FAKE] } },
  { id: S.make, area: "bots", board: "MakeBot", deskBoard: "DMakeBot" },
  { id: S.edit, area: "bots", board: "BotEdit", deskBoard: "DBotEdit", params: { slug: "gym-bot" } },
  { id: S.keys, area: "bots", board: "BotKeys", deskBoard: "DBotKeys", params: { slug: "gym-bot" } },
  { id: S.store, area: "bots", board: "BotStore", deskBoard: "DBotStore" },
  // Plan Ease's home, the threaded day (screens/bots/planHome.ts; samples/planMake.ts): today in full, tomorrow, an empty Saturday, just
  // after "Plan something"'s Done; an older build (the week page, unchanged) and a build without the walking bot (the still avatar).
  { id: S.plan, area: "bots", variant: "home", board: "PlanBot", deskBoard: "DPlanBot", api: PLAN_DAY_API },
  { id: S.plan, area: "bots", variant: "tomorrow", params: { day: "2026-10-29" }, api: PLAN_DAY_API },
  { id: S.plan, area: "bots", variant: "empty", params: { day: "2026-10-31" }, api: PLAN_DAY_API },
  { id: S.plan, area: "bots", variant: "added", params: { day: "2026-10-28", made: MADE_KEY, n: 1 }, api: PLAN_DAY_API },
  { id: S.plan, area: "bots", variant: "old-build", api: PLAN_DAY_API, without: ["PersonBot"] },
  { id: S.plan, area: "bots", variant: "no-buddy", api: PLAN_DAY_API, without: ["BotBuddy", "BotsMotion"] },
  // "Plan something" (screens/bots/planMake.ts; samples/planMake.ts): the empty card from the home, the card filled, the check face
  // (looks good, notes with fixes, a stop, two drafts, the AI card, who is Nani, What still messy: Read it with AI), a bill's preview, a
  // day's answer, follow-through off, and an older build (the old add form).
  ...([
    ["edit", undefined], ["edit-filled", "filled"], ["check-good", "good"], ["check-notes", "notes"], ["check-stop", "stop"], ["check-multi", "multi"],
    ["who-is", "whoIs"], ["bill-preview", "bill"], ["box-answer", "boxDay"], ["check-messy", "messy"],
  ] as const).map(([variant, st]) => ({ id: S.planMake, area: "bots" as const, variant, params: MAKE_PARAMS, api: MAKE_API, ...(st ? { state: MAKE_STATES[st] } : {}) })),
  { id: S.planMake, area: "bots", variant: "follow-off", params: MAKE_PARAMS, api: MAKE_OFF_API },
  { id: S.planMake, area: "bots", variant: "old-build", params: MAKE_PARAMS, api: MAKE_API, without: ["PersonBot"] },
  // "X0 is calling" (screens/bots/planCall.ts; samples/planCall.ts): ringing (with AI, and a bill without it), missed, Call back pressed
  // on the notification (and on one whose call ended since: answered late, then hung up), ended. The window draws each as a record.
  { id: S.planCall, area: "bots", variant: "ringing", params: { call: "c1", state: "ringing", button: "p_answer" }, api: CALL_API },
  { id: S.planCall, area: "bots", variant: "bill", params: { call: "c2", state: "ringing" }, api: CALL_API },
  { id: S.planCall, area: "bots", variant: "missed", params: { call: "c3", state: "missed" }, api: CALL_API },
  { id: S.planCall, area: "bots", variant: "callback", params: { call: "c3", state: "missed", button: "p_callback" }, api: CALL_API },
  { id: S.planCall, area: "bots", variant: "callback-ended", params: { call: "c4", state: "missed", button: "p_callback" }, api: CALL_API },
  { id: S.planCall, area: "bots", variant: "ended", params: { call: "c4" }, api: CALL_API },
  // Follow-through (screens/bots/planFollow.ts; samples/planFollow.ts): the asker's view with every step, Mom holding Priya's pickup (the
  // Allow card), the next person once told, done; who does an item; a to-do's details with Must not miss and Who.
  { id: S.planFollow, area: "bots", variant: "asker", params: { follow: "f1" }, api: FOLLOW_API },
  { id: S.planFollow, area: "bots", variant: "holder", params: { follow: "f2" }, api: FOLLOW_API },
  { id: S.planFollow, area: "bots", variant: "backup", params: { follow: "f3" }, api: FOLLOW_API },
  { id: S.planFollow, area: "bots", variant: "done", params: { follow: "f4" }, api: FOLLOW_API },
  { id: S.planFollowPeople, area: "bots", params: { kind: "task", id: TASK_ID }, api: FOLLOW_API },
  { id: S.planItem, area: "bots", variant: "follow", params: { kind: "task", id: TASK_ID }, api: FOLLOW_API },
  // Follow-through's real phone call (screens/bots/followPhone.ts; samples/followPhone.ts): the person's own number in each state.
  ...(["none", "pending", "verified", "stopped", "off"] as const).map((v) => ({ id: S.planPhone, area: "bots" as const, variant: v, api: phoneApi(v) })),
  { id: S.travel, area: "bots", board: "TravelBot", deskBoard: "DTravelBot" },
  { id: S.chat, area: "bots", board: "Chat", params: { slug: "gym-bot" } },
  { id: S.spaces, area: "bots", board: "Spaces", deskBoard: "DSpaces" },
  // The new Spaces (screens/spaces/start.ts; famproto/motion's scenes, no boards): the first time, an invitation waiting in his thought,
  // calling your people, the moment it is made, his thought opened over your spaces.
  { id: S.spaces, area: "bots", variant: "first", api: { "GET /v1/botsapp/bots/spaces?full=1": FULL_FIRST } },
  { id: S.spaces, area: "bots", variant: "create", api: { "GET /v1/botsapp/bots/spaces?full=1": FULL_CREATE } },
  { id: S.spaces, area: "bots", variant: "made", params: { made: "s1" }, api: { "GET /v1/botsapp/bots/spaces?full=1": FULL_MADE } },
  { id: S.spaces, area: "bots", variant: "thought", params: { thought: "1" } },
  // screens/spaces.ts (tests/spaces-data.ts, in the bots area's answers): no boards of their own, drawn in Spaces' look. Inside Home: the
  // feed (screens/spaces/feed.ts), and as Rohan before he tapped OK on the admin's line.
  { id: S.spaces, area: "bots", variant: "home", params: { id: "s1" } },
  { id: S.spaces, area: "bots", variant: "consent", params: { id: "s1" }, api: { "GET /v1/botsapp/bots/spaces/s1/feed": { ...FEED_ROHAN, space: { ...FEED_ROHAN.space, consented: false } } } },
  { id: S.spacePeople, area: "bots", params: { id: "s1" } },
  // Work in space (screens/work.ts): Mom's plans as Home's admin sees them, and her doctor's visit.
  { id: S.work, area: "bots", params: { bot: "plan", space: "s1", owner: "m" } },
  { id: S.work, area: "bots", variant: "item", params: { bot: "plan", space: "s1", owner: "m", item: "e:doctor@2026-11-14" } },
  { id: S.spaceBot, area: "bots", variant: "plan", params: { id: "s1", bot: "plan" } },
  { id: S.spaceBot, area: "bots", variant: "code", params: { id: "s1", bot: "code" } },
  { id: S.spaceMemory, area: "bots", params: { id: "s1" } },
  { id: S.spaceMember, area: "bots", params: { id: "s1", member: "r" } },
  { id: S.spaceInvite, area: "bots", params: { id: "s1" } },
  { id: S.spaceItem, area: "bots", params: { item: "i-groceries" } },
  { id: S.spacePay, area: "bots", params: { id: "s1" } },
  { id: S.spaceTasks, area: "bots" },
  { id: S.spaceTasks, area: "bots", variant: "plan", params: { id: "s1", new: "plan" } },
  { id: S.share, area: "bots", params: { kind: "list", title: "Packing for Pune", items: "Charger\nAadhaar" } },
  { id: S.chats, area: "bots" },
  { id: S.thread, area: "bots", params: { id: "th-home" } },
  { id: S.shareIn, area: "bots", board: "ShareIn", deskBoard: "DShareIn", params: { file: "f-9" } },
  // Plan Ease's capture card for someone without a yes to AI (samples/planCapture.ts): the rules' card at once, nothing asks.
  { id: S.shareIn, area: "bots", variant: "plan", params: { text: CIRCULAR_WORDS }, api: CAPTURE_API },
  { id: S.planCapture, area: "bots", variant: "rules", params: { id: RULES_ID }, api: CAPTURE_API },
  { id: S.planCapture, area: "bots", variant: "photo", params: { id: PHOTO_ID }, api: CAPTURE_API },
  { id: S.avatars, area: "bots", board: "Avatars" },
  // screens/keybot.ts
  { id: S.keybot, area: "keybot", board: "Keylessbord", deskBoard: "DKeybot" },
  { id: S.keyLive, area: "keybot", board: "KeyLive" },
  { id: S.keyReply, area: "keybot", board: "KeyReply", deskBoard: "DKeyReply" },
  { id: S.keyRewrite, area: "keybot", board: "KeyRewrite", deskBoard: "DKeyRewrite" },
  { id: S.keyTone, area: "keybot", board: "KeyTone", deskBoard: "DKeyTone" },
  { id: S.keyTrain, area: "keybot", board: "KeyTrain", deskBoard: "DKeyTrain" },
  { id: S.keyVoices, area: "keybot", board: "KeyVoices", deskBoard: "DKeyVoices" },
  { id: S.keyWords, area: "keybot", board: "KeyWords", deskBoard: "DKeyWords" },
  { id: S.keyHistory, area: "keybot", board: "KeyHistory", deskBoard: "DKeyHistory" },
  { id: S.keySettings, area: "keybot", board: "KeySettings", deskBoard: "DKeySettings" },
  { id: S.keyPill, area: "keybot", deskBoard: "DeskPill" },
  // The old Stats and You tabs' pages, in Keylessbord (no boards of their own; docs/bots-keybot-parity.md).
  { id: S.keyMonth, area: "keybot" },
  { id: S.keyDay, area: "keybot" },
  { id: S.keyDay, variant: "quiet", area: "keybot", params: { day: 19 } },
  { id: S.keyApps, area: "keybot" },
  { id: S.keyApps, variant: "gmail", area: "keybot", params: { app: "Gmail" } },
  { id: S.keySpeak, area: "keybot" },
  { id: S.keyDays, area: "keybot" },
  { id: S.keyStyle, area: "keybot" },
  { id: S.keyHaptics, area: "keybot" },
  { id: S.keyName, area: "keybot" },
  // screens/code.ts
  { id: S.codeStart, variant: "meet", area: "code", board: "Enter1", deskBoard: "DEnter1", params: { step: "meet" }, api: codeVariant("meet") },
  { id: S.codeStart, variant: "pick", area: "code", board: "Enter2", deskBoard: "DEnter2", params: { step: "pick" } },
  { id: S.codeStart, variant: "read", area: "code", board: "Enter3", deskBoard: "DEnter3", params: { step: "read", project: P }, api: codeVariant("building") },
  { id: S.codeStart, variant: "home", area: "code", board: "Enter4", deskBoard: "DEnter4", params: { step: "home" } },
  { id: S.code, area: "code", board: "CodeHome", deskBoard: "DCodeHome", params: { project: P } },
  { id: S.newProject, area: "code", board: "NewProject", deskBoard: "DNewProject", params: { project: P }, api: codeVariant("ask") },
  { id: S.codePlan, area: "code", board: "CodePlan", deskBoard: "DCodePlan", params: { id: J_PLAN } },
  { id: S.codeReview, area: "code", board: "CodeReview", deskBoard: "DCodeReview", params: { id: J_REVIEW } },
  { id: S.prCare, area: "code", board: "PRCare", deskBoard: "DPRCare", params: { project: P, pr: 128 } },
  { id: S.projectRules, area: "code", board: "ProjectRules", deskBoard: "DProjectRules", params: { project: P } },
  // screens/codeWork.ts
  { id: S.codeJob, area: "codework", board: "Job", deskBoard: "DeskWork", params: { id: JOB_ASK }, deskParams: { id: JOB_ANSWER } },
  { id: S.team, area: "codework", board: "TeamBoard", deskBoard: "DTeamBoard", params: { id: JOB_LEAD } },
  { id: S.design, area: "codework", board: "Design", deskBoard: "DeskDesign", params: { id: ART } },
  { id: S.preview, area: "codework", board: "Preview", deskBoard: "DPreview", params: { id: ART } },
  { id: S.attach, area: "codework", board: "Attach", deskBoard: "DAttach", params: { project: PROJECT } },
  { id: S.done, area: "codework", board: "Done", deskBoard: "DDone", params: { id: JOB_DONE } },
  { id: S.failed, area: "codework", board: "Failed", deskBoard: "DFailed", params: { id: JOB_FAILED } },
];

/** One sample by id (and variant). */
export function sample(id: string, variant?: string): Sample {
  const s = SAMPLES.find((x) => x.id === id && (variant === undefined || x.variant === variant));
  if (!s) throw new Error(`samples: no sample for ${id}${variant ? ` (${variant})` : ""}`);
  return s;
}

let areas: Promise<Record<Area, Record<string, unknown>>> | undefined;
/** Every area's answers (built once). */
export function areaApis(): Promise<Record<Area, Record<string, unknown>>> {
  areas ??= (async () => ({
    bots: await botsApi(), shell: shellApi(), you: YOU_API, keybot: keybotAnswers(),
    firstrun: FIRSTRUN_API as Record<string, unknown>, codework: CODEWORK_API, code: CODE.base as Record<string, unknown>,
  }))();
  return areas;
}

/**
 * Keylessbord's answers: keybot.json (the views as served), with the home, the numbers, the words' spellings, shortcuts
 * and use, and the personality made from the last 30 days in tests/bots-keybot-data.ts.
 */
function keybotAnswers(): Record<string, unknown> {
  const json = KEYBOT_API as Record<string, unknown>;
  const made = keybotApi();
  const words = "GET /v1/keybot/words?tz=330";
  const { added: _a, learned: _l, q: _q, total: _t, ...extra } = made[words] as Record<string, unknown>;
  return { ...json, ...made, [words]: { ...(json[words] as Record<string, unknown>), ...extra } };
}

/** The answers one sample's screen gets: every area's, its own area's over them, its own on top. */
export async function apiFor(s: Sample): Promise<Record<string, unknown>> {
  const a = await areaApis();
  const order: Area[] = ["bots", "shell", "you", "keybot", "firstrun", "codework", "code"];
  return Object.assign({}, ...order.filter((k) => k !== s.area).map((k) => a[k]), a[s.area], s.api ?? {});
}
