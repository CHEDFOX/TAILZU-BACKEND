/**
 * WHAT THE STORE BUILD CAN DRAW AND DO, READ OUT OF ITS OWN SOURCE.
 *
 * The builds in the App Store and Play run the phone repo's main branch. A
 * server screen made only of what they draw is a promise, and a promise worth
 * checking against the code that keeps it: this reads those files (sdui/
 * registry.ts, components.tsx, componentsV3.tsx, Rise.tsx, actions.ts,
 * Renderer.tsx) and says, by name, which node types are declared and drawn,
 * which props, bindings and events each reads, which action kinds are handled
 * and with which fields, which conditions are evaluated, and which style keys
 * are resolved. tests/onboard-store.test.ts holds the store variant's JSON to
 * it, against tests/fixtures/store-build.json (written by
 * scripts/store-build-fixture.ts) and, when the phone repo is at hand, against
 * the phone repo at STORE_COMMIT.
 *
 * It reads source with regular expressions, not a parser: the files are ours
 * and consistently written, and a shape it does not understand is a missing
 * name (which fails the test loudly), never an invented one.
 */

export interface StoreBuild {
  /** Node types the bundle declares to the server (CORE_COMPONENTS). */
  declared: string[];
  /** Node types the renderer has a component for (REGISTRY and REGISTRY_V3). */
  drawn: string[];
  /** Per type: the props and the bindings its component reads; null when its source is not among the files. */
  props: Record<string, string[] | null>;
  /** Per type: the events its component fires itself (onAppear and onDisappear are every node's). */
  events: Record<string, string[]>;
  /** Action kinds declared (CORE_ACTIONS) and handled. */
  actions: string[];
  /** Per action kind: the fields its case reads. */
  actionFields: Record<string, string[]>;
  /** The conditions evaluateCondition understands. */
  conditions: string[];
  /** The conditions a style value may carry. */
  styleConditions: string[];
  /** The style keys resolveStyle names. Any other reaches React Native untouched. */
  styleKeys: string[];
}

export interface StoreSources {
  registry: string;
  components: string;
  componentsV3: string;
  rise: string;
  actions: string;
  renderer: string;
}

/**
 * Comments out: a name in a comment is not a name in the code. A scanner, not
 * a pattern, because "//" and "/*" are also inside strings (a URL, a glob). A
 * quote closes at the end of its line, so an apostrophe in JSX text cannot
 * swallow the file.
 */
function code(src: string): string {
  let out = "";
  const n = src.length;
  for (let i = 0; i < n;) {
    const c = src[i]!, d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < n && src[i] !== c && (c === "`" || src[i] !== "\n")) { if (src[i] === "\\") out += src[i++]; out += src[i++] ?? ""; }
      if (src[i] === c) out += src[i++];
      continue;
    }
    out += c; i++;
  }
  return out;
}

const quoted = (s: string): string[] => [...s.matchAll(/["']([\w.]+)["']/g)].map((m) => m[1]!);

/** The text of `export const NAME ... = [ ... ]` or `{ ... }`, brackets balanced. */
function literal(src: string, name: string, open: "[" | "{"): string {
  const at = src.search(new RegExp(`const ${name}\\b`));
  if (at < 0) throw new Error(`no ${name}`);
  const eq = src.indexOf("=", at);
  const start = src.indexOf(open, eq);
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start + 1, i);
  }
  throw new Error(`${name} is not closed`);
}

/** The keys of a registry object: `Name`, `Name: Component`, not `...Spread`. Maps each to its component's identifier. */
function registryKeys(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0, cur = "";
  const parts: string[] = [];
  for (const ch of body) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const part = raw.trim();
    if (!part || part.startsWith("...")) continue;
    const m = /^(\w+)\s*(?::\s*(\w+))?$/.exec(part);
    if (m) out[m[1]!] = m[2] ?? m[1]!;
  }
  return out;
}

/** A top-level declaration's text: from its line to the next line that starts a new one at column 0. */
function definition(sources: string[], ident: string): string | null {
  for (const src of sources) {
    const m = new RegExp(`(?:^|\\n)(?:export )?(?:const|function) ${ident}\\b`).exec(src);
    if (!m) continue;
    const from = m.index + (src[m.index] === "\n" ? 1 : 0);
    const rest = src.slice(from);
    const end = rest.slice(1).search(/\n(?=[A-Za-z/@])/);
    return end < 0 ? rest : rest.slice(0, end + 1);
  }
  return null;
}

