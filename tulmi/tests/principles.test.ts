/**
 * THE PRINCIPLES (src/principles/): the library, the roles, and compose().
 *
 * What these hold down:
 *   - every principle is one imperative line of at most 120 characters, with no example in it, and ids and texts are unique;
 *   - every role names principles that exist, has a one-line identity and a contract that is a schema and not an example;
 *   - compose() is deterministic: the stable block is the same bytes on every call of a role, comes first, lists the
 *     principles first and in library order, and never holds anything dynamic, which always comes after it;
 *   - each role's block stays inside its character budget (the measured size plus 10%), so a role cannot quietly grow
 *     back into the paragraph it replaced;
 *   - the contracts still say what the parsers at the call sites read: every field of each zod schema is named in its
 *     role's contract, and the lists a contract spells out (request types, intents, sources, libraries) are the code's.
 */
import { describe, expect, it } from "vitest";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
noNetwork();

const { GROUPS, PRINCIPLES, PRINCIPLE_MAX, groupOf, orderOf, principleText } = await import("../src/principles/library.js");
const { ROLES, ROLE_IDS, compose, isRoleId, stableBlock } = await import("../src/principles/roles.js");
const { ModelClassification } = await import("../src/code/brain/classify.js");
const { REQUEST_TYPES, LEVELS, LANGUAGES } = await import("../src/code/brain/types.js");
const { PlanReply } = await import("../src/code/work/plan.js");
const { SynonymReply, PickReply } = await import("../src/code/work/locate.js");
const { SpecReply } = await import("../src/code/newproject/spec.js");
const { Weighed } = await import("../src/code/resources/brief.js");
const { FoldReply } = await import("../src/code/agent/context.js");
const { FileSchema, DirSchema, OverviewSchema, FeatureSchema, WelcomeSchema } = await import("../src/code/project/summarize.js");
const { GapSchema } = await import("../src/web/research.js");
const { ModelPlan } = await import("../src/web/search/plan.js");
const { INTENTS, DIRECT_SOURCES } = await import("../src/web/search/types.js");
const { VerdictSchema } = await import("../src/artifacts/compare.js");
const { ARTIFACT_LIBS } = await import("../src/artifacts/protocol.js");
const { WELCOME_CHARS } = await import("../src/code/project/types.js");
const { rows, totals, NEW_ROLES } = await import("../scripts/prompt-sizes.js");
const { DecideReply } = await import("../src/front/decide.js");
const { ReviewVerdict } = await import("../src/code/prcare/review.js");
const { ConflictVerdict } = await import("../src/code/agent/merge.js");
const { PlanSchema: FrontPlanReply } = await import("../src/front/handlers.js");
const { INTENTS: FRONT_INTENTS, LENGTHS: FRONT_LENGTHS, VISUAL_KINDS } = await import("../src/front/types.js");

