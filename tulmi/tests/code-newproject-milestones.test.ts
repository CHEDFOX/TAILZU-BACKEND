/**
 * MILESTONES (src/code/newproject/milestones.ts): a branch and a draft pull request each, with the checklist and the work
 * log in the description, and the host's preview link if there is one.
 *
 * Pure parts against rows we chose (branch names, preview detection, the body); the GitHub parts against the fake GitHub
 * (tests/github-fake.ts), whose deployments, statuses and check runs are served by a wrapper around its fetch, since the
 * fake keeps no hosts. Nothing reaches a network.
 *
 * What these hold down:
 *   - the branch is `tailzu/m<k>-<slug>`, always one the policy treats as Tailzu's; a branch of that name that Tailzu did
 *     not make is left alone;
 *   - a preview is a host's address for the commit: not production, not a dashboard, not http, not a link with credentials;
 *     deployments before statuses before check runs, and the address inside a check run's words when its link is the dashboard;
 *   - with no preview there is one tip, once per project, and a store that cannot remember it says it again rather than fail;
 *   - the pull request is a draft; opened once, and rewritten (description only) after, with the work log in it;
 *   - what GitHub will not answer (no permission on the App) is "no preview", never an error.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

noNetwork();

const { githubRig } = await import("./work-fixtures.js");
const {
  MILESTONE_BRANCH, milestoneSlug, milestoneBranch, hostOf, detectPreview, previewFor, previewOrTip, PREVIEW_TIP, milestoneBody, milestoneTitle,
  startMilestone, openMilestonePr, checksOf,
} = await import("../src/code/newproject/milestones.js");
const { MemoryIntakeStore } = await import("../src/code/newproject/intakeStore.js");
const { planMilestones, checksFor } = await import("../src/code/newproject/planDoc.js");
const { chooseStack } = await import("../src/code/newproject/spec.js");
const { commitToBranch, repoRef } = await import("../src/code/projects.js");
const { validBranchName } = await import("../src/code/github.js");
type PreviewSignals = import("../src/code/github.js").PreviewSignals;
type PlanMilestone = import("../src/code/newproject/types.js").PlanMilestone;

const none = (): Pick<PreviewSignals, "deployments" | "statuses" | "checks"> => ({ deployments: [], statuses: [], checks: [] });
const check = (o: Partial<PreviewSignals["checks"][number]> = {}): PreviewSignals["checks"][number] => ({
  name: "Vercel", app: "vercel", status: "completed", conclusion: "success", url: "https://vercel.com/acme/app/abc", title: "", summary: "", ...o,
});

const M0: PlanMilestone = {
  k: 0, title: "Scaffold, CI and preview", scope: ["Set up Next.js.", "Add CI."], acceptance: ["The app starts locally.", "CI runs on every pull request."], checks: ["npx tsc --noEmit", "npm run build"],
};

// ------------------------------------------------------------------- the branch

describe("milestone branch names", () => {
  it("is tailzu/m<k>-<slug>", () => {
    expect(milestoneBranch(0, "Scaffold, CI and preview")).toBe("tailzu/m0-scaffold-ci-and-preview");
    expect(milestoneBranch(3, "Core: Book a class, Pay")).toBe("tailzu/m3-core-book-a-class-pay");
    expect(milestoneBranch(12, "Launch readiness")).toBe("tailzu/m12-launch-readiness");
  });

  it("the slug is ASCII words in lower case, 32 characters at most, with no dash at the end", () => {
    expect(milestoneSlug("  Hello   WORLD!! ")).toBe("hello-world");
    const long = milestoneSlug("Core: Authentication, Authorisation and Account Recovery");
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("-")).toBe(false);
    expect(long).toBe("core-authentication-authorisatio");
  });

  it("is work when no word is left, and a number that cannot be a milestone is m0", () => {
    expect(milestoneSlug("योग क्लास")).toBe("work");
    expect(milestoneSlug("")).toBe("work");
    expect(milestoneBranch(0, "!!!")).toBe("tailzu/m0-work");
    for (const k of [-1, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(milestoneBranch(k, "x")).toBe("tailzu/m0-x");
  });

  it("is always a branch GitHub accepts and the milestone pattern knows", () => {
    for (const [k, t] of [[0, "Scaffold, CI and preview"], [7, "a/b\\c..d"], [9, "ünïcödé ✓ title 123"], [4, "-- -- --"], [2, "x".repeat(200)]] as const) {
      const b = milestoneBranch(k, t);
      expect(validBranchName(b), b).toBe(true);
      expect(MILESTONE_BRANCH.test(b), b).toBe(true);
    }
  });

  it("the pattern does not take other tailzu branches", () => {
    for (const b of ["tailzu/fix-the-login-1a2b", "tailzu/m0", "tailzu/m0-", "tailzu/mx-1", "main", "tailzu/m100-x", "tailzu/m1-UPPER"]) expect(MILESTONE_BRANCH.test(b), b).toBe(false);
  });

  it("the title of the pull request is M<k>: and the title, cut at 120", () => {
    expect(milestoneTitle(M0)).toBe("M0: Scaffold, CI and preview");
    expect(milestoneTitle({ ...M0, title: "t".repeat(300) }).length).toBeLessThanOrEqual(120);
  });

  it("checksOf is the stack's checks", () => {
    expect(checksOf("fastapi")).toEqual(checksFor("fastapi"));
  });
});

// ------------------------------------------------------------------- previews

describe("hostOf", () => {
  it("names the three hosts and calls anything else other", () => {
    expect(hostOf("https://app-git-m0-acme.vercel.app")).toBe("vercel");
    expect(hostOf("https://deploy-preview-3--app.netlify.app/")).toBe("netlify");
    expect(hostOf("https://abc123.app.pages.dev")).toBe("cloudflare");
    expect(hostOf("https://app.acme.workers.dev")).toBe("cloudflare");
    expect(hostOf("https://app.onrender.com")).toBe("other");
    expect(hostOf("not a url")).toBe("other");
  });
});

describe("detectPreview", () => {
  it("is a successful deployment that is not production", () => {
    const p = detectPreview({ ...none(), deployments: [
      { environment: "Production", url: "https://app.example.com", state: "success" },
      { environment: "Preview", url: "https://app-git-m0-acme.vercel.app", state: "success" },
    ] });
    expect(p).toEqual({ url: "https://app-git-m0-acme.vercel.app/", via: "deployment", host: "vercel" });
  });

  it("not one that is still building, failed, or is production", () => {
    for (const d of [
      { environment: "Preview", url: "https://a.vercel.app", state: "pending" },
      { environment: "Preview", url: "https://a.vercel.app", state: "failure" },
      { environment: "production", url: "https://a.vercel.app", state: "success" },
      { environment: " Production ", url: "https://a.vercel.app", state: "success" },
    ]) expect(detectPreview({ ...none(), deployments: [d] }), JSON.stringify(d)).toBeNull();
  });

  it("not a dashboard, not http, not an address with a login in it, not nothing", () => {
    for (const url of [
      "https://vercel.com/acme/app/deployments/abc", "https://app.netlify.com/sites/x/deploys/1", "https://dash.cloudflare.com/x", "https://github.com/acme/app/deployments",
      "http://a.vercel.app", "https://user:pass@a.vercel.app", "ftp://a.vercel.app", "", "not a url", `https://a.vercel.app/${"x".repeat(400)}`,
    ]) expect(detectPreview({ ...none(), deployments: [{ environment: "Preview", url, state: "success" }] }), url).toBeNull();
  });

  it("takes the first deployment that has an address a person can open", () => {
    const p = detectPreview({ ...none(), deployments: [
      { environment: "Preview", url: "https://vercel.com/dash", state: "success" },
      { environment: "Preview", url: "https://second.netlify.app", state: "success" },
    ] });
    expect(p).toMatchObject({ url: "https://second.netlify.app/", host: "netlify" });
  });

  it("any other https address a deployment names is a preview (a host of the person's own)", () => {
    expect(detectPreview({ ...none(), deployments: [{ environment: "pr-12", url: "https://pr-12.staging.acme.dev/", state: "success" }] })).toEqual({ url: "https://pr-12.staging.acme.dev/", via: "deployment", host: "other" });
  });

  it("is a successful status from something that looks like a host", () => {
    const p = detectPreview({ ...none(), statuses: [
      { context: "ci/circleci: build", state: "success", url: "https://circleci.com/gh/acme/app/12" },
      { context: "netlify/acme-app/deploy-preview", state: "pending", url: "https://deploy-preview-3--acme-app.netlify.app" },
      { context: "netlify/acme-app/deploy-preview", state: "success", url: "https://deploy-preview-3--acme-app.netlify.app" },
    ] });
    expect(p).toEqual({ url: "https://deploy-preview-3--acme-app.netlify.app/", via: "status", host: "netlify" });
    expect(detectPreview({ ...none(), statuses: [{ context: "ci/circleci", state: "success", url: "https://circleci.com/x" }] })).toBeNull();
  });

  it("is a successful, finished check run from a host; its own link is the dashboard, so the address is looked for in its words", () => {
    const p = detectPreview({ ...none(), checks: [check({ summary: "Deployed.\n[Visit Preview](https://acme-app-git-m0.vercel.app) or see https://vercel.com/acme/app" })] });
    expect(p).toEqual({ url: "https://acme-app-git-m0.vercel.app/", via: "check", host: "vercel" });
    expect(detectPreview({ ...none(), checks: [check({ title: "Ready: https://x.pages.dev.", app: "cloudflare-pages", name: "Pages" })] })).toMatchObject({ url: "https://x.pages.dev/", host: "cloudflare" });
    // the check's own link, when it is not a dashboard
    expect(detectPreview({ ...none(), checks: [check({ url: "https://abc.netlify.app" })] })).toMatchObject({ url: "https://abc.netlify.app/", via: "check" });
  });

  it("not a check run that is not finished or did not succeed, or is not a host's, or whose words have no host address", () => {
    expect(detectPreview({ ...none(), checks: [check({ status: "in_progress", conclusion: null, summary: "https://a.vercel.app" })] })).toBeNull();
    expect(detectPreview({ ...none(), checks: [check({ conclusion: "failure", summary: "https://a.vercel.app" })] })).toBeNull();
    expect(detectPreview({ ...none(), checks: [check({ name: "unit tests", app: "github-actions", summary: "https://a.vercel.app" })] })).toBeNull();
    expect(detectPreview({ ...none(), checks: [check({ summary: "see https://example.com/docs and https://github.com/acme/app" })] })).toBeNull();
  });

  it("deployments come before statuses, and statuses before check runs", () => {
    const sig = {
      deployments: [{ environment: "Preview", url: "https://dep.vercel.app", state: "success" }],
      statuses: [{ context: "vercel", state: "success", url: "https://sta.vercel.app" }],
      checks: [check({ url: "https://chk.vercel.app" })],
    };
    expect(detectPreview(sig)?.via).toBe("deployment");
    expect(detectPreview({ ...sig, deployments: [] })?.via).toBe("status");
    expect(detectPreview({ ...sig, deployments: [], statuses: [] })?.via).toBe("check");
    expect(detectPreview(none())).toBeNull();
  });
});

describe("previewFor", () => {
  it("is null, not an error, when GitHub cannot say", async () => {
    const boom = { previewSignals: async () => { throw new Error("403"); } };
    expect(await previewFor(boom, { fullName: "a/b" } as never, "a".repeat(40))).toBeNull();
    const ok = { previewSignals: async (): Promise<PreviewSignals> => ({ ...none(), deployments: [{ environment: "Preview", url: "https://a.vercel.app", state: "success" }], denied: [] }) };
    expect(await previewFor(ok, { fullName: "a/b" } as never, "a".repeat(40))).toMatchObject({ host: "vercel" });
  });
});

describe("the one-time tip", () => {
  it("is given with no preview, once per project, and not when there is one", async () => {
    const store = new MemoryIntakeStore(() => 1);
    const preview = { url: "https://a.vercel.app/", via: "deployment" as const, host: "vercel" as const };
    expect(await previewOrTip(preview, "p1", "u1", store)).toEqual({ preview });
    expect(await store.get("p1")).toBeNull();

    expect(await previewOrTip(null, "p1", "u1", store)).toEqual({ tip: PREVIEW_TIP });
    expect(await previewOrTip(null, "p1", "u1", store)).toEqual({});
    expect((await store.get("p1"))!.tips).toEqual(["preview"]);
    // another project is told on its own
    expect(await previewOrTip(null, "p2", "u1", store)).toEqual({ tip: PREVIEW_TIP });
  });

  it("is kept beside what the intake already holds and does not replace it", async () => {
    const store = new MemoryIntakeStore(() => 1);
    await store.save("p1", "u1", { state: "done", request: "a yoga site", answers: { platform: "web" } });
    await previewOrTip(null, "p1", "u1", store);
    expect(await store.get("p1")).toMatchObject({ state: "done", request: "a yoga site", answers: { platform: "web" }, tips: ["preview"] });
  });

  it("is said again, not failed, when the store cannot remember", async () => {
    const broken = { get: async () => { throw new Error("db down"); }, save: async () => { throw new Error("db down"); }, delete: async () => {} };
    expect(await previewOrTip(null, "p1", "u1", broken)).toEqual({ tip: PREVIEW_TIP });
    const half = { get: async () => null, save: async () => { throw new Error("db down"); }, delete: async () => {} };
    expect(await previewOrTip(null, "p1", "u1", half)).toEqual({ tip: PREVIEW_TIP });
  });

  it("names the hosts and says it is free to start", () => {
    expect(PREVIEW_TIP).toMatch(/Vercel, Netlify or Cloudflare Pages/);
    expect(PREVIEW_TIP).toMatch(/free to start/);
  });
});

// ------------------------------------------------------------------- the body

describe("milestoneBody", () => {
  it("starts with the milestone, then the checklist the person is asked to check, then the checks and the scope", () => {
    const body = milestoneBody(M0);
    expect(body.split("\n").filter((l) => l.startsWith("#"))).toEqual(["## M0: Scaffold, CI and preview", "### Acceptance checklist", "### Checks that must pass", "### Scope"]);
    expect(body).toContain("It is a draft: nothing merges until you say so.");
    expect(body).toContain("- [ ] The app starts locally.\n- [ ] CI runs on every pull request.");
    expect(body).toContain("- `npx tsc --noEmit`\n- `npm run build`");
    expect(body).toContain("- Set up Next.js.\n- Add CI.");
    expect(body.endsWith("\n")).toBe(true);
    expect(body).not.toMatch(/\n{3,}/);
  });

  it("points to the plan when it is told where it is", () => {
    expect(milestoneBody(M0, { planPath: "PLAN.md" })).toContain("one milestone of the plan in `PLAN.md`.");
    expect(milestoneBody(M0)).toContain("one milestone of the plan. It is a draft");
  });

  it("shows the preview link, or else the tip, not both", () => {
    const withPreview = milestoneBody(M0, { preview: { url: "https://a.vercel.app/", via: "deployment", host: "vercel" }, tip: PREVIEW_TIP });
    expect(withPreview).toContain("**Preview:** [https://a.vercel.app/](https://a.vercel.app/) (vercel)");
    expect(withPreview).not.toContain("Tip:");
    expect(milestoneBody(M0, { preview: { url: "https://x.example.dev/", via: "status", host: "other" } })).toContain("(from your host)");
    const tipped = milestoneBody(M0, { tip: PREVIEW_TIP });
    expect(tipped).toContain(`> ${PREVIEW_TIP}`);
    expect(tipped).not.toContain("**Preview:**");
    expect(milestoneBody(M0, { preview: null })).not.toMatch(/Preview|Tip:/);
  });

  it("puts the work log at the end", () => {
    const log = "## Work log\n\n- read src/app.ts";
    const body = milestoneBody(M0, { worklog: `\n${log}\n` });
    expect(body.endsWith(`${log}\n`)).toBe(true);
    expect(body.indexOf("### Scope")).toBeLessThan(body.indexOf("## Work log"));
    expect(milestoneBody(M0, { worklog: "   " })).toBe(milestoneBody(M0));
  });

  it("is made from the plan's own milestones", () => {
    const spec = { name: "X", summary: "s", users: [], platforms: ["web" as const], features: [{ name: "Thing", description: "A thing.", priority: "must" as const }], nonGoals: [], dataModel: [], surfaces: { screens: [], endpoints: [] }, risks: [], assumptions: [], needs: { auth: false, database: false, payments: false, seo: false, realtime: false, files: false, ai: false }, source: "rules" as const };
    const ms = planMilestones(spec, chooseStack(spec));
    for (const m of ms) {
      const b = milestoneBody(m);
      expect(b).toContain(`## M${m.k}: ${m.title}`);
      for (const a of m.acceptance) expect(b).toContain(`- [ ] ${a}`);
      expect(MILESTONE_BRANCH.test(milestoneBranch(m.k, m.title)), m.title).toBe(true);
    }
  });
});

// ------------------------------------------------------------------- on GitHub

/** What a host leaves on a commit, served by a wrapper around the fake GitHub's fetch. */
interface Hosted {
  deployments?: Array<{ id: number; environment: string; statuses: Array<Record<string, unknown>> }>;
  status?: Array<Record<string, unknown>>;
  checks?: Array<Record<string, unknown>>;
  /** Paths (a suffix) GitHub answers 403 "Resource not accessible by integration". */
  deny?: Array<"deployments" | "status" | "check-runs">;
  calls?: string[];
}

