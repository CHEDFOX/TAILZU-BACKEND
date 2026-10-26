/**
 * WHAT THE STORE BUILD CAN DRAW AND DO, AS A CHECK ANY TEST CAN RUN.
 *
 * The audit tests/onboard-store.test.ts holds the store onboarding to, copied
 * here so another screen's JSON can be held to it too (the You tab's Activity
 * card, tests/activity-card.test.ts): every node type, prop, binding, event,
 * action kind and field, condition and style key in it must be one the store
 * build's own source names. The build is read from the fixture
 * (tests/fixtures/store-build.json, scripts/storeBuild.ts) and, when the phone
 * repo is at hand, from the phone repo at STORE_COMMIT itself.
 *
 * One allowance, and only one, named with its reason (ALLOWED): what a
 * screen already sends to every build, that the store build reads past.
 */
import { execFileSync } from "node:child_process";
import fixtureJson from "./fixtures/store-build.json";
import { STORE_COMMIT, STORE_FILES, parseStoreBuild, type StoreBuild, type StoreSources } from "../scripts/storeBuild.js";

export const FIXTURE = fixtureJson as unknown as StoreBuild;

/** The phone build in the stores, read from the phone repo at STORE_COMMIT when the repo is at hand; null where it is not (CI). */
export function liveStoreBuild(): StoreBuild | null {
  const repo = process.env.TAILZU_FRONTEND ?? "/home/user/TAILZU-FRONTEND";
  try {
    const src = Object.fromEntries(
      Object.entries(STORE_FILES).map(([k, file]) => [k, execFileSync("git", ["-C", repo, "show", `${STORE_COMMIT}:${file}`], { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "ignore"] })]),
    ) as unknown as StoreSources;
    return parseStoreBuild(src);
  } catch {
    return null;
  }
}

/** The fixture, and the phone repo at STORE_COMMIT when it is at hand. */
export function storeBuilds(): Array<[string, StoreBuild]> {
  const live = liveStoreBuild();
  return [["the fixture", FIXTURE], ...(live ? [[`the phone repo at ${STORE_COMMIT}`, live] as [string, StoreBuild]] : [])];
}

export type N = {
  type: string; id?: string; props?: Record<string, any>; style?: Record<string, any>; children?: N[];
  visibleIf?: any; on?: Record<string, any>; bind?: Record<string, string>; fallback?: N; motion?: Record<string, any>;
};

/** What the server alone reads, and the app never sees (titleCase.ts): not the app's to name. */
const SERVER_ONLY_PROPS = new Set(["keepCase"]);
const NODE_KEYS = new Set(["type", "id", "props", "style", "children", "bind", "on", "motion", "visibleIf", "fallback"]);
/** resolveStyle hands any key it does not name to React Native untouched; this is the one it says it exists for. */
const STYLE_PASSTHROUGH = new Set(["transform"]);
/**
 * Action fields a screen may send that the store build does not read.
 * openUrl.handoff: askAction (experience/assistant.ts) sends it to every
 * build from the hand card's Do it already; a build with the phone's own
 * hand-off list holds the link to it, and the store build's openUrl reads
 * `url` alone and opens it as it always has.
 */
const ALLOWED: Record<string, readonly string[]> = { openUrl: ["handoff"] };

/** Everything in a screen that is not in `b`, as sentences. Empty is a screen the store build can draw. */
export function audit(screen: any, b: StoreBuild): string[] {
  const bad: string[] = [];
  const drawn = new Set(b.drawn.filter((t) => b.declared.includes(t)));
  const actionKinds = new Set(b.actions);

  const condition = (c: any, where: string, allowed: string[]): void => {
    if (!c || typeof c !== "object") return;
    for (const k of Object.keys(c)) {
      if (!allowed.includes(k)) { if (k !== "then" && k !== "else") bad.push(`${where}: condition ${k}`); continue; }
      if (k === "not") condition(c.not, where, allowed);
      if (k === "all" || k === "any") for (const x of c[k]) condition(x, where, allowed);
    }
  };

  const action = (a: any, where: string): void => {
    if (a == null) return;
    if (typeof a === "string") {
      if (!screen.actions?.[a]) bad.push(`${where}: the action ${a} is not in the screen's table`);
      return;
    }
    if (!actionKinds.has(a.kind)) { bad.push(`${where}: action kind ${a.kind}`); return; }
    for (const f of Object.keys(a)) {
      if (!(b.actionFields[a.kind] ?? []).includes(f) && !(ALLOWED[a.kind] ?? []).includes(f)) bad.push(`${where}: ${a.kind} reads no field ${f}`);
    }
    if (a.kind === "condition") condition(a.if, `${where}.if`, b.conditions);
    for (const f of ["actions"]) if (Array.isArray(a[f])) a[f].forEach((x: any) => action(x, `${where}.${a.kind}`));
    for (const f of ["then", "else", "onSuccess", "onError", "onGranted", "onDenied", "onBlocked"]) if (f in a) action(a[f], `${where}.${f}`);
  };

  const node = (n: N, path: string): void => {
    const where = `${path}/${n.type}${n.id ? "#" + n.id : ""}`;
    for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) bad.push(`${where}: node key ${k}`);
    if (!drawn.has(n.type)) { bad.push(`${where}: node type ${n.type}`); return; }
    const reads = b.props[n.type];
    if (reads === null || reads === undefined) bad.push(`${where}: no props known for ${n.type}`);
    else {
      for (const k of Object.keys(n.props ?? {})) if (!reads.includes(k) && !SERVER_ONLY_PROPS.has(k)) bad.push(`${where}: prop ${k}`);
      for (const k of Object.keys(n.bind ?? {})) if (!reads.includes(k)) bad.push(`${where}: bind ${k}`);
    }
    for (const ev of Object.keys(n.on ?? {})) {
      if (!["onAppear", "onDisappear"].includes(ev) && !(b.events[n.type] ?? []).includes(ev)) bad.push(`${where}: event ${ev}`);
      action(n.on![ev], `${where}.${ev}`);
    }
    condition(n.visibleIf, `${where}.visibleIf`, b.conditions);
    for (const [k, v] of Object.entries(n.style ?? {})) {
      if (!b.styleKeys.includes(k) && !STYLE_PASSTHROUGH.has(k)) bad.push(`${where}: style key ${k}`);
      if (v && typeof v === "object" && !Array.isArray(v) && ("then" in v || "else" in v)) condition(v, `${where}.style.${k}`, b.styleConditions);
    }
    for (const k of Object.keys(n.motion ?? {})) if (!["appear", "durationMs", "delayMs"].includes(k)) bad.push(`${where}: motion ${k}`);
    if (n.motion?.appear && !["fadeInUp", "fadeInDown", "scaleIn", "fade"].includes(n.motion.appear)) bad.push(`${where}: motion ${n.motion.appear}`);
    (n.children ?? []).forEach((c) => node(c, where));
  };

  node(screen.root, "");
  for (const [name, a] of Object.entries(screen.actions ?? {})) action(a, `actions.${name}`);
  return bad;
}

/** The node types in a tree. */
export const typesIn = (root: N): Set<string> => {
  const out = new Set<string>();
  const walk = (n: N): void => { out.add(n.type); (n.children ?? []).forEach(walk); };
  walk(root);
  return out;
};
