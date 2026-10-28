/**
 * `--changed`: RUN ONLY WHAT THE LAST CODE CHANGE COULD HAVE AFFECTED; EVERYTHING ELSE REPLAYS FROM THE CASSETTE FOR NOTHING.
 *
 * When a run is recorded, the checksum of every file under src/ (and the fixtures and prompts the items use) is saved next to the cassette. Later,
 * `--changed` compares the files as they are now with that record (so it works before anything is committed), maps each changed directory to the
 * STAGES it feeds, and each stage to the ITEMS that exercise it. An affected item runs in mixed mode (its recordings where its prompts did not change, the
 * real model where they did, and the new answers are added to the cassette); the others replay, strictly, at zero cost.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { E2E_DIR, readJson, writeJson } from "../util.js";
import type { SmokeStage } from "./types.js";

const SRC = path.resolve(E2E_DIR, "..", "src");

/** Which stages a source directory feeds, first match wins. A path no rule names feeds everything (the safe side). */
export const STAGE_MAP: Array<{ match: RegExp; stages: SmokeStage[]; why: string }> = [
  { match: /^src\/front\/attachments\.ts$/, stages: ["vision", "front"], why: "reading attachments" },
  { match: /^src\/front\//, stages: ["front"], why: "the front door" },
  { match: /^src\/guard\//, stages: ["front", "work", "artifact", "research"], why: "the guards in front of every route" },
  { match: /^src\/artifacts\//, stages: ["artifact", "vision"], why: "the artifact core and its compare" },
  { match: /^src\/web\/|^src\/code\/webTools\.ts$/, stages: ["research", "safety"], why: "search, reading pages and research" },
  { match: /^src\/code\/work\/(locate|search)/, stages: ["locate"], why: "locating the files" },
  { match: /^src\/code\/work\/plan/, stages: ["plan"], why: "planning" },
  { match: /^src\/code\/agent\/(checks|verify)/, stages: ["verify"], why: "the project's checks" },
  { match: /^src\/code\/agent\/(report|commit)|^src\/code\/(policy|github|projects|access)\.ts$|^src\/code\/jobs\//, stages: ["commit", "pr", "safety"], why: "commits, pull requests, policy" },
  { match: /^src\/code\/agent\/|^src\/code\/work\//, stages: ["locate", "plan", "work", "verify", "commit"], why: "the agent loop and its work core" },
  { match: /^src\/code\/brain\/(classify|project)/, stages: ["front", "locate", "plan"], why: "the classifier and the project brain" },
];

/** The stages every item shares when the model door itself changed. */
export const ALL_STAGES: SmokeStage[] = ["front", "locate", "plan", "work", "verify", "commit", "pr", "artifact", "research", "vision", "safety"];

/** Parts of the product no smoke item exercises: a change there affects nothing here. The model door (src/agent/llm, the config) is not in this list. */
export const NOT_EXERCISED = /^src\/(ads|auth|billing|connectors|control|experience|history|media|notes|personality|pipeline|profile|push|routes|runs|seo|usage)\/|^src\/(server|observability)\.ts$|^src\/agent\/(?!llm)|^src\/code\/(oauth|store|live|newproject|prcare|resources|chat|project\/treesitter)/;

export function stagesOf(file: string): SmokeStage[] {
  const f = file.replace(/\\/g, "/");
  if (NOT_EXERCISED.test(f)) return [];
  for (const r of STAGE_MAP) if (r.match.test(f)) return r.stages;
  // Prompts, the gateway, tiers, config: everything that asks a model.
  return ALL_STAGES;
}

/** The items (by id) that exercise a stage. */
export const ITEMS_OF_STAGE: Record<SmokeStage, string[]> = {
  front: ["smoke-front-door-batch", "smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-question-ratelimit", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  locate: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  plan: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  work: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-question-ratelimit", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  verify: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  commit: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  pr: ["smoke-api-bug-pagination", "smoke-web-feature-clear-completed", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
  artifact: ["smoke-artifact-create-edit"],
  research: ["smoke-research-cached"],
  vision: ["smoke-vision-read"],
  safety: ["smoke-research-cached", "smoke-api-hostile-note", "smoke-api-secret-in-config"],
};

/** How the recording was made, so that a replay is made the same way (a cassette recorded under a 12-turn cap needs the 12-turn cap to replay: a 13th turn was never recorded). */
export interface RunParams { maxTurns?: number; primary?: string; fallback?: string; tiers?: "smoke" | "default" }

export interface SourceHashes { at: string; files: Record<string, string>; run?: RunParams }

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(f, out); } else if (/\.(ts|json|md|txt)$/.test(e.name)) out.push(f);
  }
}

/** A checksum per source file, keyed by path relative to the product's root. */
export function hashSources(root = SRC): SourceHashes {
  const files: string[] = [];
  walk(root, files);
  walk(path.join(E2E_DIR, "fixtures"), files);
  const base = path.resolve(root, "..");
  const out: Record<string, string> = {};
  for (const f of files.sort()) out[path.relative(base, f).replace(/\\/g, "/")] = createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
  return { at: new Date().toISOString(), files: out };
}

export const metaFile = (cassetteFile: string): string => cassetteFile.replace(/\.jsonl$/, ".meta.json");

export function saveHashes(cassetteFile: string, h: SourceHashes = hashSources(), run?: RunParams): void {
  // A re-save (a --changed run) keeps the parameters of the recording unless it is given new ones.
  const keep = run ?? loadHashes(cassetteFile)?.run;
  writeJson(metaFile(cassetteFile), { ...h, ...(keep ? { run: keep } : {}) });
}
export function loadHashes(cassetteFile: string): SourceHashes | null { return readJson<SourceHashes | null>(metaFile(cassetteFile), null); }

/** The files that differ between two records (changed, added or removed). */
export function changedFiles(before: SourceHashes, now: SourceHashes): string[] {
  const out: string[] = [];
  for (const [f, h] of Object.entries(now.files)) if (before.files[f] !== h) out.push(f);
  for (const f of Object.keys(before.files)) if (!(f in now.files)) out.push(f);
  return out.sort();
}

export interface Affected { files: string[]; stages: SmokeStage[]; items: string[]; reasons: Array<{ file: string; stages: SmokeStage[] }> }

/** What a set of changed files affects: the stages (by the map above) and the items that exercise them. */
export function affectedBy(files: string[]): Affected {
  const stages = new Set<SmokeStage>();
  const reasons: Affected["reasons"] = [];
  for (const f of files) {
    // A change to a fixture project feeds the tasks on it; to the harness's own smoke items, everything.
    const s = /^e2e\/fixtures\//.test(f) ? (["locate", "plan", "work", "verify", "commit", "pr", "front"] as SmokeStage[]) : /^src\//.test(f) ? stagesOf(f) : ALL_STAGES;
    reasons.push({ file: f, stages: s });
    for (const x of s) stages.add(x);
  }
  const items = new Set<string>();
  for (const s of stages) for (const id of ITEMS_OF_STAGE[s]) items.add(id);
  return { files, stages: [...stages], items: [...items], reasons };
}
