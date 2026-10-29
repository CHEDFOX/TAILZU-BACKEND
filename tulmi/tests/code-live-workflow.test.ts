/**
 * The files of a LIVE SESSION on GitHub's free computers (src/code/jobs/workflow.ts renderSessionWorkflow, stepJson with a session, githubActions.ts):
 * the session workflow as a golden file, what step.json carries for a session, and what the provider commits for one. Nothing here runs a workflow.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { renderSessionWorkflow, renderWorkflow, stepJson, shadowFiles, timeoutMinutes, CACHE_PATHS } = await import("../src/code/jobs/workflow.js");
const { RUN_MJS } = await import("../src/code/jobs/runScript.js");
const { firesForRunnerPush, pushTrigger } = await import("../src/code/jobs/ciNoise.js");
const shadow = await import("../src/code/shadow.js");
const { SESSION_COMMAND, isSessionCommands } = await import("../src/code/live/protocol.js");

/** The session workflow for a job that may last 20 minutes, written out. */
const GOLDEN = `# Written by X0 Bot for a live session of a coding job. Do not edit: it is replaced for every session.
# It runs only for the throwaway tailzu-run/ branch it was written on, and the branch is deleted afterwards.
name: X0 Bot run
on:
  push:
    branches: ['tailzu-run/**']
permissions:
  contents: read
  id-token: write
concurrency:
  group: tailzu-run-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 21
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
          persist-credentials: false
      - id: node
        run: |
          node -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)' || echo 'need=true' >> "$GITHUB_OUTPUT"
      - if: steps.node.outputs.need == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/cache@v4
        with:
          path: |
            ~/.npm
            ~/.cache/pip
            ~/.cache/yarn
            ~/.local/share/pnpm
          key: tailzu-\${{ runner.os }}-\${{ hashFiles('**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/requirements*.txt', '**/poetry.lock', '**/Pipfile.lock') }}
          restore-keys: |
            tailzu-\${{ runner.os }}-
      - run: node .tailzu/run.mjs
`;

