/**
 * CODE FINGERPRINTS: WHICH PART OF THE PRODUCT A RESULT WAS MADE WITH, SO A RESULT IS REUSED UNTIL THAT PART CHANGES.
 *
 * A result in the store (store.ts) is keyed by (agent, model, item, code fingerprint, prompt version). The fingerprint is a hash of the files that can change what
 * the thing under test does: not the whole repository (a change to the billing routes must not make a probe result stale), only the directories that feed the kind
 * of result:
 *
 *   probe           the model door: how a request is made to a model (gateway, tiers, reasoning, money, the llm client)
 *   task, tailzu    the whole Code flow: front door, project brain, locate, plan, the agent loop, guards, the model door
 *   task, external  nothing of ours: the contestant's pinned version (agents/versions.json). Its task and the scorer are in the prompt version.
 *   part            the directories of that part (edit formats: the model door; router: the Code flow; extraction: src/web; locate: the work core)
 *
 * The PROMPT VERSION is a second hash, of the words the models are given: src/principles for the product, the probe and edit-format texts for probes, the task's
 * own text and the scorer for a task. A prompt edit invalidates results without touching "code"; a code edit without touching a prompt leaves the probe words alone.
 *
 * All pure reads of the working tree (uncommitted edits count: the other worker's change to src/** shows up here the moment it lands).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { E2E_DIR, TULMI_DIR } from "../env.js";
import type { Task } from "../tasks/schema.js";

const TEXT = /\.(ts|tsx|js|mjs|json|md|txt|scm|py)$/;

function walk(p: string, out: string[]): void {
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isFile()) { if (TEXT.test(p)) out.push(p); return; }
  if (!st.isDirectory()) return;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "cache" || e.name === "out" || e.name.startsWith(".")) continue;
    walk(path.join(p, e.name), out);
  }
}

const memo = new Map<string, string>();

/** A short hash of the contents of the files under the given paths (relative to tulmi/), minus any path matching `except`. */
export function treeHash(paths: readonly string[], o: { except?: RegExp; root?: string; fresh?: boolean } = {}): string {
  const root = o.root ?? TULMI_DIR;
  const key = JSON.stringify([root, paths, o.except?.source ?? ""]);
  if (!o.fresh) { const hit = memo.get(key); if (hit) return hit; }
  const files: string[] = [];
  for (const p of paths) walk(path.join(root, p), files);
  const h = createHash("sha1");
  for (const f of files.sort()) {
    const rel = path.relative(root, f).replace(/\\/g, "/");
    if (o.except?.test(rel)) continue;
    h.update(rel); h.update("\0"); h.update(fs.readFileSync(f)); h.update("\0");
  }
  const out = h.digest("hex").slice(0, 12);
  memo.set(key, out);
  return out;
}

export function resetFingerprintCache(): void { memo.clear(); }

/** Where the words the models are given live in the product. */
const PROMPT_PATHS = ["src/principles"];
const PROMPT_RE = /^src\/principles\//;

/** The directories of the Code flow: everything a task on the product runs through. */
export const PRODUCT_PATHS = ["src/code", "src/front", "src/guard", "src/agent", "src/principles", "src/config.ts"];
/** The model door: how a request reaches a model and what it is told about thinking. */
export const MODEL_DOOR_PATHS = ["src/agent/llm.ts", "src/agent/reasoning.ts", "src/code/brain/gateway.ts", "src/code/brain/tiers.ts", "src/code/brain/money.ts", "src/code/brain/route.ts"];

export type FingerprintKind = "probe" | "task" | "smoke" | "part:editFormats" | "part:router" | "part:contextStrategy" | "part:extraction" | "part:locate";

const PARTS: Record<FingerprintKind, string[]> = {
  probe: MODEL_DOOR_PATHS,
  task: PRODUCT_PATHS,
  smoke: PRODUCT_PATHS,
  "part:editFormats": MODEL_DOOR_PATHS,
  "part:router": PRODUCT_PATHS,
  "part:contextStrategy": PRODUCT_PATHS,
  "part:extraction": ["src/web"],
  "part:locate": ["src/code/work", "src/code/brain", "src/code/project"],
};

/** The code fingerprint of one kind of result for one agent. A contestant is its pinned version; only Tailzu is the working tree. */
/** Our own arms (the product as it ships, and its phased flow): the working tree is what they run. */
const ours = (agent: string): boolean => agent === "tailzu" || agent.startsWith("tailzu-");

export function codeFingerprint(kind: FingerprintKind, agent = "tailzu"): string {
  if (!ours(agent) && agent !== "-" && (kind === "task" || kind === "smoke")) return externalVersion(agent);
  return treeHash(PARTS[kind], { except: PROMPT_RE });
}

/** `aider@0.86.2`, from agents/versions.json (the one place a contestant's version is written). */
export function externalVersion(agent: string): string {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(E2E_DIR, "agents", "versions.json"), "utf8")) as { tools?: Record<string, { version?: string }> };
    const name = agent === "mini-swe-agent" ? "mini-swe-agent" : agent;
    const t = v.tools?.[name];
    return `${agent}@${t?.version ?? "unknown"}`;
  } catch { return `${agent}@unknown`; }
}

/** The prompt version of a probe: the words of every probe and edit case. */
export function probeVersion(): string {
  return treeHash(["e2e/bakeoff/probes.ts", "e2e/bakeoff/editformat.ts", "e2e/smoke/png.ts"], { root: TULMI_DIR });
}

/** The scorer's version: a result is the same only if it was judged by the same checks. */
export function scorerVersion(): string {
  return treeHash(["e2e/score"], { root: TULMI_DIR });
}

/** The prompt version of a task result: the task's own text and checks, the scorer, and (for the product) the principles. */
export function taskPromptVersion(task: Pick<Task, "id">, agent = "tailzu", fullTask?: unknown): string {
  const h = createHash("sha1");
  h.update(JSON.stringify(fullTask ?? task.id));
  h.update(scorerVersion());
  if (ours(agent)) h.update(treeHash(PROMPT_PATHS));
  return h.digest("hex").slice(0, 12);
}

/** The prompt version of a smoke item: the product's principles, the fixtures and the item definitions. */
export function smokePromptVersion(): string {
  return treeHash([...PROMPT_PATHS, "e2e/fixtures", "e2e/smoke", "e2e/tasks/smoke.json"]);
}

/** A whole-working-tree summary for the report: the two hashes a reader can compare between runs. */
export function summaryFingerprint(): { product: string; modelDoor: string; prompts: string; probes: string; scorer: string } {
  return { product: codeFingerprint("task"), modelDoor: codeFingerprint("probe"), prompts: treeHash(PROMPT_PATHS), probes: probeVersion(), scorer: scorerVersion() };
}