function propsRead(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\bprops\??\.(\w+)/g)) out.add(m[1]!);
  for (const m of body.matchAll(/\bprops\??\[\s*["'](\w+)["']\s*\]/g)) out.add(m[1]!);
  // const { a, b: c = 1 } = props
  for (const m of body.matchAll(/\{([^{}]*)\}\s*=\s*props\b/g)) {
    for (const part of m[1]!.split(",")) {
      const name = /^\s*(\w+)/.exec(part)?.[1];
      if (name) out.add(name);
    }
  }
  // A bound prop: `node.bind?.value`.
  for (const m of body.matchAll(/\bbind\??\.(\w+)/g)) out.add(m[1]!);
  return [...out].sort();
}

function eventsFired(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\bfire\(\s*["'](\w+)["']/g)) out.add(m[1]!);
  for (const m of body.matchAll(/\bnode\.on\??\.(\w+)/g)) out.add(m[1]!);
  return [...out].sort();
}

export function parseStoreBuild(src: StoreSources): StoreBuild {
  const declared = quoted(literal(code(src.registry), "CORE_COMPONENTS", "["));
  const actionsDeclared = quoted(literal(code(src.registry), "CORE_ACTIONS", "["));

  const v3 = registryKeys(literal(code(src.componentsV3), "REGISTRY_V3", "{"));
  const own = registryKeys(literal(code(src.components), "REGISTRY", "{"));
  const idents: Record<string, string> = { ...v3, ...own };
  const drawn = Object.keys(idents).sort();

  const files = [code(src.components), code(src.componentsV3), code(src.rise)];
  const props: Record<string, string[] | null> = {};
  const events: Record<string, string[]> = {};
  for (const [type, ident] of Object.entries(idents)) {
    // `export const Rise = ({ props ... }` is the one that is not a plain const.
    const body = definition(files, ident);
    props[type] = body === null ? null : propsRead(body);
    events[type] = body === null ? [] : eventsFired(body);
  }

  // The actions: the cases of runAction's switch, with the fields each reads.
  const a = code(src.actions);
  const sw = a.slice(a.indexOf("switch (action.kind)"));
  const cases = [...sw.matchAll(/^ {4}case "([\w.]+)":/gm)];
  const handled: string[] = [];
  const actionFields: Record<string, string[]> = {};
  let pending: string[] = [];
  cases.forEach((c, i) => {
    const end = i + 1 < cases.length ? cases[i + 1]!.index! : sw.length;
    const block = sw.slice(c.index! + c[0].length, end);
    pending.push(c[1]!);
    // `case "navigateBack": case "dismiss": ...` share one body.
    if (block.trim() === "") return;
    const fields = new Set<string>(["kind"]);
    for (const m of block.matchAll(/\baction\.(\w+)/g)) fields.add(m[1]!);
    for (const m of block.matchAll(/as \{\s*(\w+)\??:/g)) fields.add(m[1]!);
    for (const kind of pending) { handled.push(kind); actionFields[kind] = [...fields].sort(); }
    pending = [];
  });

  const evalAt = a.indexOf("export function evalCondition");
  const evalBody = a.slice(evalAt, a.indexOf("\n}\n", evalAt));
  const conditions = [...new Set([...evalBody.matchAll(/"(\w+)" in cond\b/g)].map((m) => m[1]!))].sort();

  const r = code(src.renderer);
  const styleConditions = quoted(literal(r, "STYLE_COND_KEYS", "[")).sort();

  const rs = definitionBody(code(src.components), "resolveStyle");
  const styleKeys = new Set<string>();
  for (const m of rs.matchAll(/\bs\.(\w+)/g)) styleKeys.add(m[1]!);
  for (const m of rs.matchAll(/for \(const k of \[([^\]]*)\]/g)) for (const k of quoted(m[1]!)) styleKeys.add(k);

  return {
    declared: declared.sort(),
    drawn,
    props,
    events,
    actions: actionsDeclared.filter((k) => handled.includes(k)).sort(),
    actionFields,
    conditions,
    styleConditions,
    styleKeys: [...styleKeys].sort(),
  };
}

function definitionBody(src: string, fn: string): string {
  const body = definition([src], fn);
  if (body === null) throw new Error(`no ${fn}`);
  return body;
}

/**
 * The phone repo commit the store binaries were built from. main has moved on
 * since (OTA updates carry newer renderers), so the store build is pinned here.
 * Move it when a new store build ships, then re-run store-build-fixture.ts.
 */
export const STORE_COMMIT = "622c76e";

/** The files, as the phone repo has them at STORE_COMMIT. */
export const STORE_FILES: Record<keyof StoreSources, string> = {
  registry: "app/src/sdui/registry.ts",
  components: "app/src/sdui/components.tsx",
  componentsV3: "app/src/sdui/componentsV3.tsx",
  rise: "app/src/sdui/Rise.tsx",
  actions: "app/src/sdui/actions.ts",
  renderer: "app/src/sdui/Renderer.tsx",
};
