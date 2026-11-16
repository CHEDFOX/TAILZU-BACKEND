/**
 * WHAT THE PROJECT ALREADY LOOKS LIKE, SHOWN TO A JOB ON FILES PEOPLE SEE (phases.ts lookOf, context.ts).
 *
 * `designKit` has always known how to read a project's real look — its Tailwind config and CSS variables, its shadcn or MUI theme, its fonts, its
 * icon library, its own components and their props — with no model, from a dozen files, cached against the brain's head. Until now only the
 * build-an-approved-design path used it, so an ordinary frontend job was TOLD to use the project's own components and never SHOWN what they were.
 *
 * What these hold down:
 *   - a job that touches a page is shown the look, and it rides in the task message where the model will read it;
 *   - A JOB NOBODY SEES IS SHOWN NOTHING: the kit is not even read, so an ordinary backend job pays nothing for this;
 *   - it is read ONCE, at the start of work, not once a round — the context is cached, and a block that moved would cost the job its prefix;
 *   - no store to read it with, or a read that throws, and the job goes on in silence: a job that cannot see the look must still do the work.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, APP_FILES, APP_STRUCTURE, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { sym, route } = await import("./work-fixtures.js");

/** A project with a real look to read: Tailwind tokens, a CSS variable block, and components of its own. */
const FILES: Record<string, string> = {
  ...APP_FILES,
  "tailwind.config.js": "module.exports = { theme: { extend: { colors: { primary: '#0ea5e9', ink: '#0b1220' }, borderRadius: { card: '14px' } } } };\n",
  "src/styles/globals.css": ":root { --primary: #0ea5e9; --ink: #0b1220; --radius: 14px; }\n",
  "src/components/PricingCard.tsx": "export function PricingCard({ title }: { title: string }) { return <div className=\"card\">{title}</div>; }\n",
  "src/pages/Pricing.tsx": 'import { PricingCard } from "../components/PricingCard";\nexport default function Pricing() { return <PricingCard title="Pro" />; }\n',
};
const ROWS = [
  { path: "src/util.ts", symbols: [sym("slug")], tests: ["src/util.test.ts"], summary: "String helpers.", rank: 0.8 },
  { path: "src/util.test.ts", summary: "Tests for the string helpers." },
  { path: "src/components/PricingCard.tsx", symbols: [sym("PricingCard", "component")], summary: "The pricing card.", rank: 0.9 },
  { path: "src/pages/Pricing.tsx", imports: ["src/components/PricingCard.tsx"], symbols: [route("GET", "/pricing"), sym("Pricing", "component")], summary: "The pricing page." },
];
const STRUCTURE = { ...APP_STRUCTURE, frameworks: ["React", "Vite", "Tailwind"] };
const CARD_EDIT = { path: "src/components/PricingCard.tsx", old: ">{title}<", new: ">{title} — ₹499<" };
/** A plan whose one step is on a page people see, so the job counts as UI work. */
const CARD_PLAN = { steps: [{ n: 1, do: "Show the price on the card", files: [{ path: "src/components/PricingCard.tsx", action: "edit" }] }], notes: [] as string[] };
/** A request that names the card, so locating needs no model. */
const CARD_TASK = "In src/components/PricingCard.tsx show the price on the card";

async function setup(o: { kit?: boolean | "broken"; plan?: unknown } = {}) {
  const store = new MemoryArtifactStore();
  const reads: string[] = [];
  const kit = o.kit === false ? undefined
    : o.kit === "broken"
      ? { getKit: async () => { throw new Error("the kit store is down"); }, putKit: async () => { throw new Error("the kit store is down"); } }
      : {
        getKit: async (id: string) => { reads.push(id); return store.getKit(id); },
        putKit: (id: string, u: string, head: string, k: unknown) => store.putKit(id, u, head, k),
      };
  const r = await agentRig({ files: FILES, rows: ROWS, structure: STRUCTURE, ...(kit ? { kit } : {}) });
  r.json.on("work.plan", o.plan ?? CARD_PLAN);
  const { job } = await r.start(o.plan === UTIL_PLAN ? UTIL_TASK : CARD_TASK);
  return { r, reads, store, jobId: job.id };
}

/** Every task message the work turns were actually sent. */
const taskSent = (r: Awaited<ReturnType<typeof setup>>["r"]): string => r.model.seen.map((t) => t.user).join("\n");

describe("a job on a page people see", () => {
  it("is shown the project's own tokens and components, in the task message", async () => {
    const s = await setup();
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price on the card."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.work.look, "the look was read").toBeTruthy();
    // The project's real values, not invented ones.
    expect(st.work.look).toMatch(/0ea5e9|primary/i);
    expect(st.work.look).toMatch(/PricingCard/);
    const sent = taskSent(s.r);
    expect(sent).toContain("What this project already looks like");
    expect(sent).toContain("<tool_data tool=\"project_look\">");
  });

  it("reads it once, not once a round: a block that moved would cost the job its cached prefix", async () => {
    const s = await setup();
    s.r.model.push(call("read_file", { path: "src/components/PricingCard.tsx" }), call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    // Several rounds, one read of the kit.
    expect(s.reads).toHaveLength(1);
  });
});

describe("a job nobody sees", () => {
  it("is shown nothing, and the kit is never even read", async () => {
    const s = await setup({ plan: UTIL_PLAN });
    s.r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed the dashes."));
    await s.r.orch.idle();
    const st = await s.r.stateNow(s.jobId);
    expect(st.work.look).toBe("");
    expect(s.reads).toHaveLength(0);
    expect(taskSent(s.r)).not.toContain("What this project already looks like");
  });
});

describe("when the look cannot be read", () => {
  it("goes on in silence, with no store at all", async () => {
    const s = await setup({ kit: false });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect((await s.r.stateNow(s.jobId)).work.look).toBe("");
    expect(taskSent(s.r)).not.toContain("What this project already looks like");
  });

  it("goes on in silence when the store throws, and still commits", async () => {
    const s = await setup({ kit: "broken" });
    s.r.model.push(call("edit_file", CARD_EDIT), done("Showed the price."));
    await s.r.orch.idle();
    expect((await s.r.jobNow(s.jobId)).state).toBe("done");
    expect(s.r.fake.commitCount(s.r.repo)).toBe(2);
  });
});
