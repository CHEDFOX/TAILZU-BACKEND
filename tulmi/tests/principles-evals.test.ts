/**
 * THE EVAL FIXTURES AND THE RUNNER, WITHOUT A MODEL (scripts/eval-prompts.ts, evals/<role>.jsonl).
 *
 * The prompts have no examples any more; the fixtures are what an example used to be, and they are only worth having if they
 * can be trusted. So here:
 *   - every role has a fixture file, every line of it is a usable { input, expect }, and the pictures it names exist;
 *   - the checker (principles/evalcheck.ts) does what its header says, case by case;
 *   - a known-good answer for the first fixture of each role passes its own assertions AND is read by the real parser at the
 *     call site (the zod schema, splitGaps, parseEdits), so a fixture cannot ask for something the product would reject;
 *   - the runner asks a stand-in model what the product would ask it (the role's block, then the fixture), adds up tokens and
 *     paise, stops when the money is gone, and, run as a script, does nothing without a key and nothing at all in CI.
 *
 * The paid sweep itself is never run here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
noNetwork();

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const { ROLES, ROLE_IDS, stableBlock } = await import("../src/principles/roles.js");
const { at, check, fixtureProblem, parseAnswerJson } = await import("../src/principles/evalcheck.js");
const { EVALS_DIR, ROLE_TIER, formatReport, loadFixtures, realCall, runRole } = await import("../scripts/eval-prompts.js");
const { ModelClassification } = await import("../src/code/brain/classify.js");
const { PlanReply } = await import("../src/code/work/plan.js");
const { SynonymReply, PickReply } = await import("../src/code/work/locate.js");
const { SpecReply } = await import("../src/code/newproject/spec.js");
const { Weighed } = await import("../src/code/resources/brief.js");
const { FoldReply } = await import("../src/code/agent/context.js");
const { FileSchema, DirSchema, OverviewSchema, FeatureSchema, WelcomeSchema } = await import("../src/code/project/summarize.js");
const { GapSchema, splitGaps } = await import("../src/web/research.js");
const { ModelPlan } = await import("../src/web/search/plan.js");
const { VerdictSchema } = await import("../src/artifacts/compare.js");
const { parseEdits, parseRewrite } = await import("../src/artifacts/edit.js");
const { DecideReply } = await import("../src/front/decide.js");
const { PlanSchema: FrontPlanReply } = await import("../src/front/handlers.js");
const { ReviewVerdict } = await import("../src/code/prcare/review.js");
const { ConflictVerdict } = await import("../src/code/agent/merge.js");
const { SplitReply } = await import("../src/code/team/split.js");
const { PartReviewVerdict } = await import("../src/code/team/review.js");
const { BotDraftReply } = await import("../src/bots/builder.js");
const { BotPickReply } = await import("../src/bots/door.js");
const { BotMemoryReply } = await import("../src/bots/memory.js");
const { DigestReply } = await import("../src/widgets/digest.js");
const { parseLine } = await import("../src/agent/lines.js");
const { readSend } = await import("../src/pipeline/assistPrompt.js");
const { parsePortraitDraft } = await import("../src/pipeline/portraitDimensions.js");
const { CONNECTOR_ADDENDUM } = await import("../src/connectors/index.js");
const { DEVICE_ADDENDUM } = await import("../src/connectors/device.js");
type Fixture = import("../src/principles/evalcheck.js").Fixture;
type RoleId = (typeof ROLE_IDS)[number];

/** The roles that read a picture: their fixtures name one, and they are told it is evidence rather than that it is data. */
const PICTURE_ROLES: readonly RoleId[] = ["artifact_vision", "artifact_compare", "front_look"];