describe("the session workflow", () => {
  it("is exactly this, from one function (a golden file)", () => {
    expect(renderSessionWorkflow(timeoutMinutes(20 * 60))).toBe(GOLDEN);
  });

  it("takes the job's cap as its timeout, so a session that is left open is stopped by GitHub as the last resort", () => {
    expect(renderSessionWorkflow(timeoutMinutes(20 * 60))).toContain("timeout-minutes: 21\n");
    expect(renderSessionWorkflow(timeoutMinutes(5 * 60))).toContain("timeout-minutes: 6\n");
    expect(renderSessionWorkflow(0)).toContain("timeout-minutes: 1\n");
  });

  it("differs from the ordinary workflow in what a session needs and nothing else: a shallow checkout, a Node with a WebSocket", () => {
    const plain = renderWorkflow(21).split("\n");
    const session = renderSessionWorkflow(21).split("\n");
    const onlyPlain = plain.filter((l) => !session.includes(l));
    const onlySession = session.filter((l) => !plain.includes(l));
    expect(onlyPlain.filter((l) => !l.startsWith("#"))).toEqual(["          fetch-depth: 0"]);
    expect(onlySession.filter((l) => !l.startsWith("#") && !/fetch-depth: 1/.test(l)).some((l) => /setup-node|WebSocket|node-version|steps\.node|need=true|id: node|run: \|/.test(l))).toBe(true);
    // the same permissions, trigger and caches as the ordinary one
    for (const keep of ["permissions:\n  contents: read\n  id-token: write\n", "branches: ['tailzu-run/**']", "persist-credentials: false", "actions/cache@v4"]) {
      expect(renderSessionWorkflow(21)).toContain(keep);
    }
    for (const p of CACHE_PATHS) expect(renderSessionWorkflow(21)).toContain(`            ${p}\n`);
  });

  it("keeps no token for the commands to find, asks for no more than the contents and an identity, and pins the actions by major version", () => {
    const y = renderSessionWorkflow(21);
    expect(y).toMatch(/permissions:\n {2}contents: read\n {2}id-token: write\n(?!\s+\w)/);
    expect(y).not.toMatch(/write-all|contents: write|pull-requests|actions: write/);
    expect([...y.matchAll(/uses: (\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4", "actions/setup-node@v4", "actions/cache@v4"]);
    expect(y.trimEnd().split("\n").at(-1)).toBe("      - run: node .tailzu/run.mjs");
    // the Node step is only taken when this runner's Node has no WebSocket of its own
    expect(y).toContain("- if: steps.node.outputs.need == 'true'");
  });

  it("is a push to tailzu-run/ only, which a person's own CI reader counts as the runner's push and nothing more", () => {
    expect(pushTrigger(renderSessionWorkflow(21))).toEqual({ branches: ["tailzu-run/**"] });
    expect(firesForRunnerPush(pushTrigger(renderSessionWorkflow(21)))).toBe(true);
  });
});

describe("step.json for a session", () => {
  const base = {
    jobId: "3f9a1c2b-0000-4000-8000-000000000000", stepIdx: 2, epoch: 3, commands: [SESSION_COMMAND], timeoutSec: 1200, baseSha: "a".repeat(40),
    resultUrl: "https://api.x0bot.com/v1/code/runner/gh-result", audience: "tailzu", discard: true,
  };
  const session = { url: "wss://jobs.example/v1/rooms/3f9a1c2b-0000-4000-8000-000000000000/runner", ticket: ["t1", "claims", "mac"].join("."), idleSec: 120, maxSec: 1200 };

  it("puts the session last, after everything an ordinary step carries, and only when there is one", () => {
    const withSession = JSON.parse(stepJson({ ...base, session }));
    expect(Object.keys(withSession)).toEqual([...Object.keys(JSON.parse(stepJson(base))), "session"]);
    expect(withSession.session).toEqual(session);
    expect(Object.keys(withSession.session)).toEqual(["url", "ticket", "idleSec", "maxSec"]);
    expect(Object.keys(JSON.parse(stepJson(base)))).not.toContain("session");
  });

  it("is committed as the same three files, the session's workflow in the place of the ordinary one", () => {
    const files = shadowFiles({ ...base, session });
    expect(files.map((f) => f.path)).toEqual([...shadow.SHADOW_FILES]);
    expect(shadow.isExactShadowSet(files.map((f) => f.path))).toBe(true);
    expect(files[0]!.content).toBe(renderSessionWorkflow(timeoutMinutes(base.timeoutSec)));
    expect(files[1]!.content).toBe(stepJson({ ...base, session }));
    expect(files[2]!.content).toBe(RUN_MJS);
    expect(shadowFiles(base)[0]!.content).toBe(renderWorkflow(timeoutMinutes(base.timeoutSec)));
  });

  it("holds the pass for the room and nothing that can write: no token of GitHub's, no secret of the server's", () => {
    const text = stepJson({ ...base, session });
    expect(text).not.toMatch(/ghp_|ghs_|github_pat_|Bearer/);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["audience", "baseSha", "commands", "discard", "epoch", "jobId", "resultUrl", "session", "stepIdx", "timeoutSec"]);
  });
});

describe("the session command", () => {
  it("is one command with the name no shell would run, and only that exact list is a session", () => {
    expect(SESSION_COMMAND).toBe("tailzu:live-session");
    expect(isSessionCommands([SESSION_COMMAND])).toBe(true);
    expect(isSessionCommands([SESSION_COMMAND, "npm test"])).toBe(false);
    expect(isSessionCommands(["npm test"])).toBe(false);
    expect(isSessionCommands([])).toBe(false);
    expect(isSessionCommands(undefined as never)).toBe(false);
    expect(isSessionCommands([` ${SESSION_COMMAND}`])).toBe(false);
  });
});
