/**
 * THE SAMPLES: every Bots app screen (ids.ts) with the params and the route answers that draw it the way its boards do, the boards' day
 * (Aanya, Tuesday 28 October, Code bot asking about the cart's rounding). showcase.ts renders them all; one screen's answers also work for
 * render.ts: `--api "$(npx tsx -e 'import("./scripts/bots-render/samples/index.ts").then(async (m) => console.log(JSON.stringify(await m.apiFor(m.sample("bots.plan")))))')"`.
 *
 * Each area keeps its own day (they were made by the area's own render checks): tests/bots-bots-data.ts and tests/bots-codework-data.ts
 * (shared with their tests), and here shell.ts, you.ts, keybot.json (the views in src/keybot/views.ts, as served), firstrun.json and
 * code.json (Code bot's projects, jobs and PRs; `variants` are the few answers a step changes). A screen gets every area's answers, its
 * own area's last, since two areas answer some of the same routes differently (/v1/files, /v1/code/jobs).
 */
import { sampleApi as botsApi } from "../../../tests/bots-bots-data.js";
import { CODEWORK_API, PROJECT, JOB_ASK, JOB_LEAD, JOB_DONE, JOB_FAILED, JOB_ANSWER, ART } from "../../../tests/bots-codework-data.js";
import { SAMPLE_BOTS } from "../../../src/experience/bots/fixtures.js";
import type { FakeOpts } from "../../../src/experience/bots/fixtures.js";
import { SCREENS } from "../../../src/experience/bots/ids.js";
import { shellApi, UPI, ASK } from "./shell.js";
import { YOU_API } from "./you.js";
import KEYBOT_API from "./keybot.json";
import FIRSTRUN_API from "./firstrun.json";
import CODE from "./code.json";

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
}

/** Code bot's project and jobs in code.json. */
const P = "11111111-1111-4111-8111-111111111111";
const J_REVIEW = "7c1d2e3f-0000-4000-8000-000000000001";
const J_PLAN = "7c1d2e3f-0000-4000-8000-000000000004";
const codeVariant = (v: keyof typeof CODE.variants): Record<string, unknown> => CODE.variants[v];

const S = SCREENS;
export const SAMPLES: Sample[] = [
  // screens/shell.ts
  { id: S.home, area: "shell", board: "Main", deskBoard: "DeskHome" },
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
  // screens/firstRun.ts
  { id: S.welcome, area: "firstrun", board: "Welcome", deskBoard: "DWelcome" },
  { id: S.signIn, area: "firstrun", board: "SignIn", deskBoard: "DSignIn" },
  { id: S.signCode, area: "firstrun", board: "SignCode", deskBoard: "DSignCode" },
  { id: S.language, area: "firstrun", board: "Language", deskBoard: "DLanguage" },
  { id: S.nameIt, area: "firstrun", board: "NameIt", deskBoard: "DNameIt" },
  { id: S.keyOn, area: "firstrun", board: "KeyOn", deskBoard: "DKeyOn" },
  { id: S.firstWords, area: "firstrun", board: "FirstWords", deskBoard: "DFirstWords", params: { w: 5196, s: 1876 } },
  { id: S.plans, area: "firstrun", board: "Plans", deskBoard: "DPlans" },
  // screens/you.ts
  { id: S.you, area: "you", board: "You", deskBoard: "DYou" },
  { id: S.budget, area: "you", board: "Budget", deskBoard: "DBudget" },
  { id: S.billing, area: "you", board: "Billing", deskBoard: "DBilling" },
  { id: S.computer, area: "you", board: "Devices", deskBoard: "DeskComputer" },
  { id: S.notify, area: "you", board: "Notify", deskBoard: "DNotify" },
  { id: S.privacy, area: "you", board: "Privacy", deskBoard: "DPrivacy" },
  { id: S.deleteAccount, area: "you", board: "DeleteAcct", deskBoard: "DDeleteAcct" },
  { id: S.apps, area: "you", board: "Apps", deskBoard: "DApps" },
  { id: S.appConnect, area: "you", board: "AppConnect", deskBoard: "DAppConnect", params: { id: "google-calendar" } },
  { id: S.settings, area: "you", deskBoard: "DeskSettings" },
  // screens/bots.ts
  { id: S.bot, area: "bots", board: "BotPage", deskBoard: "DBotPage", params: { slug: "gym-bot" } },
  { id: S.make, area: "bots", board: "MakeBot", deskBoard: "DMakeBot" },
  { id: S.edit, area: "bots", board: "BotEdit", deskBoard: "DBotEdit", params: { slug: "gym-bot" } },
  { id: S.keys, area: "bots", board: "BotKeys", deskBoard: "DBotKeys", params: { slug: "gym-bot" } },
  { id: S.store, area: "bots", board: "BotStore", deskBoard: "DBotStore" },
  { id: S.plan, area: "bots", board: "PlanBot", deskBoard: "DPlanBot" },
  { id: S.travel, area: "bots", board: "TravelBot", deskBoard: "DTravelBot" },
  { id: S.chat, area: "bots", board: "Chat", params: { slug: "gym-bot" } },
  { id: S.spaces, area: "bots", board: "Spaces", deskBoard: "DSpaces" },
  { id: S.shareIn, area: "bots", board: "ShareIn", deskBoard: "DShareIn", params: { file: "f-9" } },
  { id: S.avatars, area: "bots", board: "Avatars" },
  // screens/keybot.ts
  { id: S.keybot, area: "keybot", board: "Keybot", deskBoard: "DKeybot" },
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
    bots: await botsApi(), shell: shellApi(), you: YOU_API, keybot: KEYBOT_API as Record<string, unknown>,
    firstrun: FIRSTRUN_API as Record<string, unknown>, codework: CODEWORK_API, code: CODE.base as Record<string, unknown>,
  }))();
  return areas;
}

/** The answers one sample's screen gets: every area's, its own area's over them, its own on top. */
export async function apiFor(s: Sample): Promise<Record<string, unknown>> {
  const a = await areaApis();
  const order: Area[] = ["bots", "shell", "you", "keybot", "firstrun", "codework", "code"];
  return Object.assign({}, ...order.filter((k) => k !== s.area).map((k) => a[k]), a[s.area], s.api ?? {});
}