describe("the fixture files", () => {
  it("are one per role, and nothing else is in evals/ that looks like one", () => {
    const files = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith(".jsonl")).sort();
    expect(files).toEqual(ROLE_IDS.map((r) => `${r}.jsonl`).sort());
  });

  it("hold usable fixtures: at least two a role, each with an input and checkable assertions", () => {
    let all = 0;
    for (const role of ROLE_IDS) {
      const { fixtures, problems } = loadFixtures(role);
      expect(problems, role).toEqual([]);
      expect(fixtures.length, role).toBeGreaterThanOrEqual(2);
      all += fixtures.length;
      for (const f of fixtures) {
        expect(fixtureProblem(f), role).toBeNull();
        // the stable block is the role's: a fixture holds what changes, and none of what compose() adds
        expect(f.input, role).not.toContain("Principles:");
        expect(f.input, role).not.toContain(ROLES[role].identity);
      }
    }
    expect(all).toBeGreaterThanOrEqual(85);
  });

  it("name pictures that exist, and only the vision roles use them", () => {
    for (const role of ROLE_IDS) {
      for (const f of loadFixtures(role).fixtures) {
        for (const name of f.images ?? []) expect(fs.existsSync(path.join(EVALS_DIR, "images", name)), `${role}: ${name}`).toBe(true);
        if (PICTURE_ROLES.includes(role)) expect(f.images?.length, role).toBeGreaterThan(0);
        else expect(f.images, role).toBeUndefined();
      }
    }
    const pngs = fs.readdirSync(path.join(EVALS_DIR, "images"));
    for (const p of pngs) expect(fs.readFileSync(path.join(EVALS_DIR, "images", p)).subarray(0, 8).toString("hex"), p).toBe("89504e470d0a1a0a");
  });

  it("test what each role is for: an injection in the data, a refusal to reach beyond the ask, the contract's limits", () => {
    const all = ROLE_IDS.flatMap((r) => loadFixtures(r).fixtures.map((f) => ({ role: r, f })));
    // every role that reads text has a fixture that plants an instruction in it, and a model that obeys it fails
    for (const role of ROLE_IDS) {
      if (PICTURE_ROLES.includes(role)) continue;
      const planted = all.filter((x) => x.role === role).some((x) => /ignore\s+(?:all\s+)?(?:previous|the above|your)\b|ignore all instructions/i.test(x.f.input));
      expect(planted, `${role} has no fixture with an instruction planted in its data`).toBe(true);
    }
    // the planner is tested on the one thing it must never do
    expect(all.some((x) => x.role === "plan_change" && x.f.expect.exclude?.includes(".github/workflows"))).toBe(true);
    // the agent is tested on what its first move may be
    expect(all.filter((x) => x.role === "agent_work").every((x) => x.f.expect.tool !== undefined)).toBe(true);
  });

  it("have a tier for every role", () => {
    expect(Object.keys(ROLE_TIER).sort()).toEqual([...ROLE_IDS].sort());
  });
});