function hosted(h: Hosted): (inner: typeof fetch) => typeof fetch {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const denied = () => json({ message: "Resource not accessible by integration" }, 403);
  return (inner) => async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const m = (init?.method ?? "GET") === "GET" ? /\/(deployments|deployments\/(\d+)\/statuses|commits\/[0-9a-f]{40}\/(status|check-runs))$/.exec(u.pathname) : null;
    if (!m) return inner(input, init);
    h.calls?.push(u.pathname + u.search);
    if (m[1] === "deployments") return h.deny?.includes("deployments") ? denied() : json((h.deployments ?? []).map((d) => ({ id: d.id, environment: d.environment })));
    if (m[2]) return json(h.deployments?.find((d) => d.id === Number(m[2]))?.statuses ?? []);
    if (m[3] === "status") return h.deny?.includes("status") ? denied() : json({ state: "success", statuses: h.status ?? [] });
    return h.deny?.includes("check-runs") ? denied() : json({ total_count: (h.checks ?? []).length, check_runs: h.checks ?? [] });
  };
}

const BRANCH = "tailzu/m0-scaffold-ci-and-preview";

async function started(o: Parameters<typeof githubRig>[0] = {}) {
  const r = await githubRig(o);
  const s = await startMilestone(r.d, "alice", r.projectId, M0);
  return { r, s };
}

