/**
 * THE OPEN-SOURCE TOOLS, PINNED: WHERE THEY LIVE, HOW THEY ARE INSTALLED, HOW THEY ARE CHECKED.
 *
 *   npm run e2e:tools -- list                 what is pinned and what is installed
 *   npm run e2e:tools -- install [name..]     install the pinned versions into e2e/cache/tools (git-ignored); every tool when no name is given
 *   npm run e2e:tools -- verify [name..]      each installed tool must report exactly the version in versions.json
 *   npm run e2e:tools -- licences [name..]    the licence of every installed Python package, copyleft ones flagged
 *   npm run e2e:tools -- lock <name>          (maintainers) regenerate a Python tool's hash-locked requirements from its .in file
 *
 * versions.json is the one place a version is written. A Python tool is installed from a hash-locked requirements file (`uv pip sync --require-hashes`) into
 * its own venv, an npm tool with `npm ci --ignore-scripts` from the package-lock.json kept beside it. Nothing is installed from "latest", and no install
 * script of an npm package runs.
 */
import "../env.js";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, E2E_DIR, mkdirp, readJson, run } from "../util.js";

export interface ToolSpec {
  role: string;
  kind: "pip" | "npm";
  package: string;
  version: string;
  python?: string;
  lock?: string;
  lockInput?: string;
  /** Relative to the tool's folder. */
  bin?: string;
  dir?: string;
  versionArgs?: string[];
  versionExpect?: string;
  licence: string;
  licenceNote: string;
  headless?: string;
  homepage: string;
  installCmd?: string;
  artifact?: { file: string; sha256: string; uploaded: string };
  integrity?: string;
  published?: string;
}

export interface VersionsFile { note: string; supplyChain: string; tools: Record<string, ToolSpec>; nodeDevDependencies: Record<string, unknown>; publicBenchmarks: Record<string, unknown> }

export const AGENTS_DIR = path.join(E2E_DIR, "agents");
export const TOOLS_DIR = path.join(CACHE_DIR, "tools");

export const versions = (): VersionsFile => readJson<VersionsFile>(path.join(AGENTS_DIR, "versions.json"));

export function toolSpec(name: string): ToolSpec {
  const t = versions().tools[name];
  if (!t) throw new Error(`no tool called ${name} in e2e/agents/versions.json; there are ${Object.keys(versions().tools).join(", ")}`);
  return t;
}

export const toolDir = (name: string): string => path.join(TOOLS_DIR, toolSpec(name).dir ?? name);

/** The executable (or the venv's python) of an installed tool; null when it is not installed. */
export function toolBin(name: string): string | null {
  const t = toolSpec(name);
  if (!t.bin) return null;
  const p = path.join(toolDir(name), t.bin);
  return fs.existsSync(p) ? p : null;
}

/** The folder with a Python tool's scripts, or a tool's own folder: first on the PATH of the agent that runs it. */
export const toolBinDir = (name: string): string | null => { const b = toolBin(name); return b ? path.dirname(b) : null; };

export const notInstalled = (name: string): string => `${name} ${toolSpec(name).version} is not installed: run \`npm run e2e:tools -- install ${name}\` (about ${name === "aider" ? "600" : "400"} MB into e2e/cache/tools, git-ignored)`;