/** Said where the example or the explanation would be. A principle gives the rule, never a case of it. */
const EXAMPLE_MARKERS = /\be\.g\.|\bi\.e\.|for example|for instance|such as|example:|\bexamples?\b|\blike\s+["`']/i;

describe("the library", () => {
  it("has the eight groups, each with its principles", () => {
    expect(Object.keys(GROUPS)).toEqual(["core", "safety", "efficiency", "code", "visuals", "research", "media", "output"]);
    for (const [name, list] of Object.entries(GROUPS)) expect(list.length, name).toBeGreaterThan(0);
    expect(PRINCIPLES.length).toBe(Object.values(GROUPS).flat().length);
  });

  it("holds every principle to one imperative line of at most 120 characters, with no example", () => {
    for (const p of PRINCIPLES) {
      expect(p.text.length, p.id).toBeLessThanOrEqual(PRINCIPLE_MAX);
      expect(p.text.length, p.id).toBeGreaterThan(20);
      expect(p.text, p.id).not.toContain("\n");
      expect(p.text, p.id).toBe(p.text.trim());
      expect(p.text, p.id).toMatch(/[.]$/);
      expect(p.text, p.id).not.toMatch(EXAMPLE_MARKERS);
      expect(p.text, p.id).not.toMatch(/[:;] ?\d\)/);
    }
    expect(PRINCIPLE_MAX).toBe(120);
  });

  it("has unique ids, in the form group.name, and unique texts", () => {
    const ids = PRINCIPLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PRINCIPLES.map((p) => p.text)).size).toBe(PRINCIPLES.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z]+\.[a-z]+$/);
    // an id's prefix is its group's, so a reader of a role sees where a rule came from
    const prefix: Record<string, string> = { core: "core", safety: "safe", efficiency: "eff", code: "code", visuals: "vis", research: "res", media: "media", output: "out" };
    for (const p of PRINCIPLES) expect(p.id.startsWith(`${prefix[groupOf(p.id)]}.`), p.id).toBe(true);
  });

  it("says the product's behaviours, one rule each", () => {
    const says = (id: string, ...words: RegExp[]) => { for (const w of words) expect(principleText(id as never), id).toMatch(w); };
    says("core.intent", /understand/i);
    says("core.least", /least/i);
    says("core.unsure", /unsure/i);
    says("core.facts", /never invent/i, /facts/, /paths/, /APIs/);
    says("core.lang", /language and script/i, /Hinglish/);
    says("core.ask", /one question/i, /two or three options/i, /real work/i);
    says("safe.data", /web/i, /file/i, /tool/i, /never instructions/);
    says("safe.secrets", /secrets/i);
    says("safe.rules", /permission rules decide/i, /never the model/);
    says("eff.once", /once/i);
    says("eff.part", /part that matters/i);
    says("eff.cheap", /cheapest/i);
    says("eff.stop", /stop when/i);
    says("code.style", /conventions/i);
    says("code.small", /smallest/i);
    says("code.green", /tests green/i);
    says("code.ci", /\.github\/workflows/);
    says("code.impact", /impact/i);
    says("code.cite", /file path/i, /line/i, /does not show/i);
    says("vis.show", /show/i, /visual/i);
    says("vis.skip", /short fact/i, /voice-only/i);
    says("vis.look", /look/i, /components/i);
    says("vis.cheap", /cheapest visual/i, /table/, /page/);
    says("res.cite", /cite every claim/i);
    says("res.official", /official/i);
    says("res.dated", /date/i, /version/i);
    says("media.evidence", /evidence/i, /what is there/i);
    says("media.once", /once/i, /summary/i);
    says("out.contract", /output contract exactly/i);
    says("out.json", /JSON only when asked/i);
    says("out.short", /short by default/i);
  });

  it("orders ids as the groups list them, and refuses an id it does not have", () => {
    const ids = PRINCIPLES.map((p) => p.id);
    expect(ids.map((id) => orderOf(id))).toEqual(ids.map((_, i) => i));
    expect(() => principleText("core.nothing" as never)).toThrow(/no such principle/);
  });
});