/** A commit on the milestone's branch: a pull request needs something to show. */
async function work(r: Awaited<ReturnType<typeof githubRig>>, branch = BRANCH) {
  const out = await commitToBranch(r.d, "alice", r.projectId, branch, [{ path: "src/app.ts", content: "export const a = 1;\n" }], "M0: first step");
  expect(out).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
}

describe("previewSignals (the App's read of a commit)", () => {
  const sha = "a".repeat(40);
  const rigOf = async (h: Hosted) => {
    const r = await githubRig({ wrapFetch: hosted(h) });
    return { r, ref: repoRef(r.d, "alice", r.project) };
  };

  it("reads deployments (with their newest status that has an address), statuses and check runs", async () => {
    const { r, ref } = await rigOf({
      deployments: [
        { id: 1, environment: "Preview", statuses: [{ state: "success", environment_url: "https://new.vercel.app", target_url: "https://vercel.com/log/1" }, { state: "pending", target_url: "" }] },
        { id: 2, environment: "Production", statuses: [{ state: "success", target_url: "https://app.example.com" }] },
        { id: 3, environment: "Preview", statuses: [{ state: "queued" }] },
      ],
      status: [{ context: "netlify/app/deploy-preview", state: "success", target_url: "https://x--app.netlify.app" }, { context: "no-link", state: "success", target_url: null }],
      checks: [{ name: "Vercel", app: { slug: "vercel" }, status: "completed", conclusion: "success", details_url: "https://vercel.com/d", output: { title: "Deployed", summary: "https://a.vercel.app" } }, { name: "tests", app: { slug: "github-actions" }, status: "in_progress", conclusion: null }],
    });
    const sig = await r.d.github.previewSignals(ref, sha);
    expect(sig.denied).toEqual([]);
    expect(sig.deployments).toEqual([
      { environment: "Preview", url: "https://new.vercel.app", state: "success" },
      { environment: "Production", url: "https://app.example.com", state: "success" },
    ]);
    expect(sig.statuses).toEqual([{ context: "netlify/app/deploy-preview", state: "success", url: "https://x--app.netlify.app" }]);
    expect(sig.checks).toEqual([
      { name: "Vercel", app: "vercel", status: "completed", conclusion: "success", url: "https://vercel.com/d", title: "Deployed", summary: "https://a.vercel.app" },
      { name: "tests", app: "github-actions", status: "in_progress", conclusion: null, url: "", title: "", summary: "" },
    ]);
    expect(detectPreview(sig)).toMatchObject({ url: "https://new.vercel.app/", via: "deployment" });
  });

  it("names what GitHub would not answer, and gives the rest", async () => {
    const { r, ref } = await rigOf({ deny: ["deployments", "check-runs"], status: [{ context: "vercel", state: "success", target_url: "https://s.vercel.app" }] });
    const sig = await r.d.github.previewSignals(ref, sha);
    expect(sig.denied).toEqual(["deployments", "checks"]);
    expect(sig.statuses).toHaveLength(1);
    expect(detectPreview(sig)).toMatchObject({ via: "status" });
    // all three denied: nothing, and not an error
    const all = await rigOf({ deny: ["deployments", "status", "check-runs"] });
    expect(await all.r.d.github.previewSignals(all.ref, sha)).toEqual({ deployments: [], statuses: [], checks: [], denied: ["deployments", "statuses", "checks"] });
  });

  it("without any host, the fake GitHub has nothing to say, and that is no preview", async () => {
    const r = await githubRig();
    const ref = repoRef(r.d, "alice", r.project);
    const sig = await r.d.github.previewSignals(ref, sha);
    expect(sig.denied).toEqual(["deployments", "statuses", "checks"]);
    expect(await previewFor(r.d.github, ref, sha)).toBeNull();
  });

  it("is only asked about a commit", async () => {
    const { r, ref } = await rigOf({});
    for (const bad of ["main", "../x", "", "A".repeat(40), "a".repeat(39)]) await expect(r.d.github.previewSignals(ref, bad), bad).rejects.toMatchObject({ code: "bad_request" });
  });

  it("keeps long words short", async () => {
    const { r, ref } = await rigOf({ checks: [{ name: "n".repeat(500), app: { slug: "a" }, status: "completed", conclusion: "success", output: { title: "t".repeat(900), summary: "s".repeat(5000) } }] });
    const [c] = (await r.d.github.previewSignals(ref, sha)).checks;
    expect(c!.name.length).toBe(100);
    expect(c!.title.length).toBe(200);
    expect(c!.summary.length).toBe(600);
  });
});