export async function installTool(name: string, log: (s: string) => void = () => undefined): Promise<void> {
  const t = toolSpec(name);
  const dir = toolDir(name);
  mkdirp(TOOLS_DIR);
  if (t.kind === "pip") {
    if (!t.lock) throw new Error(`${name} has no lock file`);
    const py = path.join(dir, "bin", "python");
    if (!fs.existsSync(py)) {
      log(`${name}: making the venv (python ${t.python ?? "3.12"})`);
      const v = await run("uv", ["venv", "--python", t.python ?? "3.12", dir, "-q"], { timeoutMs: 300_000 });
      if (v.code !== 0) throw new Error(`uv venv failed: ${(v.stderr || v.stdout).trim().slice(-300)}`);
    }
    log(`${name}: installing ${t.package}==${t.version} from ${t.lock} (hashes required)`);
    const r = await run("uv", ["pip", "sync", "--python", py, "--require-hashes", path.join(AGENTS_DIR, t.lock), "-q"], { timeoutMs: 900_000 });
    if (r.code !== 0) throw new Error(`uv pip sync failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  } else {
    if (!t.lock) throw new Error(`${name} has no lock file`);
    mkdirp(dir);
    const src = path.dirname(path.join(AGENTS_DIR, t.lock));
    for (const f of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(src, f), path.join(dir, f));
    log(`${name}: npm ci ${t.package}@${t.version} (no install scripts)`);
    const r = await run("npm", ["ci", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund"], { timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`npm ci failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  }
  const v = await verifyTool(name);
  if (!v.ok) throw new Error(`${name} installed but reports "${v.got}", not "${v.expected}"`);
  log(`${name}: ok (${v.got})`);
}

export async function verifyTool(name: string): Promise<{ ok: boolean; got: string; expected: string; installed: boolean }> {
  const t = toolSpec(name);
  const bin = toolBin(name);
  const expected = t.versionExpect ?? t.version;
  if (!bin) return { ok: false, got: "not installed", expected, installed: false };
  const r = await run(bin, t.versionArgs ?? ["--version"], { timeoutMs: 60_000, env: { PATH: `${path.dirname(bin)}:/usr/bin:/bin`, HOME: osHome(), MSWEA_CONFIGURED: "true" } });
  const out = `${r.stdout}\n${r.stderr}`;
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const ok = out.includes(expected);
  return { ok, got: (ok ? lines.find((l) => l.includes(expected)) : lines[lines.length - 1]) ?? "", expected, installed: true };
}

const osHome = (): string => { const d = path.join(CACHE_DIR, "tools", ".home"); mkdirp(d); return d; };

const LICENCE_SCAN = `
import importlib.metadata as md, re, json
out = []
for d in md.distributions():
    m = d.metadata
    lic = (m.get('License-Expression') or m.get('License') or '').strip().replace('\\n', ' ')[:70]
    cls = [c.split('::')[-1].strip() for c in (m.get_all('Classifier') or []) if c.startswith('License')]
    out.append([m['Name'], d.version, lic, cls])
print(json.dumps(out))
`;

export interface PackageLicence { name: string; version: string; licence: string; copyleft: boolean }

/** The licence of every package in a Python tool's venv; copyleft (GPL, LGPL, AGPL, MPL, SSPL, non-commercial) flagged. */
export async function pythonLicences(name: string): Promise<PackageLicence[]> {
  if (!toolBin(name)) throw new Error(notInstalled(name));
  const r = await run(path.join(toolDir(name), "bin", "python"), ["-I", "-c", LICENCE_SCAN], { timeoutMs: 60_000 });
  const rows = JSON.parse(r.stdout) as Array<[string, string, string, string[]]>;
  return rows.map(([n, v, l, c]) => {
    const text = [l, ...c].join(" ");
    return { name: n, version: v, licence: l || c.join(", ") || "unknown", copyleft: /GPL|AGPL|LGPL|MPL|SSPL|Commons Clause|Non-?commercial|BUSL|Elastic/i.test(text) };
  }).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

async function lockTool(name: string): Promise<void> {
  const t = toolSpec(name);
  if (t.kind !== "pip" || !t.lock || !t.lockInput) throw new Error("only Python tools are locked this way");
  const r = await run("uv", ["pip", "compile", path.join(AGENTS_DIR, t.lockInput), "--python-version", t.python ?? "3.12", "--python-platform", "x86_64-unknown-linux-gnu", "--generate-hashes", "--exclude-newer", "2026-10-13T00:00:00Z", "-o", path.join(AGENTS_DIR, t.lock), "-q"], { timeoutMs: 600_000 });
  if (r.code !== 0) throw new Error(`uv pip compile failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
}

async function main(): Promise<void> {
  const [cmd = "list", ...rest] = process.argv.slice(2);
  const names = rest.length ? rest : Object.entries(versions().tools).filter(([, t]) => t.bin).map(([n]) => n);
  if (cmd === "list") {
    for (const [n, t] of Object.entries(versions().tools)) console.log(`${n.padEnd(15)} ${t.package}@${t.version}`.padEnd(46), t.licence.padEnd(11), toolBin(n) ? "installed" : t.bin ? "not installed" : "not installable here", `  ${t.role}`);
  } else if (cmd === "install") {
    for (const n of names) await installTool(n, (s) => console.log(s));
  } else if (cmd === "verify") {
    let bad = 0;
    for (const n of names) { const v = await verifyTool(n); console.log(`${n.padEnd(15)} ${v.ok ? "ok" : "BAD"}  ${v.got}${v.ok ? "" : `  (wanted ${v.expected})`}`); if (!v.ok && v.installed) bad += 1; }
    process.exit(bad ? 1 : 0);
  } else if (cmd === "licences") {
    for (const n of names.filter((x) => toolSpec(x).kind === "pip")) {
      if (!toolBin(n)) { console.log(`${n}: not installed`); continue; }
      const l = await pythonLicences(n);
      console.log(`${n}: ${l.length} packages; copyleft or unusual: ${l.filter((x) => x.copyleft).map((x) => `${x.name} ${x.version} (${x.licence})`).join(", ") || "none"}`);
    }
  } else if (cmd === "lock") {
    for (const n of rest) { await lockTool(n); console.log(`${n}: locked`); }
  } else {
    console.error("usage: e2e:tools -- list | install [name..] | verify [name..] | licences [name..] | lock <name>");
    process.exit(2);
  }
}

if (process.argv[1] && /e2e\/agents\/tools\.[tj]s$/.test(process.argv[1])) main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