describe("the roles", () => {
  it("name principles that exist, once each", () => {
    const known = new Set(PRINCIPLES.map((p) => p.id));
    for (const id of ROLE_IDS) {
      const list: readonly string[] = ROLES[id].principles;
      expect(list.length, id).toBeGreaterThan(0);
      expect(new Set(list).size, `${id} lists a principle twice`).toBe(list.length);
      for (const p of list) expect(known.has(p), `${id} names ${p}`).toBe(true);
    }
  });

  it("have a one-line identity and a contract that is a schema, not an example", () => {
    for (const id of ROLE_IDS) {
      const r = ROLES[id];
      expect(r.identity, id).not.toContain("\n");
      expect(r.identity.length, id).toBeGreaterThan(20);
      expect(r.identity.length, id).toBeLessThan(260);
      expect(r.contract.trim().length, id).toBeGreaterThan(20);
      expect(r.contract, id).not.toMatch(EXAMPLE_MARKERS);
      expect(r.contract, id).not.toMatch(/\bInput:|\bOutput:/);
    }
  });

  it("put the rules that matter in the roles that need them", () => {
    const has = (role: (typeof ROLE_IDS)[number], id: string) => (ROLES[role].principles as readonly string[]).includes(id);
    // everything that reads outside text is told it is data; the two that read pictures are told a picture is evidence
    for (const id of ROLE_IDS) {
      if (id === "artifact_vision" || id === "artifact_compare") expect(has(id, "media.evidence"), id).toBe(true);
      else expect(has(id, "safe.data"), id).toBe(true);
    }
    // a JSON role says JSON only, and says it is the library's line the gateway would otherwise add
    for (const id of ROLE_IDS) if (/^\{/.test(ROLES[id].contract)) expect(has(id, "out.json"), id).toBe(true);
    // the agent carries the code and the cost and the safety rules
    for (const id of ["safe.secrets", "safe.rules", "eff.once", "eff.cheap", "eff.stop", "code.green", "code.ci", "code.impact", "code.small", "code.style"]) expect(has("agent_work", id), id).toBe(true);
    // the planner never touches a workflow
    expect(has("plan_change", "code.ci")).toBe(true);
    // research cites
    expect(has("research_answer", "res.cite")).toBe(true);
    expect(has("brief", "res.cite")).toBe(true);
    // the pictures are evidence
    expect(has("artifact_vision", "media.evidence")).toBe(true);
    expect(has("artifact_compare", "media.evidence")).toBe(true);
  });

  it("are all used, and every principle is used by a role (the visuals' are the front door's)", () => {
    const used = new Set(ROLE_IDS.flatMap((id) => ROLES[id].principles as readonly string[]));
    const unused = PRINCIPLES.map((p) => p.id).filter((id) => !used.has(id));
    expect(unused).toEqual([]);
    expect(isRoleId("classify")).toBe(true);
    expect(isRoleId("front_decide")).toBe(true);
    expect(isRoleId("nobody")).toBe(false);
    // The main assistant's roles (agent/, pipeline/): found by name, and counted by the table, never by a number written here.
    for (const id of ["ask_planner", "ask_vision", "writer", "edit_selection", "answer_about", "converse", "portrait_update", "portrait_transcript", "portrait_usage"]) expect(isRoleId(id), id).toBe(true);
    expect(new Set(ROLE_IDS).size).toBe(ROLE_IDS.length);
  });
});

describe("compose", () => {
  it("is deterministic: the same role gives the same bytes, however many times and with whatever after it", () => {
    for (const id of ROLE_IDS) {
      const a = compose(id)[0]!;
      const b = compose(id, [{ role: "user" as const, content: "something else entirely" }])[0]!;
      const c = compose(id, [{ role: "user" as const, content: "and another" }, { role: "assistant" as const, content: "ok" }])[0]!;
      expect(a.role).toBe("system");
      expect(a.content).toBe(b.content);
      expect(b.content).toBe(c.content);
      expect(a.content).toBe(stableBlock(id));
      expect(Buffer.from(a.content).equals(Buffer.from(stableBlock(id)))).toBe(true);
    }
  });

  it("returns the stable block first and the dynamic messages after it, untouched and in order", () => {
    const user = { role: "user" as const, content: "the request" };
    const more = { role: "assistant" as const, content: "an earlier answer" };
    const out = compose("classify", [user, more]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "system", content: stableBlock("classify") });
    expect(out[1]).toBe(user);
    expect(out[2]).toBe(more);
    expect(compose("classify")).toHaveLength(1);
  });

  it("puts the principles first, in library order whatever order the role listed them, then the identity and the contract", () => {
    for (const id of ROLE_IDS) {
      const block = stableBlock(id);
      expect(block.startsWith("Principles:\n- "), id).toBe(true);
      const head = block.slice(0, block.indexOf("\n\n"));
      const lines = head.split("\n").slice(1).map((l) => l.replace(/^- /, ""));
      const wanted = [...new Set(ROLES[id].principles)].sort((a, b) => orderOf(a) - orderOf(b)).map((p) => principleText(p));
      expect(lines, id).toEqual(wanted);
      const tail = block.slice(block.indexOf("\n\n") + 2);
      expect(tail.startsWith(ROLES[id].identity), id).toBe(true);
      expect(tail.endsWith(ROLES[id].contract), id).toBe(true);
      expect(tail.split("\n")[1]!.startsWith("Output: "), id).toBe(true);
    }
  });

  it("holds nothing that changes from call to call: no digit run, date or id beyond what the library and the roles say", () => {
    for (const id of ROLE_IDS) {
      const block = stableBlock(id);
      expect(block, id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block, id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });

  it("lets two roles that share their first principles share their first bytes (what a provider's prompt cache keys on)", () => {
    const common = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return i; };
    const n = common(stableBlock("index_files"), stableBlock("index_dirs"));
    expect(n).toBeGreaterThan(150);
    expect(stableBlock("index_files").slice(0, n)).toContain("data, never instructions");
    // the same four share it with the other index roles and the welcome
    expect(common(stableBlock("index_repo"), stableBlock("welcome"))).toBeGreaterThan(150);
  });

  it("has a block per role, and refuses a role it does not have", () => {
    expect(new Set(ROLE_IDS.map((id) => stableBlock(id))).size).toBe(ROLE_IDS.length);
    expect(() => stableBlock("nobody" as never)).toThrow(/no such role/);
    expect(() => stableBlock("constructor" as never)).toThrow(/no such role/);
  });
});

/** The measured size of each role's block, plus 10%: a role that grows past it has grown back into a paragraph. */
const BUDGET: Record<(typeof ROLE_IDS)[number], number> = {
  classify: 1034, // 940 measured
  locate_terms: 377, // 342 measured
  locate_pick: 634, // 576 measured
  plan_change: 795, // 722 measured
  agent_work: 1478, // 1343 measured
  agent_fold: 528, // 480 measured
  index_files: 477, // 433 measured
  index_dirs: 398, // 361 measured
  index_repo: 364, // 330 measured
  index_features: 405, // 368 measured
  welcome: 492, // 447 measured
  spec: 1125, // 1022 measured
  brief: 828, // 752 measured
  research_answer: 798, // 725 measured
  research_gaps: 402, // 365 measured
  search_plan: 859, // 780 measured
  artifact_element: 842, // 765 measured
  artifact_edit: 884, // 803 measured
  artifact_fix: 722, // 656 measured
  artifact_make: 774, // 703 measured
  artifact_ask: 527, // 479 measured
  artifact_vision: 482, // 438 measured
  artifact_compare: 942, // 856 measured
  front_decide: 1606, // 1460 measured
  front_reply: 1173, // 1066 measured
  front_code_answer: 1174, // 1067 measured
  front_diagram: 612, // 556 measured
  front_plan: 735, // 668 measured
  front_look: 646, // 587 measured
  care_review: 1565, // 1422 measured
  care_conflict: 767, // 697 measured
  ask_planner: 4904, // 4458 measured
  ask_vision: 4519, // 4108 measured
  writer: 4322, // 3929 measured
  edit_selection: 1756, // 1596 measured
  answer_about: 805, // 731 measured
  converse: 867, // 788 measured
  portrait_update: 3667, // 3333 measured
  portrait_transcript: 3647, // 3315 measured
  portrait_usage: 3945, // 3586 measured
};

describe("the size of a role", () => {
  it("stays inside its budget", () => {
    expect(Object.keys(BUDGET).sort()).toEqual([...ROLE_IDS].sort());
    for (const id of ROLE_IDS) expect(stableBlock(id).length, id).toBeLessThanOrEqual(BUDGET[id]);
  });

  it("is smaller in total than what it replaced, and no role is more than a tenth bigger (the front door's roles replace nothing: their first size is their 'before')", () => {
    const list = rows();
    const replaced = list.filter((r) => !(NEW_ROLES as readonly string[]).includes(r.role));
    expect(replaced).toHaveLength(ROLE_IDS.length - NEW_ROLES.length);
    const total = totals(replaced);
    // The 23 roles of the first sweep saved 32%. The nine of the main assistant (agent/, pipeline/) saved 14% between them: the writer and
    // the helpers were already principles-shaped, and now also carry the library's lines; what they gained is a block that is the same for
    // everyone (docs/principles.md, section 9). So the whole, with them, must still be a fifth smaller.
    expect(total.afterChars).toBeLessThan(total.beforeChars * 0.8);
    expect(total.afterTokens).toBeLessThan(total.beforeTokens);
    for (const r of list) expect(r.afterChars, r.role).toBeLessThanOrEqual(r.beforeChars * 1.1);
    // the agent's prompt is sent on every turn of a job: it is the one that matters most
    const agent = list.find((r) => r.role === "agent_work")!;
    expect(agent.afterChars).toBeLessThan(agent.beforeChars * 0.6);
  });
});

describe("the contracts say what the parsers read", () => {
  /** The names of a zod object's fields, and of the objects nested in its arrays. */
  const fieldsOf = (schema: unknown, depth = 0): string[] => {
    const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
    if (!shape) return [];
    return Object.entries(shape).flatMap(([k, v]) => [k, ...(depth < 2 ? fieldsOf(innerOf(v), depth + 1) : [])]);
  };
  const innerOf = (v: unknown): unknown => {
    let cur: any = v;
    for (let i = 0; i < 6 && cur; i += 1) {
      if (cur.shape) return cur;
      const def = cur._def;
      cur = def?.innerType ?? def?.type ?? def?.schema ?? cur.element ?? undefined;
    }
    return cur;
  };

  const SCHEMAS: Array<[(typeof ROLE_IDS)[number], unknown]> = [
    ["classify", ModelClassification],
    ["locate_terms", SynonymReply],
    ["locate_pick", PickReply],
    ["plan_change", PlanReply],
    ["agent_fold", FoldReply],
    ["index_files", FileSchema],
    ["index_dirs", DirSchema],
    ["index_repo", OverviewSchema],
    ["index_features", FeatureSchema],
    ["welcome", WelcomeSchema],
    ["spec", SpecReply],
    ["brief", Weighed],
    ["research_gaps", GapSchema],
    ["search_plan", ModelPlan],
    ["artifact_compare", VerdictSchema],
    ["front_decide", DecideReply],
    ["front_plan", FrontPlanReply],
    ["care_review", ReviewVerdict],
    ["care_conflict", ConflictVerdict],
  ];

  it("name every field of the schema the answer is read with", () => {
    for (const [role, schema] of SCHEMAS) {
      const fields = [...new Set(fieldsOf(schema))];
      expect(fields.length, role).toBeGreaterThan(0);
      const contract = ROLES[role].contract;
      for (const f of fields) expect(contract, `${role} names ${f}`).toMatch(new RegExp(`"${f}"`));
    }
  });

  /** The roles whose JSON is read by hand, not by a zod schema: the portrait writers (portraitDimensions.parsePortraitDraft keeps only what is well-formed). */
  const READ_BY_HAND = ["portrait_update", "portrait_transcript", "portrait_usage"];

  it("are the JSON roles: every role that names a schema asks for JSON, and the rest do not", () => {
    const withSchema = new Set<string>(SCHEMAS.map(([r]) => r));
    for (const id of ROLE_IDS) {
      const asksJson = (ROLES[id].principles as readonly string[]).includes("out.json");
      expect(asksJson, id).toBe(withSchema.has(id) || READ_BY_HAND.includes(id));
    }
  });

  it("name every field the portrait reader keeps", () => {
    for (const id of READ_BY_HAND) {
      for (const f of ["core", "words", "styles", "rhythms", "toneNote", "term", "means", "name", "when", "vibe"]) {
        expect(ROLES[id as never as keyof typeof ROLES].contract, `${id} names ${f}`).toContain(`"${f}"`);
      }
    }
  });

  it("spell out the code's own lists", () => {
    const c = ROLES.classify.contract;
    for (const t of REQUEST_TYPES) expect(c, t).toContain(t);
    expect(c).toContain(LEVELS.join("|"));
    expect(c).toContain(LANGUAGES.join("|"));
    const s = ROLES.search_plan.contract;
    expect(s).toContain(INTENTS.join("|"));
    for (const src of DIRECT_SOURCES) expect(s, src).toContain(src);
    // the front door's reader of a message says the code's own intents, lengths and visuals
    const d = ROLES.front_decide.contract;
    expect(d).toContain(FRONT_INTENTS.join("|"));
    expect(d).toContain(FRONT_LENGTHS.join("|"));
    expect(d).toContain(["none", ...VISUAL_KINDS].join("|"));
    // the sandbox every artifact role says is the one the viewer enforces
    for (const role of ["artifact_element", "artifact_edit", "artifact_fix", "artifact_make"] as const) {
      for (const lib of ARTIFACT_LIBS) expect(ROLES[role].contract, `${role} names ${lib}`).toContain(lib);
    }
    // the welcome's length is what clampWelcome leaves room for
    expect(ROLES.welcome.contract).toContain(`${WELCOME_CHARS - 100} characters`);
    expect(ROLES.spec.contract).toMatch(/six musts/);
  });

  it("end the research answer with the GAPS line splitGaps reads, and the artifact roles with the tags their parsers read", () => {
    expect(ROLES.research_answer.contract).toMatch(/GAPS: a; b/);
    expect(ROLES.research_answer.contract).toMatch(/GAPS: none/);
    for (const role of ["artifact_element", "artifact_edit", "artifact_fix"] as const) expect(ROLES[role].contract).toContain("<edit><old>");
    expect(ROLES.artifact_edit.contract).toContain("<rewrite>");
    expect(ROLES.artifact_fix.contract).toContain("<cannot>");
    expect(ROLES.artifact_element.contract).toMatch(/WHOLE ELEMENT form/);
    expect(ROLES.artifact_element.contract).toMatch(/REPLACEMENTS form/);
  });
});

describe("the main assistant's roles (agent/, pipeline/)", () => {
  it("Ask's planner lists every command the device reads, and each one parses", async () => {
    const { parseLine: parse } = await import("../src/agent/lines.js");
    const block = stableBlock("ask_planner");
    const SAMPLES: Record<string, string> = {
      SAY: "SAY hello", POINT: "POINT e1 | here", STEPS: "STEPS a ; b", PRESS: "PRESS e1", SET: "SET e1 | x", TYPE: "TYPE x", WRITE: "WRITE a note", REWRITE: "REWRITE shorter",
      KEY: "KEY enter", SCROLL: "SCROLL down", FOCUS: "FOCUS e1", OPEN: "OPEN Notes", ASK: "ASK which one?", LOOK: "LOOK the chart", DRAW: "DRAW BOX e1", DONE: "DONE",
    };
    for (const [verb, line] of Object.entries(SAMPLES)) {
      expect(block, verb).toMatch(new RegExp(`^${verb}\\b`, "m"));
      expect(parse(line, "mac"), line).not.toBeNull();
    }
    // The picture reader only answers: it lists no action.
    const vision = stableBlock("ask_vision");
    for (const verb of ["SAY", "POINT", "DRAW", "DONE"]) expect(vision, verb).toMatch(new RegExp(`^${verb}\\b`, "m"));
    for (const verb of ["PRESS", "TYPE", "KEY", "LOOK", "ASK", "OPEN", "SET", "FOCUS", "SCROLL", "WRITE", "REWRITE", "STEPS"]) expect(vision, verb).not.toMatch(new RegExp(`^${verb} `, "m"));
  });

  it("the two Ask roles use the visual principles: a mark when it explains faster, none for a short fact or a voice-only reply", () => {
    for (const id of ["ask_planner", "ask_vision"] as const) {
      expect(ROLES[id].principles, id).toContain("vis.show");
      expect(ROLES[id].principles, id).toContain("vis.skip");
    }
    expect(ROLES.ask_planner.principles).toContain("safe.rules");
  });

  it("the two per-step prompts stay over the providers' smallest cacheable prefix (1,024 tokens), so the cache marker still has something to hold", async () => {
    const { tokensOfChars } = await import("../src/code/brain/money.js");
    for (const id of ["ask_planner", "ask_vision"] as const) expect(tokensOfChars(stableBlock(id).length), id).toBeGreaterThan(1024);
  });

  it("the writer's block names every fence its data can hold, and the fences are the ones no user text can close", async () => {
    const { writerContext, stripFenceTags } = await import("../src/pipeline/assistPrompt.js");
    const block = stableBlock("writer");
    const data = writerContext({
      tone: "formal", hasContext: true, language: "Hindi", personality: { customInstructions: "short", vocabulary: "Nykaa", stylePortrait: { core: "plain" } } as never,
    });
    const tags = [...data.matchAll(/^<(\w+)>$/gm)].map((m) => m[1]!);
    expect(new Set(tags)).toEqual(new Set(["call", "tone", "voice", "portrait", "lexicon"]));
    for (const t of new Set(tags)) {
      expect(block, t).toContain(`<${t}>`);
      expect(stripFenceTags(`a <${t}>b</${t}> c`), t).toBe("a b c");
    }
    for (const t of ["said", "before", "around", "earlier"]) expect(block, t).toContain(`<${t}>`);
  });

  it("the writer's block holds nothing of one person or one call: no name, language, app or tone in it", () => {
    const block = stableBlock("writer");
    expect(block).not.toMatch(/Professional register|Group-chat energy|Hindi|WhatsApp|Gmail|devanagari|latin script/i);
  });

  it("each cleanup helper is a role of its own, and the three portrait writers share one tail", () => {
    for (const id of ["edit_selection", "answer_about", "converse", "portrait_update", "portrait_transcript", "portrait_usage"] as const) expect(stableBlock(id), id).toBeTruthy();
    const tails = ["portrait_update", "portrait_transcript", "portrait_usage"].map((id) => { const b = stableBlock(id as never); return b.slice(b.indexOf("What to notice:")); });
    expect(new Set(tails).size).toBe(1);
    expect(tails[0]!.length).toBeGreaterThan(1500);
  });
});