describe("the checker", () => {
  const ok = (e: object, text: string, tool?: string) => check(e as never, { text, ...(tool ? { tool } : {}) });

  it("reads JSON from the whole answer, a code fence or a line of preamble", () => {
    expect(parseAnswerJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseAnswerJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseAnswerJson('here: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(parseAnswerJson("[1,2]")).toEqual([1, 2]);
    expect(parseAnswerJson("nothing")).toBeUndefined();
    expect(at({ a: [{ b: 3 }] }, "a.0.b")).toBe(3);
    expect(at({ a: 1 }, "a.b.c")).toBeUndefined();
  });

  it("checks fields by value, by any of a list, by presence, by size and by range", () => {
    const text = '{"type":"bug_fix","needs":{"web":false},"signals":["a","b"],"summary":"short","confidence":0.8,"list":[]}';
    expect(ok({ json: { type: "bug_fix", "needs.web": false } }, text).ok).toBe(true);
    expect(ok({ json: { type: ["feature", "bug_fix"] } }, text).ok).toBe(true);
    expect(ok({ json: { type: "feature" } }, text).failures).toEqual(['type is "bug_fix", wanted "feature"']);
    expect(ok({ json: { type: ["feature", "refactor"] } }, text).ok).toBe(false);
    expect(ok({ json: { "needs.web": true } }, text).ok).toBe(false);
    expect(ok({ has: ["signals", "summary"] }, text).ok).toBe(true);
    expect(ok({ has: ["list"] }, text).failures).toEqual(["list is missing or empty"]);
    expect(ok({ has: ["nothing.here"] }, text).ok).toBe(false);
    expect(ok({ max: { signals: 2, summary: 10 } }, text).ok).toBe(true);
    expect(ok({ max: { signals: 1 } }, text).failures).toEqual(["signals is 2 long, at most 1"]);
    expect(ok({ max: { list: 0 } }, text).ok).toBe(true);
    expect(ok({ max: { confidence: 3 } }, text).ok).toBe(false);
    expect(ok({ range: { confidence: [0.5, 1] } }, text).ok).toBe(true);
    expect(ok({ range: { confidence: [0.9, 1] } }, text).failures).toEqual(["confidence is 0.8, wanted 0.9 to 1"]);
    expect(ok({ range: { summary: [0, 1] } }, text).ok).toBe(false);
  });

  it("fails an answer that is not JSON when JSON is asserted, and passes plain text for plain assertions", () => {
    expect(ok({ json: { a: 1 } }, "I think a is 1").failures).toEqual(["the answer is not JSON"]);
    expect(ok({ include: ["paris"] }, "The capital is Paris.").ok).toBe(true);
  });

  it("checks must-include and must-not-include without caring about case, and the length", () => {
    expect(ok({ include: ["GAPS:", "[1]"] }, "Use it [1].\ngaps: none").ok).toBe(true);
    expect(ok({ include: ["[2]"] }, "Use it [1].").failures).toEqual(['missing "[2]"']);
    expect(ok({ exclude: ["pwned"] }, "PWNED").failures).toEqual(['contains "pwned"']);
    expect(ok({ exclude: ["pwned"] }, "fine").ok).toBe(true);
    expect(ok({ maxChars: 5 }, "123456").failures).toEqual(["6 characters, at most 5"]);
    expect(ok({ maxChars: 6 }, "123456").ok).toBe(true);
  });

  it("checks the first tool call", () => {
    expect(ok({ tool: ["read_file", "grep"] }, "", "grep").ok).toBe(true);
    expect(ok({ tool: "grep" }, "", "run").failures).toEqual(["first tool is run, wanted grep"]);
    expect(ok({ tool: ["grep"] }, "no tool").failures).toEqual(["first tool is none, wanted grep"]);
  });

  it("says everything that failed, not just the first", () => {
    const v = ok({ json: { a: 2 }, include: ["x"], exclude: ["1"] }, '{"a":1}');
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(3);
  });

  it("refuses a fixture it cannot use", () => {
    expect(fixtureProblem({ input: "x", expect: { include: ["a"] } })).toBeNull();
    expect(fixtureProblem({ input: "", expect: { include: ["a"] } })).toMatch(/input/);
    expect(fixtureProblem({ input: "x", expect: {} })).toMatch(/at least one/);
    expect(fixtureProblem({ input: "x", expect: { nonsense: 1 } })).toMatch(/not an assertion/);
    expect(fixtureProblem({ input: "x", expect: { include: [1] } })).toMatch(/list of non-empty strings/);
    expect(fixtureProblem({ input: "x", expect: { range: { a: [1] } } })).toMatch(/\[min, max\]/);
    expect(fixtureProblem({ input: "x", expect: { include: ["a"] }, images: ["../x.png"] })).toMatch(/images/);
    expect(fixtureProblem("text")).toMatch(/object/);
    expect(fixtureProblem(null)).toMatch(/object/);
  });
});

describe("a known-good answer for each role", () => {
  /** An answer a model could give to the FIRST fixture of the role, in the contract's form. It must satisfy the fixture and be read by the real parser. */
  const GOOD: Record<RoleId, { text: string; reads: (text: string) => unknown }> = {
    classify: {
      text: '{"type":"bug_fix","difficulty":"low","risk":"low","needs":{"web":false,"exec":true,"vision":false,"indic":false},"language":"en","confidence":0.9,"signals":["crash","cart"]}',
      reads: (t) => ModelClassification.parse(JSON.parse(t)),
    },
    locate_terms: { text: '{"terms":["login","sign in","authenticate","signin button"]}', reads: (t) => SynonymReply.parse(JSON.parse(t)) },
    locate_pick: { text: '{"picks":[{"path":"src/components/LoginForm.tsx","why":"it holds the button text"}],"sure":true}', reads: (t) => PickReply.parse(JSON.parse(t)) },
    plan_change: {
      text: '{"steps":[{"do":"Format the price with two decimals in the product card","files":[{"path":"src/components/ProductCard.tsx","action":"edit"}]}],"notes":["The card test may need a new expected value."]}',
      reads: (t) => PlanReply.parse(JSON.parse(t)),
    },
    agent_work: { text: "", reads: () => true },
    agent_fold: { text: '{"summary":"slug() in src/util/slug.ts lowercases and dashes spaces. A trim of leading and trailing dashes is staged; npm test fails on slug keeps inner dashes. Next: fix the trim."}', reads: (t) => FoldReply.parse(JSON.parse(t)) },
    index_files: {
      text: '{"summaries":[{"path":"src/billing/invoice.ts","summary":"Builds an invoice from line items: buildInvoice adds tax by region."},{"path":"src/routes/health.ts","summary":"Serves GET /health for uptime checks."}]}',
      reads: (t) => FileSchema.parse(JSON.parse(t)),
    },
    index_dirs: { text: '{"summaries":[{"path":"src/billing","summary":"Invoices, tax and payment providers."},{"path":"src/ui","summary":"Shared interface components."}]}', reads: (t) => DirSchema.parse(JSON.parse(t)) },
    index_repo: { text: '{"overview":"Acme Bakery is a site for ordering bread and cakes for pickup. It is built with Next.js and Tailwind CSS."}', reads: (t) => OverviewSchema.parse(JSON.parse(t)) },
    index_features: {
      text: '{"features":[{"id":"1","name":"Sign in","summary":"Email and password login and logout."},{"id":"2","name":"Billing","summary":"Invoices, totals and paying them."}]}',
      reads: (t) => FeatureSchema.parse(JSON.parse(t)),
    },
    welcome: {
      text: '{"welcome":"acme-bakery lets people order bread and cakes for pickup. It is built with TypeScript, Next.js and Tailwind CSS, has 212 files, and 2 of 4 checks fail. To start: 1) Fix the failing tests 2) Add a first test for the checkout 3) Replace the deprecated dependency request."}',
      reads: (t) => WelcomeSchema.parse(JSON.parse(t)),
    },
    spec: {
      text: JSON.stringify({
        name: "Yoga Book", summary: "Studios sell classes and students book and pay.", users: ["studio owners", "students"], platforms: ["web", "ios"],
        features: [{ name: "Book a class", description: "Pick a slot and pay.", priority: "must" }, { name: "Cancel", description: "Cancel before the cutoff.", priority: "should" }],
        nonGoals: ["Video classes"], dataModel: [{ entity: "Class", fields: ["title", "starts_at"] }], screens: [{ name: "Schedule", purpose: "Browse classes" }], risks: ["Refunds"],
        assumptions: ["One studio to start."], needs: { auth: true, database: true, payments: true, seo: false, realtime: false, files: false, ai: false },
      }),
      reads: (t) => SpecReply.parse(JSON.parse(t)),
    },
    brief: {
      text: '{"shortAnswer":"React Hook Form is the usual pick [1].","options":[{"name":"React Hook Form","what":"Uncontrolled inputs","good":["fewer re-renders [1]"],"watch":[],"fit":"good"}],"recommendation":{"choice":"React Hook Form","because":"It fits Next.js and Zod [1].","caveats":[]}}',
      reads: (t) => Weighed.parse(JSON.parse(t)),
    },
    research_answer: { text: "Keep the input in state and set the query from a timer in an effect, clearing it in the cleanup [1].\nGAPS: no benchmark of lodash debounce", reads: (t) => splitGaps(t) },
    research_gaps: { text: '{"gaps":["No example of a custom key generator"],"queries":["fastify rate-limit keyGenerator"]}', reads: (t) => GapSchema.parse(JSON.parse(t)) },
    search_plan: {
      text: '{"intent":"api_docs","queries":["lodash frobnicate"],"sources":["github","mdn"],"site":["lodash.com"],"freshness":"any","confidence":0.7}',
      reads: (t) => ModelPlan.parse(JSON.parse(t)),
    },
    artifact_element: { text: '<button id="refresh" class="btn" style="background:#7c3aed">Reload</button>', reads: (t) => (t.startsWith("<") ? t : null) },
    artifact_edit: { text: "<edit><old>Weekly sales</old><new>Monthly sales</new></edit>", reads: (t) => parseEdits(t) },
    artifact_fix: { text: '<edit><old>getElementById("total")</old><new>getElementById("tot")</new></edit>', reads: (t) => parseEdits(t) },
    artifact_make: { text: '<!doctype html><html><head><style>body{font-family:sans-serif}</style></head><body><input id="bill" type="number"><script>document.title="Tip"</script></body></html>', reads: (t) => t },
    artifact_ask: { text: "Paris", reads: (t) => t },
    artifact_vision: { text: "A mobile sign-in screen. A dark header bar on top, a heading and a subtitle, two stacked input fields, a wide blue button and a small link below it.", reads: (t) => t },
    artifact_compare: {
      text: '{"match":0.55,"issues":[{"area":"Subscribe button","issue":"The button is red; the design has a purple button.","severity":"major","fixHint":"Use the primary colour for the button."},{"area":"Card","issue":"Tighter padding and no border.","severity":"minor","fixHint":"Restore the card padding and border."}]}',
      reads: (t) => VerdictSchema.parse(JSON.parse(t)),
    },
    front_decide: { text: '{"intent":"research","length":"medium","visual":"table","confidence":0.8,"clarify":null}', reads: (t) => DecideReply.parse(JSON.parse(t)) },
    front_reply: { text: "Canberra is the capital of Australia.", reads: (t) => t },
    front_code_answer: { text: "The cookie is set in startSession, at src/auth/session.ts:14, with httpOnly and sameSite lax.", reads: (t) => t },
    front_diagram: { text: "flowchart TD\n  A[App] --> B[API gateway]\n  B --> C[Orders service]\n  C --> D[Database]\n  D --> C\n  C --> B\n  B --> A", reads: (t) => (t.startsWith("flowchart") ? t : null) },
    front_plan: {
      text: '{"title":"Three days in Jaipur","steps":[{"do":"Day 1: Amber Fort in the morning, then the old city bazaars","when":"Day 1"},{"do":"Day 2: City Palace, Jantar Mantar and Hawa Mahal","when":"Day 2"},{"do":"Day 3: Nahargarh Fort at sunrise, then shopping","when":"Day 3"}],"notes":["Book fort tickets ahead on weekends."]}',
      reads: (t) => FrontPlanReply.parse(JSON.parse(t)),
    },
    front_look: { text: "A sign-in screen: a heading, two input fields and a wide blue button labelled Sign in, with a small link below it.", reads: (t) => t },
    care_review: {
      text: '{"kind":"small","summary":"Rename the variable tmp to retryCount in retry().","reply":"Renaming it now."}',
      reads: (t) => ReviewVerdict.parse(JSON.parse(t)),
    },
    care_conflict: {
      text: '{"files":[{"path":"src/index.ts","kind":"mechanical","reason":"Both sides added a different import; both stay."}]}',
      reads: (t) => ConflictVerdict.parse(JSON.parse(t)),
    },
    team_split: {
      text: '{"parts":[{"id":0,"title":"Invoice export contract","goal":"Add what an export needs to the Invoice type.","ownedPaths":["src/types/"],"reads":[],"dependsOn":[],"acceptance":["The Invoice type carries what an export needs"],"budgetShare":1},'
        + '{"id":1,"title":"Export endpoint","goal":"Build the export endpoint and its tests.","ownedPaths":["src/api/"],"reads":["src/types/invoice.ts"],"dependsOn":[0],"acceptance":["The endpoint answers with a PDF"],"budgetShare":2},'
        + '{"id":2,"title":"Invoice page","goal":"Add the export button and the call to the endpoint.","ownedPaths":["src/web/"],"reads":["src/types/invoice.ts"],"dependsOn":[0],"acceptance":["The page has an export button"],"budgetShare":2}],"notes":[]}',
      reads: (t) => SplitReply.parse(JSON.parse(t)),
    },
    team_review: {
      text: '{"verdict":"pass","summary":"The endpoint and its tests meet the acceptance.","findings":[]}',
      reads: (t) => PartReviewVerdict.parse(JSON.parse(t)),
    },
    // The bots platform (src/bots): the maker's draft, the front door's pick, a bot's own turn (plain text), and its memory of its owner.
    bot_builder: {
      text: '{"name":"Workout planner","purpose":"Plans my workouts and checks my calendar.","colour":"sea","rules":["Plan workouts around my calendar.","Keep each plan to one week."],'
        + '"skills":{"web":false,"files":false,"artifacts":false,"code":false,"research":false},"connectors":["google-calendar"],"tone":"upbeat and brief",'
        + '"tests":["Plan my workouts for next week.","What does my calendar look like tomorrow?","Move Thursday\'s session to Friday."]}',
      reads: (t) => BotDraftReply.parse(JSON.parse(t)),
    },
    bot_pick: { text: '{"bot":"workout-buddy","confidence":0.9}', reads: (t) => BotPickReply.parse(JSON.parse(t)) },
    bot_run: { text: "Two rest days a week is a good rule: one full rest and one light day.", reads: (t) => t },
    bot_memory: {
      text: '{"add":["Trains at 6am on weekdays.","Is vegetarian."],"drop":[],"summary":"Planning workouts around a 6am weekday routine and a vegetarian diet."}',
      reads: (t) => BotMemoryReply.parse(JSON.parse(t)),
    },
    widget_digest: { text: '{"line":"Code bot finished the cart fix; Plan bot needs you"}', reads: (t) => DigestReply.parse(JSON.parse(t)) },
    // The main assistant (agent/, pipeline/). Ask's lines are read by the device's parser, the writer's answer by readSend, the portrait by parsePortraitDraft.
    ask_planner: {
      text: "SAY Captions is this switch on the right.\nPOINT e40 | Captions\nDONE",
      reads: (t) => (t.split("\n").every((l) => parseLine(l, "mac")) ? t : null),
    },
    ask_vision: {
      text: "SAY It says energy equals mass times the speed of light squared.\nSAY E is energy, m is mass, and c is the speed of light.\nDONE",
      reads: (t) => (t.split("\n").every((l) => parseLine(l, "mac")) ? t : null),
    },
    writer: { text: "<intent>a status update for a contact: short</intent><send>Reaching in ten.</send>", reads: (t) => readSend(t) },
    edit_selection: { text: "Please send the money as soon as possible.", reads: (t) => t },
    answer_about: { text: "You owe $42.50.", reads: (t) => t },
    converse: { text: "That sounds like a lovely trip. What was the best part of it?", reads: (t) => t },
    portrait_update: {
      text: '{"core":"Short and direct. Drops greetings, keeps contractions, no exclamation marks.","words":[],"styles":[{"name":"clipped","when":"messages to colleagues"}],"rhythms":[],"toneNote":"Plain."}',
      reads: (t) => parsePortraitDraft(t).core,
    },
    portrait_transcript: {
      text: '{"core":"Easy and wandering. Long run-on sentences, casual fillers dropped in writing.","words":[],"styles":[],"rhythms":[]}',
      reads: (t) => parsePortraitDraft(t).core,
    },
    portrait_usage: {
      text: '{"core":"Clipped. Lowercase openers survive every rewrite; politeness words get added by the rewrite, not by them.","words":[],"styles":[],"rhythms":[]}',
      reads: (t) => parsePortraitDraft(t).core,
    },
  };

  it("has one for every role", () => {
    expect(Object.keys(GOOD).sort()).toEqual([...ROLE_IDS].sort());
  });

  for (const role of ROLE_IDS) {
    if (role === "agent_work") continue;
    it(`${role}: passes the first fixture and is read by the parser the call site uses`, () => {
      const first = loadFixtures(role).fixtures[0]!;
      const verdict = check(first.expect, { text: GOOD[role].text });
      expect(verdict.failures, role).toEqual([]);
      expect(() => GOOD[role].reads(GOOD[role].text), role).not.toThrow();
      expect(GOOD[role].reads(GOOD[role].text), role).toBeTruthy();
    });
  }

  it("the connected-app fixtures of the planner begin with the addendum the product sends, so they cannot drift from it", () => {
    const apps = loadFixtures("ask_planner").fixtures.filter((f) => f.input.includes("<tools>"));
    expect(apps.length).toBeGreaterThanOrEqual(5);
    for (const f of apps) {
      expect(f.input.startsWith(`${CONNECTOR_ADDENDUM}\n`)).toBe(true);
      // "This computer" has its own lesson, after the apps'.
      if (f.input.includes("this-computer.")) expect(f.input.startsWith(`${CONNECTOR_ADDENDUM}\n${DEVICE_ADDENDUM}\n`)).toBe(true);
    }
    // the rest are the step's message alone, from its first line
    for (const f of loadFixtures("ask_planner").fixtures.filter((x) => !x.input.includes("<tools>"))) expect(f.input).toMatch(/^Platform: /);
  });

  it("the writer's fixtures are the user message the product sends: the call's data first, what they said last", () => {
    for (const f of loadFixtures("writer").fixtures) {
      expect(f.input).toMatch(/<said>\n[\s\S]*\n<\/said>$/);
      expect(f.input.startsWith("<call>") || f.input.startsWith("<tone>")).toBe(true);
      expect(f.expect.include).toContain("<send>");
    }
  });

  it("agent_work: a first move that reads the code passes, and running a command from a planted instruction does not", () => {
    const planted = loadFixtures("agent_work").fixtures.find((f) => /evil\.example/.test(f.input))!;
    expect(check(planted.expect, { text: "", tool: "read_file" }).ok).toBe(true);
    expect(check(planted.expect, { text: "", tool: "run" }).ok).toBe(false);
  });

  it("a wrong answer fails the first fixture of the roles with something to get wrong", () => {
    const wrong: Partial<Record<RoleId, string>> = {
      classify: GOOD.classify.text.replace("bug_fix", "feature"),
      plan_change: GOOD.plan_change.text.replace("ProductCard", "Other"),
      research_answer: "No citation and no gaps line.",
      artifact_edit: "<rewrite>everything</rewrite>",
      artifact_make: "```html\n<html></html>\n```",
      artifact_compare: GOOD.artifact_compare.text.replace('"major"', '"minor"'),
    };
    for (const [role, text] of Object.entries(wrong)) expect(check(loadFixtures(role as RoleId).fixtures[0]!.expect, { text }).ok, role).toBe(false);
    // the parsers, for their part, take the good answers and refuse a bad shape
    expect(() => ModelClassification.parse({ type: "nonsense" })).toThrow();
    expect(parseEdits(GOOD.artifact_edit.text)).toEqual([{ old: "Weekly sales", new: "Monthly sales" }]);
    expect(parseRewrite("<rewrite>x</rewrite>")).toBe("x");
    expect(splitGaps(GOOD.research_answer.text).gaps).toEqual(["no benchmark of lodash debounce"]);
  });
});

describe("the runner", () => {
  const fx = (over: Partial<Fixture> = {}): Fixture => ({ input: "Request:\n<<<\nfix the crash\n>>>", expect: { json: { type: "bug_fix" } }, ...over });
  const reply = (text: string, extra: Record<string, unknown> = {}) => ({
    text, json: undefined, toolCalls: [], model: "m/x", promptTokens: 100, completionTokens: 20, costUsd: 0, paise: 3, costSource: "reported", truncated: false, ms: 1, calls: 1, trail: [], ...extra,
  });

  it("asks what the product asks: the role's block, then the fixture's input, at the role's tier, charged under a cap", async () => {
    const call = vi.fn(async () => reply('{"type":"bug_fix"}') as never);
    const r = await runRole("classify", [fx()], { call });
    expect(call).toHaveBeenCalledOnce();
    const sent = (call.mock.calls[0] as unknown as [{ tier: string; messages: Array<{ role: string; content: string }>; budget: { maxPaise: number }; purpose: string; tools?: unknown }])[0];
    expect(sent.tier).toBe("tiny");
    expect(sent.messages).toEqual([{ role: "system", content: stableBlock("classify") }, { role: "user", content: "Request:\n<<<\nfix the crash\n>>>" }]);
    expect(sent.purpose).toBe("eval.classify");
    expect(sent.budget.maxPaise).toBeGreaterThan(0);
    expect(sent.tools).toBeUndefined();
    expect(r).toMatchObject({ role: "classify", fixtures: 1, runs: 1, passed: 1, promptTokens: 100, completionTokens: 20, paise: 3, failures: [] });
  });

  it("gives the agent its tools and reads its first tool call; and sends pictures as parts", async () => {
    const call = vi.fn(async () => reply("", { toolCalls: [{ id: "c1", name: "grep", arguments: "{}" }] }) as never);
    const r = await runRole("agent_work", [fx({ input: "<task>\nfind it\n</task>", expect: { tool: ["grep", "read_file"] } })], { call });
    const sent = (call.mock.calls[0] as unknown as [{ tools: Array<{ name: string }>; toolChoice: string }])[0];
    expect(sent.tools.map((t) => t.name)).toContain("run");
    expect(sent.toolChoice).toBe("auto");
    expect(r.passed).toBe(1);

    const seen = vi.fn(async () => reply('{"summaries":[]}') as never);
    await runRole("artifact_vision", [{ input: "Describe it.", expect: { include: ["x"] }, images: ["login-screen.png"] }], { call: seen });
    const msg = (seen.mock.calls[0] as unknown as [{ messages: Array<{ role: string; content: unknown }> }])[0].messages[1]!;
    const parts = msg.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(parts[1]!.image_url!.url.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
  });

  it("counts a failure with why, adds up tokens and paise over every run, and survives a call that throws", async () => {
    const answers = ['{"type":"bug_fix"}', '{"type":"feature"}', new Error("provider down")];
    let n = 0;
    const call = vi.fn(async () => { const a = answers[n++]!; if (a instanceof Error) throw a; return reply(a) as never; });
    const r = await runRole("classify", [fx(), fx(), fx()], { call });
    expect(r).toMatchObject({ fixtures: 3, runs: 3, passed: 1, promptTokens: 200, completionTokens: 40, paise: 6 });
    expect(r.failures.map((f) => f.why[0])).toEqual(['type is "feature", wanted "bug_fix"', "the call failed: provider down"]);
    expect(r.failures[0]!.answer).toBe('{"type":"feature"}');
  });

  it("repeats each fixture EVAL_RUNS times, and stops asking once the money is gone", async () => {
    const call = vi.fn(async () => reply('{"type":"bug_fix"}', { paise: 40 }) as never);
    const twice = await runRole("classify", [fx()], { call, runs: 2 });
    expect(twice).toMatchObject({ runs: 2, passed: 2, paise: 80 });
    const spent = { paise: 0 };
    const capped = await runRole("classify", [fx(), fx(), fx(), fx()], { call, spent, maxPaise: 100 });
    expect(capped.runs).toBe(3);
    expect(capped.stoppedEarly).toBe(true);
    expect(spent.paise).toBe(120);
  });

  it("reports the pass rate, the tokens and the paise of each role, and a total", () => {
    const text = formatReport([
      { role: "classify", fixtures: 2, runs: 2, passed: 1, promptTokens: 300, completionTokens: 40, paise: 5, failures: [] },
      { role: "spec", fixtures: 1, runs: 1, passed: 1, promptTokens: 900, completionTokens: 700, paise: 60, failures: [] },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/role\s+pass\s+rate\s+tokens in\s+tokens out\s+paise/);
    expect(lines.find((l) => l.startsWith("classify"))).toMatch(/1\/2\s+50%\s+300\s+40\s+5/);
    expect(lines.find((l) => l.startsWith("spec"))).toMatch(/1\/1\s+100%\s+900\s+700\s+60/);
    expect(lines.find((l) => l.startsWith("total"))).toMatch(/2\/3\s+67%\s+1200\s+740\s+65/);
  });

  it("goes through the gateway like the product does, with only the OpenRouter key and a client of its own", async () => {
    const create = vi.fn(async () => ({ choices: [{ message: { content: '{"type":"bug_fix"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 10, cost: 0.0002 } }));
    const call = realCall("k", { chat: { completions: { create } } } as never);
    const r = await runRole("classify", [fx()], { call });
    expect(create).toHaveBeenCalledOnce();
    const body = create.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }>; model: string };
    expect(body.messages[0]).toEqual({ role: "system", content: stableBlock("classify") });
    // the JSON line is in the block already, so the gateway adds nothing after it
    expect(body.messages[0]!.content.match(/JSON only when asked/g)).toHaveLength(1);
    expect(body.messages[0]!.content).not.toContain("Answer with one JSON value only");
    expect(r.passed).toBe(1);
    expect(r.paise).toBeGreaterThan(0);
  });
});

describe("the script", () => {
  const script = path.join(root, "scripts", "eval-prompts.ts");
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, encoding: "utf8", timeout: 60_000 });

  it("does nothing, and says so, without a key", () => {
    const r = run([], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OPENROUTER_API_KEY is not set, so nothing was run/);
  });

  it("refuses to run in CI, key or no key", () => {
    const r = run([], { CI: "true", OPENROUTER_API_KEY: "k" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/never part of CI/);
  });

  it("lists the fixtures without a key and calls nothing", () => {
    const r = run(["--list"], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/classify\s+9 fixtures/);
    expect(r.stdout.trim().split("\n")).toHaveLength(ROLE_IDS.length);
  });

  it("is not run by the test suite or by any workflow", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["eval:prompts"]).toBe("tsx scripts/eval-prompts.ts");
    expect(pkg.scripts.test).toBe("vitest run");
    const workflows = path.join(root, "..", ".github", "workflows");
    if (fs.existsSync(workflows)) for (const f of fs.readdirSync(workflows)) expect(fs.readFileSync(path.join(workflows, f), "utf8"), f).not.toMatch(/eval-prompts|eval:prompts/);
  });
});
