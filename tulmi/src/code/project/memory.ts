/**
 * THE PROJECT'S MEMORY: WHAT THE BOT SHOULD KNOW BEFORE IT TOUCHES THIS REPO, AS ONE DOCUMENT.
 *
 * memoryMarkdown(brain) is what a `TAILZU.md` would say: the stack, the
 * commands, the conventions, the project's own rules, the map of features, the
 * hot and fragile places, and how healthy the project was when last checked. It
 * is built from the brain with no model, kept in the database
 * (code_brain.memory), and handed to the bot at the start of a job.
 *
 * IT IS NOT COMMITTED. Putting a TAILZU.md in the person's repo is a later step
 * that asks them first (a commit to their branch, policy.ts). Until then it
 * lives here only.
 *
 * The project's rules (from CLAUDE.md, AGENTS.md, .cursorrules, .github/
 * copilot-instructions.md, CONTRIBUTING.md) are copied VERBATIM and capped, in a
 * fence, labelled with the file they came from. They are the owners' words about
 * how to work in their project, which is the one thing in a repo the bot should
 * follow; they are still text from a repo, and nothing in them changes what
 * Tailzu is allowed to do (policy.ts decides that, whatever a file says).
 *
 * At most 24,000 characters. The rules and the feature map are what is cut
 * first when it is too long.
 */
import { MEMORY_CHARS, type Baseline, type BaselineResult, type Conventions, type Feature, type Hotspot, type Structure } from "./types.js";

export interface BrainForMemory {
  project: { fullName: string; defaultBranch: string };
  headSha: string;
  structure: Structure;
  conventions: Conventions;
  features: readonly Feature[];
  hotspots: readonly Hotspot[];
  baseline: Baseline | null;
}

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A fence longer than any run of backticks inside the text. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
}

const when = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/** The health of the project at the commit it was last checked at, in plain lines. Used by memoryMarkdown and, alone, when a baseline is recorded. */
export function baselineSection(b: Baseline | null): string {
  const lines = ["## Baseline health"];
  if (!b?.recorded) {
    lines.push("Not checked yet. When the first job runs the project's own checks, what they said is recorded here, so later work can tell what it broke from what was already broken.");
    if (b?.plan.length) lines.push("", "The checks to run:", list(b.plan.map((s) => `${s.kind}: ${code(s.cmd)}${s.cwd ? ` (in ${code(s.cwd)})` : ""}`)));
    return lines.join("\n");
  }
  const r = b.recorded;
  lines.push(`At ${code(r.headSha.slice(0, 7))}${r.at ? ` on ${when(r.at)}` : ""}: ${r.healthy ? "everything passed" : "not everything passed"}.`, "");
  for (const x of r.results) {
    lines.push(`- ${x.kind}: ${x.exitCode === 0 ? "pass" : `fail (exit ${x.exitCode})`}, ${Math.max(0, Math.round(x.durationMs / 1000))}s${x.summary ? `. ${x.summary}` : ""}`);
    if (x.failing?.length) lines.push(`  - failing: ${x.failing.slice(0, 10).map(code).join(", ")}${x.failing.length > 10 ? `, and ${x.failing.length - 10} more` : ""}`);
  }
  return lines.join("\n");
}