describe("startMilestone", () => {
  it("makes the branch from the default branch and records it as X0 Bot's own", async () => {
    const { r, s } = await started();
    expect(s).toMatchObject({ branch: BRANCH, existing: false, url: `https://github.com/alice/app/tree/${BRANCH}` });
    expect(r.fake.branches(r.repo)).toContain(BRANCH);
    expect(s.baseSha).toBe(r.fake.head(r.repo, "main"));
    expect(await r.store.getBranch(r.projectId, BRANCH)).toMatchObject({ branch: BRANCH, task: "M0: Scaffold, CI and preview", baseSha: s.baseSha });
    // it asks nobody
    expect(r.fake.pulls(r.repo)).toEqual([]);
  });

  it("is the same branch when asked again, not a second one", async () => {
    const { r, s } = await started();
    const again = await startMilestone(r.d, "alice", r.projectId, M0);
    expect(again).toMatchObject({ branch: BRANCH, baseSha: s.baseSha, existing: true });
    expect(r.fake.branches(r.repo).filter((b) => b === BRANCH)).toHaveLength(1);
  });

  it("leaves a branch of that name that X0 Bot did not make alone", async () => {
    const r = await githubRig();
    await r.d.github.createBranch(repoRef(r.d, "alice", r.project), BRANCH);
    const before = r.fake.head(r.repo, BRANCH);
    await expect(startMilestone(r.d, "alice", r.projectId, M0)).rejects.toMatchObject({ code: "branch_exists" });
    expect(r.fake.head(r.repo, BRANCH)).toBe(before);
    expect(await r.store.getBranch(r.projectId, BRANCH)).toBeNull();
  });

  it("can start from another branch, which has to be a branch name", async () => {
    const r = await githubRig();
    await r.d.github.createBranch(repoRef(r.d, "alice", r.project), "tailzu/m0-scaffold-ci-and-preview-base");
    const m1 = { ...M0, k: 1, title: "Accounts and data" };
    const s = await startMilestone(r.d, "alice", r.projectId, m1, { from: BRANCH.replace("m0-scaffold-ci-and-preview", "m0-scaffold-ci-and-preview-base") });
    expect(s.branch).toBe("tailzu/m1-accounts-and-data");
    await expect(startMilestone(r.d, "alice", r.projectId, { ...M0, k: 2, title: "Core" }, { from: "bad name" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("is only for the project's owner", async () => {
    const r = await githubRig();
    await expect(startMilestone(r.d, "bob", r.projectId, M0)).rejects.toMatchObject({ code: "not_found" });
    expect(r.fake.branches(r.repo)).not.toContain(BRANCH);
  });
});

describe("openMilestonePr", () => {
  it("opens a draft pull request whose description is the checklist, with the tip when there is no host", async () => {
    const { r } = await started();
    await work(r);
    const intake = new MemoryIntakeStore(() => 1);
    const pr = await openMilestonePr(r.d, "alice", r.projectId, M0, { intake, planPath: "PLAN.md", worklog: "## Work log\n\n- wrote src/app.ts" });
    expect(pr).toMatchObject({ prNumber: 1, existing: false, tip: PREVIEW_TIP });
    expect(pr.preview).toBeUndefined();
    expect(pr.prUrl).toMatch(/\/pull\/1$/);
    const [p] = r.fake.pulls(r.repo);
    expect(p).toMatchObject({ number: 1, head: BRANCH, base: "main", draft: true, state: "open", title: "M0: Scaffold, CI and preview" });
    expect(p!.body).toContain("- [ ] The app starts locally.");
    expect(p!.body).toContain("in `PLAN.md`");
    expect(p!.body).toContain(`> ${PREVIEW_TIP}`);
    expect(p!.body.trimEnd().endsWith("- wrote src/app.ts")).toBe(true);
    expect((await r.store.getBranch(r.projectId, BRANCH))).toMatchObject({ prNumber: 1 });
    expect((await intake.get(r.projectId))!.tips).toEqual(["preview"]);
  });

  it("shows the host's preview link, and keeps the tip for a project that has none yet", async () => {
    const calls: string[] = [];
    const r = await githubRig({ wrapFetch: hosted({ calls, deployments: [{ id: 5, environment: "Preview", statuses: [{ state: "success", environment_url: "https://acme-app-git-m0.vercel.app" }] }] }) });
    await startMilestone(r.d, "alice", r.projectId, M0);
    await work(r);
    const intake = new MemoryIntakeStore(() => 1);
    const pr = await openMilestonePr(r.d, "alice", r.projectId, M0, { intake });
    expect(pr.preview).toEqual({ url: "https://acme-app-git-m0.vercel.app/", via: "deployment", host: "vercel" });
    expect(pr.tip).toBeUndefined();
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("**Preview:** [https://acme-app-git-m0.vercel.app/](https://acme-app-git-m0.vercel.app/) (vercel)");
    expect(r.fake.pulls(r.repo)[0]!.body).not.toContain("Tip:");
    expect(await intake.get(r.projectId)).toBeNull();
    // it asked about the pull request's own commit
    expect(calls.some((c) => c.includes(`sha=${r.fake.head(r.repo, BRANCH)}`) || c.includes(`/commits/${r.fake.head(r.repo, BRANCH)}/`))).toBe(true);
  });

  it("when it is open already, rewrites the description (the log and the link as they are now) and nothing else", async () => {
    const { r } = await started();
    await work(r);
    const intake = new MemoryIntakeStore(() => 1);
    const first = await openMilestonePr(r.d, "alice", r.projectId, M0, { intake, worklog: "## Work log\n\n- step one" });
    r.fake.editPull(r.repo, 1, { title: "Renamed by a person" });

    const second = await openMilestonePr(r.d, "alice", r.projectId, M0, { intake, worklog: "## Work log\n\n- step one\n- step two" });
    expect(second).toMatchObject({ prNumber: first.prNumber, existing: true });
    const pulls = r.fake.pulls(r.repo);
    expect(pulls).toHaveLength(1);
    expect(pulls[0]!.body).toContain("- step two");
    // a title someone changed is theirs; the tip was shown once already
    expect(pulls[0]!.title).toBe("Renamed by a person");
    expect(pulls[0]!.body).not.toContain("Tip:");
    expect(second.tip).toBeUndefined();
    expect(pulls[0]!.draft).toBe(true);
    expect(pulls[0]!.merged).toBe(false);
  });

  it("is a branch that X0 Bot made, with something on it", async () => {
    const r = await githubRig();
    // never made
    await expect(openMilestonePr(r.d, "alice", r.projectId, M0)).rejects.toMatchObject({ code: "not_found" });
    // made, with no commits: GitHub will not open an empty pull request
    await startMilestone(r.d, "alice", r.projectId, M0);
    await expect(openMilestonePr(r.d, "alice", r.projectId, M0, { intake: new MemoryIntakeStore(() => 1) })).rejects.toMatchObject({ code: "nothing_to_review" });
    expect(r.fake.pulls(r.repo)).toEqual([]);
    // someone else's
    await expect(openMilestonePr(r.d, "bob", r.projectId, M0)).rejects.toMatchObject({ code: "not_found" });
  });

  it("does not fail for want of a permission to read deployments: the tip is shown", async () => {
    const r = await githubRig({ wrapFetch: hosted({ deny: ["deployments", "status", "check-runs"] }) });
    await startMilestone(r.d, "alice", r.projectId, M0);
    await work(r);
    const pr = await openMilestonePr(r.d, "alice", r.projectId, M0, { intake: new MemoryIntakeStore(() => 1) });
    expect(pr).toMatchObject({ prNumber: 1, tip: PREVIEW_TIP });
  });

  it("never merges, force-pushes or writes a workflow file", async () => {
    const { r } = await started();
    await work(r);
    await openMilestonePr(r.d, "alice", r.projectId, M0, { intake: new MemoryIntakeStore(() => 1) });
    await openMilestonePr(r.d, "alice", r.projectId, M0, { intake: new MemoryIntakeStore(() => 1) });
    const writes = r.fake.calls.filter((c) => c.method !== "GET");
    const at = (c: (typeof writes)[number]) => c.url.pathname.replace(/^\/repos\/alice\/app/, "");
    expect(writes.some((c) => /\/merge$/.test(at(c)))).toBe(false);
    expect(writes.some((c) => c.method === "DELETE")).toBe(false);
    // the only ref that moves is the milestone's own, and not by force
    const moved = writes.filter((c) => c.method === "PATCH" && at(c).startsWith("/git/refs/"));
    expect(moved.map(at)).toEqual([`/git/refs/heads/${BRANCH}`]);
    expect(moved.every((c) => c.body?.force !== true)).toBe(true);
    expect(writes.filter((c) => c.method === "PATCH" && at(c).startsWith("/pulls/")).map(at)).toEqual(["/pulls/1"]);
    expect(r.fake.head(r.repo, "main")).toBe(r.fake.parentsOf(r.repo, BRANCH)[0]);
    expect(r.fake.files(r.repo, BRANCH)["src/app.ts"]).toBeDefined();
    expect(Object.keys(r.fake.files(r.repo, BRANCH)).some((p) => p.startsWith(".github/workflows/"))).toBe(false);
  });
});