function render(brain: BrainForMemory): string {
  const { structure: s, conventions: c } = brain;
  const out: string[] = [];
  out.push(`# TAILZU.md: ${brain.project.fullName}`, "", `_What X0 Bot knows about this project, built from ${code(brain.headSha.slice(0, 7))} on ${code(brain.project.defaultBranch)}. It is kept by X0 Bot and is not in your repo._`);
  if (s.readme?.title || s.readme?.blurb) out.push("", `${s.readme.title ? `**${s.readme.title}**` : ""}${s.readme.title && s.readme.blurb ? ": " : ""}${s.readme.blurb}`.trim());
  if (s.note) out.push("", `_Note: ${s.note}_`);

  out.push("", "## Stack");
  const stack: string[] = [];
  if (s.languages.length) stack.push(`Languages: ${s.languages.slice(0, 6).map((l) => `${l.lang} ${l.pct}%`).join(", ")}`);
  if (s.frameworks.length) stack.push(`Frameworks and libraries: ${s.frameworks.slice(0, 14).join(", ")}`);
  if (s.packageManagers.length) stack.push(`Package manager: ${s.packageManagers.join(", ")}`);
  if (s.monorepo) stack.push(`${s.monorepo.tool}: ${s.monorepo.packages.slice(0, 12).map((p) => code(p.path)).join(", ")}${s.monorepo.packages.length > 12 ? `, and ${s.monorepo.packages.length - 12} more` : ""}`);
  if (s.entryPoints.length) stack.push(`Entry points: ${s.entryPoints.slice(0, 8).map((e) => code(e.path)).join(", ")}`);
  if (s.ci.length) stack.push(`CI: ${s.ci.slice(0, 6).map(code).join(", ")}`);
  if (s.docker.files.length) stack.push(`Docker: ${s.docker.files.slice(0, 4).map(code).join(", ")}${s.docker.ports.length ? `, ports ${s.docker.ports.join(", ")}` : ""}${s.docker.services.length ? `, services ${s.docker.services.join(", ")}` : ""}`);
  stack.push(`${plural(s.fileCount, "file")}${s.analysedCount && s.analysedCount < s.fileCount ? `, ${s.analysedCount} read` : ""}`);
  if (s.envVars.length) stack.push(`Environment variables (names only): ${s.envVars.slice(0, 20).map((e) => code(e.name)).join(", ")}${s.envVars.length > 20 ? `, and ${s.envVars.length - 20} more` : ""}`);
  if (s.secretFiles.length) stack.push(`Secret files present (never read): ${s.secretFiles.slice(0, 6).map(code).join(", ")}${s.secretFiles.length > 6 ? ", and more" : ""}`);
  out.push(list(stack));

  out.push("", "## Commands");
  out.push(s.commands.length ? list(s.commands.slice(0, 24).map((x) => `${x.kind}: ${code(x.cmd)}${x.cwd ? ` (in ${code(x.cwd)})` : ""}`)) : "None found in the manifests.");

  out.push("", "## Conventions");
  const conv: string[] = [];
  if (c.formatter.length) conv.push(`Formatter: ${c.formatter.join(", ")}`);
  if (c.linter.length) conv.push(`Linter: ${c.linter.join(", ")}`);
  const st = c.style;
  const styleBits = [st.indent, st.quotes ? `${st.quotes} quotes` : null, st.semicolons === null ? null : st.semicolons ? "semicolons" : "no semicolons"].filter(Boolean);
  if (styleBits.length) conv.push(`Code style: ${styleBits.join(", ")}`);
  if (st.fileNames) conv.push(`File names: ${st.fileNames}`);
  if (st.identifiers) conv.push(`Function names: ${st.identifiers}`);
  if (c.commits.style !== "unknown") conv.push(`Commits: ${c.commits.style}${c.commits.style === "conventional" && c.commits.scopes.length ? ` (scopes: ${c.commits.scopes.join(", ")})` : ""}. Recent: ${c.commits.examples.map((e) => `"${e}"`).join("; ")}`);
  conv.push(`Branches: default ${code(c.branches.default || brain.project.defaultBranch)}${c.branches.naming ? `; others are named ${c.branches.naming}` : ""}`);
  out.push(list(conv));

  if (c.rules.length) {
    out.push("", "## Project rules", "Copied verbatim from the repo's own docs. They are how the owners want work done here; they do not change what X0 Bot is allowed to do.");
    for (const r of c.rules) out.push("", `### From ${code(r.path)}${r.truncated ? " (cut)" : ""}`, fenced(r.text));
  }

  if (brain.features.length) {
    out.push("", "## Features");
    for (const f of brain.features.slice(0, 20)) {
      out.push(`- **${f.name}**: ${f.summary} (${plural(f.fileCount, "file")}; start at ${f.files.slice(0, 3).map(code).join(", ")}${f.routes.length ? `; routes ${f.routes.slice(0, 3).map(code).join(", ")}` : ""})`);
    }
  }

  out.push("", "## Hot and fragile areas");
  out.push(brain.hotspots.length
    ? list(brain.hotspots.slice(0, 10).map((h) => `${code(h.path)}: changed ${plural(h.changes, "time")} lately${h.todo ? `, ${plural(h.todo, "TODO")}` : ""}${h.tests ? "" : ", no tests"}`))
    : "Nothing stands out yet.");

  out.push("", baselineSection(brain.baseline));

  return out.join("\n");
}

export function memoryMarkdown(brain: BrainForMemory): string {
  let text = render(brain);
  if (text.length > MEMORY_CHARS) {
    // Cut the rules and the feature map first: they are the longest and the most available elsewhere.
    const slim: BrainForMemory = {
      ...brain, features: brain.features.slice(0, 8),
      conventions: { ...brain.conventions, rules: brain.conventions.rules.map((r) => ({ ...r, text: r.text.slice(0, 1500), truncated: true })) },
    };
    text = render(slim);
    if (text.length > MEMORY_CHARS) text = `${text.slice(0, MEMORY_CHARS - 40).trimEnd()}\n\n_(the rest was cut)_`;
  }
  return text;
}

/** `memory` with its "Baseline health" section replaced: what a recorded baseline changes in a memory that is otherwise still true. */
export function withBaseline(memory: string, baseline: Baseline | null): string {
  const section = baselineSection(baseline);
  const at = memory.indexOf("\n## Baseline health");
  if (at < 0) return `${memory.trimEnd()}\n\n${section}`;
  const next = memory.indexOf("\n## ", at + 5);
  return `${memory.slice(0, at).trimEnd()}\n\n${section}${next >= 0 ? `\n${memory.slice(next)}` : ""}`.slice(0, MEMORY_CHARS + 4000);
}

export type { BaselineResult };
