/**
 * WHAT EACH LANGUAGE'S QUERY RESULTS MEAN: THE RULES THAT TURN MATCHED NODES INTO SYMBOLS, IMPORTS AND ROUTES.
 *
 * The queries (queries/<language>/*.scm) only find nodes. What makes a definition part of a file's surface is the language's: in TypeScript a
 * declaration is exported when `export` wraps it, in Python when its name has no leading underscore, in Go when it is capitalised, in Rust when it
 * is `pub`, in Java and C# by their modifiers. A thing inside a function body is local and is not a symbol. A method is named `Class.method`, as the
 * regex readers name theirs. Those rules, one adapter per language, are here.
 *
 * Every adapter reads only the nodes it is handed, and none throws on a shape it did not expect: it skips the node.
 */
import type { Node } from "web-tree-sitter";
import { CLIENT_RECEIVERS, isComponentRhs, upper, type Out } from "../symbolkit.js";
import type { RawImport } from "../graph.js";
import type { SymbolInfo } from "../types.js";
import type { GrammarId } from "./host.js";

// ------------------------------------------------------------------ shapes

export interface Def {
  /** The kind the query named: function, method, class, interface, type, enum, struct, trait, module, const, variable, cjs. */
  kind: string;
  /** The whole declaration. */
  node: Node;
  /** Its name. */
  name: Node;
  /** Every other capture of the match (@receiver, @value). */
  caps: Readonly<Record<string, Node>>;
}

export interface Match {
  /** Capture name to node, the last of a name winning. */
  caps: Readonly<Record<string, Node>>;
  /** The match's first capture that names a kind (`route`, `route.config`, `import.from`...). */
  tag: string;
}

export interface Rt {
  id: GrammarId;
  lang: string;
  path: string;
  /** The text that was parsed (a Vue file's script, not the whole file). */
  text: string;
  root: Node;
  /** JSX can appear in this file: a capitalised function is a component. */
  jsx: boolean;
}

export interface Adapter {
  defs(rt: Rt, defs: Def[], out: Out, matches: Match[]): void;
  imports?(rt: Rt, matches: Match[]): RawImport[];
  routes?(rt: Rt, matches: Match[], out: Out): void;
}

// ----------------------------------------------------------------- helpers

export const row = (n: Node): number => n.startPosition.row + 1;
export const endRow = (n: Node): number => n.endPosition.row + 1;

function ancestor(n: Node, types: ReadonlySet<string>): Node | null {
  for (let p = n.parent; p; p = p.parent) if (types.has(p.type)) return p;
  return null;
}

/** The words written before a declaration's name (modifiers, keywords), annotations and attributes taken out. */
function header(rt: Rt, d: Def): string {
  return rt.text.slice(d.node.startIndex, Math.max(d.node.startIndex, d.name.startIndex)).replace(/@[\w.]+(?:\([^)]*\))?/g, " ").replace(/\[[^\]]*\]/g, " ");
}

const stripQuotes = (s: string): string => s.replace(/^[rRuUbBfF]*(['"`]{1,3})([\s\S]*?)\1$/, "$2");

/** Records a symbol with the last line of the node it is. */
function put(out: Out, s: SymbolInfo, n: Node): void {
  out.add({ ...s, endLine: endRow(n) });
}

const fnKind = (rt: Rt, name: string): SymbolInfo["kind"] => (rt.jsx && upper(name) ? "component" : "function");

// ============================================================== TypeScript, JS

const TS_WRAP = new Set(["export_statement", "ambient_declaration", "expression_statement"]);
const TS_BODY_OWNERS = new Set(["internal_module", "module"]);

/** A statement of the file itself or of a namespace's body, not one inside a function, a block or a loop. */
function tsTop(n: Node): boolean {
  let p = n.parent;
  while (p && TS_WRAP.has(p.type)) p = p.parent;
  if (!p) return false;
  if (p.type === "program") return true;
  return p.type === "statement_block" && !!p.parent && TS_BODY_OWNERS.has(p.parent.type);
}

function tsExported(n: Node): boolean {
  for (let p = n.parent; p && TS_WRAP.has(p.type); p = p.parent) if (p.type === "export_statement") return true;
  return false;
}

const FN_VALUES = new Set(["arrow_function", "function_expression", "generator_function", "function"]);

function unwrapValue(v: Node | null): Node | null {
  let cur = v;
  for (let i = 0; cur && i < 4; i += 1) {
    if (cur.type === "as_expression" || cur.type === "satisfies_expression" || cur.type === "parenthesized_expression" || cur.type === "non_null_expression") cur = cur.firstNamedChild;
    else break;
  }
  return cur;
}

function tsVariableKind(rt: Rt, name: string, value: Node | null): SymbolInfo["kind"] {
  const v = unwrapValue(value);
  if (!v) return "const";
  if (FN_VALUES.has(v.type)) return fnKind(rt, name);
  if (v.type === "class") return "class";
  if (v.type === "call_expression" || v.type === "await_expression") {
    const call = v.type === "await_expression" ? v.firstNamedChild : v;
    if (call?.type === "call_expression") {
      const head = `${call.childForFieldName("function")?.text ?? ""}(`;
      if (upper(name) && isComponentRhs(head)) return "component";
    }
  }
  return "const";
}

function tsClassOf(body: Node): { node: Node; name: string; surfaced: boolean; exported: boolean } | null {
  const cls = body.parent;
  if (!cls) return null;
  if (cls.type === "class_declaration" || cls.type === "abstract_class_declaration") {
    return { node: cls, name: cls.childForFieldName("name")?.text ?? "default", surfaced: tsTop(cls), exported: tsExported(cls) };
  }
  if (cls.type === "class") {
    // `const Foo = class { ... }` or `export default class { ... }`
    const decl = cls.parent;
    if (decl?.type === "variable_declarator") {
      const stmt = decl.parent;
      return { node: cls, name: decl.childForFieldName("name")?.text ?? "default", surfaced: !!stmt && tsTop(stmt), exported: !!stmt && tsExported(stmt) };
    }
    if (decl?.type === "export_statement") return { node: cls, name: "default", surfaced: true, exported: true };
  }
  return null;
}

function tsDefs(rt: Rt, defs: Def[], out: Out, matches: Match[]): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    switch (d.kind) {
      case "function":
        if (!tsTop(n)) break;
        put(out, { name, kind: fnKind(rt, name), line: row(n), exported: tsExported(n) }, n);
        break;
      case "class": case "interface": case "type": case "enum":
        if (!tsTop(n)) break;
        put(out, { name, kind: d.kind, line: row(n), exported: tsExported(n) }, n);
        break;
      case "module": {
        if (!tsTop(n)) break;
        put(out, { name: name.replace(/^["']|["']$/g, ""), kind: "module", line: row(n), exported: tsExported(n) }, n);
        break;
      }
      case "variable": {
        const decl = n.parent;
        if (!decl || (decl.type !== "lexical_declaration" && decl.type !== "variable_declaration") || !tsTop(decl)) break;
        const kind = tsVariableKind(rt, name, n.childForFieldName("value"));
        // One declarator: the statement is the definition (its `export` and its last line). Several (`const a = 1, b = 2`): each is its own.
        const single = decl.namedChildren.filter((c) => c.type === "variable_declarator").length === 1;
        put(out, { name, kind, line: row(single ? decl : n), exported: tsExported(decl) }, single ? decl : n);
        break;
      }
      case "method": {
        const body = n.parent;
        if (!body || body.type !== "class_body") break;
        const cls = tsClassOf(body);
        if (!cls || !cls.surfaced) break;
        if (name === "constructor" || d.name.type === "string") break;
        const mods = n.children.filter((c) => c.type === "accessibility_modifier").map((c) => c.text);
        const priv = name.startsWith("#") || mods.includes("private") || mods.includes("protected");
        put(out, { name: `${cls.name}.${name}`, kind: "method", line: row(n), exported: cls.exported && !priv }, n);
        break;
      }
      default: break;
    }
  }

  // export default ..., export { a as b }, CommonJS
  const exportedNames = (name: string): boolean => out.exportNamed(name);
  for (const m of matches) {
    const e = m.caps["export"];
    if (m.tag === "export" && e) {
      const value = e.childForFieldName("value");
      const decl = e.childForFieldName("declaration");
      if (value && !decl) {
        const line = row(e);
        if (value.type === "identifier") {
          if (!exportedNames(value.text)) put(out, { name: value.text, kind: fnKind(rt, value.text), line, exported: true }, e);
          else put(out, { name: "default", kind: "const", line, exported: true }, e);
        } else if (FN_VALUES.has(value.type)) {
          put(out, { name: "default", kind: rt.jsx ? "component" : "function", line, exported: true }, e);
        } else if (value.type === "class") {
          put(out, { name: "default", kind: "class", line, exported: true }, e);
        } else if (value.type === "call_expression" && /^(?:React\.)?(?:memo|forwardRef)$|^(?:observer|connect)$/.test(value.childForFieldName("function")?.text ?? "")) {
          put(out, { name: "default", kind: "component", line, exported: true }, e);
        } else {
          put(out, { name: "default", kind: rt.jsx ? "component" : "const", line, exported: true }, e);
        }
      } else if (!decl && !e.childForFieldName("source")) {
        const clause = e.namedChildren.find((c) => c.type === "export_clause");
        for (const spec of clause?.namedChildren ?? []) {
          if (spec.type !== "export_specifier") continue;
          const local = spec.childForFieldName("name")?.text;
          if (!local) continue;
          const as = spec.childForFieldName("alias")?.text ?? local;
          if (as === local) {
            // `export { a }` makes the local a exported; a name that is not defined here (re-exported import) is a symbol of its own.
            if (!exportedNames(local)) put(out, { name: as, kind: fnKind(rt, as), line: row(e), exported: true }, e);
          } else {
            // `export { a as b }` shows the outside world b, not a: b is the symbol (of a's kind), and a stays as private as it was.
            const kind = out.items.find((x) => x.name === local && x.kind !== "route" && x.kind !== "env")?.kind ?? fnKind(rt, as);
            put(out, { name: as, kind, line: row(e), exported: true }, e);
          }
        }
      }
    }
  }
  for (const d of defs) {
    if (d.kind !== "cjs" || d.node.parent?.parent?.type !== "program") continue;
    const value = d.caps["value"] ?? null;
    put(out, { name: d.name.text, kind: value && FN_VALUES.has(value.type) ? "function" : "const", line: row(d.node), exported: true }, d.node);
  }
  for (const m of matches) {
    if (m.tag !== "cjs.root") continue;
    const stmt = m.caps["cjs.root"]!;
    if (stmt.parent?.type !== "program") continue;
    const value = m.caps["value"];
    if (!value) continue;
    if (value.type === "object") {
      for (const c of value.namedChildren) {
        const nm = c.type === "shorthand_property_identifier" ? c.text : c.type === "pair" || c.type === "method_definition" ? c.childForFieldName(c.type === "pair" ? "key" : "name")?.text : undefined;
        if (nm && /^[A-Za-z_$][\w$]*$/.test(nm) && !exportedNames(nm)) put(out, { name: nm, kind: "function", line: row(stmt), exported: true }, stmt);
      }
    } else if (value.type === "identifier" && !exportedNames(value.text)) {
      put(out, { name: value.text, kind: "const", line: row(stmt), exported: true }, stmt);
    }
  }
}

function tsImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text }); }
  return out;
}

const HANDLER_OBJECT_KEYS = /^\s*\{\s*(?:preHandler|onRequest|schema|config)\b/;

function tsRoutes(rt: Rt, matches: Match[], out: Out): void {
  let prefix: string | null = null;
  for (const m of matches) {
    const verb = m.caps["verb"]?.text ?? "";
    if (m.tag === "route.decorator") {
      if (verb === "Controller" && prefix === null) prefix = m.caps["path"] ? `/${m.caps["path"].text.replace(/^\/+|\/+$/g, "")}` : "";
    }
  }
  for (const m of matches) {
    const verb = m.caps["verb"]?.text ?? "";
    const at = m.caps["route"] ?? m.caps["route.config"] ?? m.caps["route.decorator"];
    if (!at) continue;
    if (m.tag === "route") {
      const receiver = m.caps["receiver"];
      const last = receiver ? (receiver.type === "member_expression" ? receiver.childForFieldName("property")?.text : receiver.type === "identifier" ? receiver.text : undefined) : undefined;
      if (last !== undefined && CLIENT_RECEIVERS.test(last)) continue;
      const path = m.caps["path"]!.text;
      if (!path.startsWith("/") && path !== "*") continue;
      if (verb !== "route") {
        const h = m.caps["handler"];
        // A server passes a handler after the path; a client passes a config object (or nothing).
        if (!h) continue;
        if (h.type === "object" && !/=>|function/.test(h.text) && !HANDLER_OBJECT_KEYS.test(h.text)) continue;
      }
      out.add({ name: path, kind: "route", line: row(at), method: verb === "all" || verb === "route" ? "ANY" : verb.toUpperCase(), path });
    } else if (m.tag === "route.config") {
      const cfg = m.caps["config"]!;
      let url = "", method = "ANY";
      for (const pair of cfg.namedChildren) {
        if (pair.type !== "pair") continue;
        const key = pair.childForFieldName("key")?.text.replace(/^['"]|['"]$/g, "");
        const val = pair.childForFieldName("value");
        if (!val) continue;
        if (key === "url" && val.type === "string") url = stripQuotes(val.text);
        if (key === "method") method = (val.text.match(/[A-Za-z]+/g) ?? []).map((v) => v.toUpperCase()).join("|") || "ANY";
      }
      if (url) out.add({ name: url, kind: "route", line: row(at), method, path: url });
    } else if (m.tag === "route.decorator" && verb !== "Controller") {
      const sub = m.caps["path"] ? `/${m.caps["path"].text.replace(/^\/+/, "")}` : "";
      const full = ((prefix ?? "") + sub) || "/";
      out.add({ name: full, kind: "route", line: row(at), method: verb === "All" ? "ANY" : verb.toUpperCase(), path: full });
    }
  }
  void rt;
}

// ==================================================================== Python

const PY_FN_OWNERS = new Set(["function_definition", "lambda"]);
const PY_CLASS = new Set(["class_definition"]);

function pyDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (d.kind === "variable") {
      // Only module-level UPPER_CASE names are constants worth a symbol (a lower-case assignment is a variable, not a definition people ask "where" about).
      if (/^[A-Z][A-Z0-9_]*$/.test(name) && n.parent?.parent?.type === "module" || (/^[A-Z][A-Z0-9_]*$/.test(name) && n.parent?.type === "module")) {
        put(out, { name, kind: "const", line: row(n), exported: true }, n);
      }
      continue;
    }
    if (ancestor(n, PY_FN_OWNERS)) continue;
    const owner = ancestor(n, PY_CLASS);
    if (d.kind === "function") {
      if (owner) put(out, { name: `${owner.childForFieldName("name")?.text ?? ""}.${name}`, kind: "method", line: row(n), exported: !name.startsWith("_") }, n);
      else put(out, { name, kind: "function", line: row(n), exported: !name.startsWith("_") }, n);
    } else if (d.kind === "class") {
      put(out, { name, kind: "class", line: row(n), exported: !name.startsWith("_") }, n);
    }
  }
  for (const c of rt.root.namedChildren) {
    if (c.type === "if_statement" && /^\s*__name__\s*==\s*['"]__main__['"]|['"]__main__['"]\s*==\s*__name__/.test(c.childForFieldName("condition")?.text ?? "")) {
      out.add({ name: "__main__", kind: "entry", line: row(c) });
    }
  }
}

function pyImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) {
    const imp = m.caps["import"];
    const from = m.caps["import.from"];
    if (imp) {
      for (const c of imp.namedChildren) {
        const dotted = c.type === "dotted_name" ? c : c.type === "aliased_import" ? c.childForFieldName("name") : null;
        if (dotted) out.push({ spec: dotted.text });
      }
    } else if (from) {
      const mod = from.childForFieldName("module_name");
      let level = 0, spec = "";
      if (mod?.type === "relative_import") {
        level = (mod.namedChildren.find((c) => c.type === "import_prefix")?.text ?? "").length;
        spec = mod.namedChildren.find((c) => c.type === "dotted_name")?.text ?? "";
      } else if (mod) spec = mod.text;
      const names: string[] = [];
      for (const c of from.namedChildren) {
        if (c === mod || c.id === mod?.id) continue;
        const nm = c.type === "dotted_name" ? c.text : c.type === "aliased_import" ? c.childForFieldName("name")?.text : undefined;
        if (nm && /^\w+$/.test(nm)) names.push(nm);
      }
      out.push({ spec, level, names });
    }
  }
  return out;
}

function pyRoutes(rt: Rt, matches: Match[], out: Out): void {
  const urlpatterns = /\burlpatterns\b/.test(rt.text);
  for (const m of matches) {
    if (m.tag === "route") {
      const verb = m.caps["verb"]!.text;
      const path = m.caps["path"]!.text;
      let method = verb === "route" || verb === "api_route" ? "GET" : verb === "websocket" ? "WS" : verb.toUpperCase();
      if (verb === "route" || verb === "api_route") {
        const ms = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(m.caps["args"]?.text ?? "");
        if (ms) method = (ms[1]!.match(/[A-Za-z]+/g) ?? ["GET"]).map((v) => v.toUpperCase()).join("|");
      }
      out.add({ name: path, kind: "route", line: row(m.caps["verb"]!), method, path });
    } else if (m.tag === "route.django" && urlpatterns) {
      const p = m.caps["path"]!.text.replace(/^\^/, "").replace(/\$$/, "");
      const route = `/${p.replace(/^\/+/, "")}`;
      out.add({ name: route, kind: "route", line: row(m.caps["route.django"]!), method: "ANY", path: route });
    }
  }
}

// ======================================================================== Go

const GO_FN = new Set(["function_declaration", "method_declaration", "func_literal"]);

function goDefs(rt: Rt, defs: Def[], out: Out): void {
  const isMain = /^\s*package\s+main\b/m.test(rt.text);
  const seen = new Set<number>();
  // A struct or an interface is also a type: the more telling kind wins, whichever the query reported first.
  const rank: Record<string, number> = { struct: 3, interface: 3, method: 3, function: 3, type: 1, const: 1 };
  const best = new Map<number, Def>();
  for (const d of defs) { const cur = best.get(d.name.id); if (!cur || (rank[d.kind] ?? 0) > (rank[cur.kind] ?? 0)) best.set(d.name.id, d); }
  for (const d of best.values()) {
    if (seen.has(d.name.id)) continue;
    seen.add(d.name.id);
    const n = d.node;
    const name = d.name.text;
    if (d.kind === "function") {
      put(out, { name, kind: "function", line: row(n), exported: upper(name) }, n);
      if (isMain && name === "main") out.add({ name: "main", kind: "entry", line: row(n) });
    } else if (d.kind === "method") {
      const recv = d.caps["receiver"]?.descendantsOfType("type_identifier")[0]?.text;
      put(out, { name: recv ? `${recv}.${name}` : name, kind: "method", line: row(n), exported: upper(name) }, n);
    } else if (ancestor(n, GO_FN)) {
      continue;
    } else if (d.kind === "struct" || d.kind === "interface" || d.kind === "type") {
      put(out, { name, kind: d.kind, line: row(n), exported: upper(name) }, n);
    } else if (d.kind === "const" && name !== "_") {
      put(out, { name, kind: "const", line: row(n), exported: upper(name) }, n);
    }
  }
}

function goImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text }); }
  return out;
}

function goRoutes(_rt: Rt, matches: Match[], out: Out): void {
  for (const m of matches) {
    const verb = m.caps["verb"]!.text;
    const spec = m.caps["path"]!.text;
    const at = m.caps["route"]!;
    if (verb === "HandleFunc" || verb === "Handle") {
      const sp = /^([A-Z]+)\s+(\S+)$/.exec(spec);
      const path = sp ? sp[2]! : spec;
      out.add({ name: path, kind: "route", line: row(at), method: sp ? sp[1]! : "ANY", path });
    } else if (spec.startsWith("/")) {
      const v = verb.toUpperCase();
      out.add({ name: spec, kind: "route", line: row(at), method: v === "ANY" ? "ANY" : v, path: spec });
    }
  }
}

// ====================================================================== Rust

const RUST_FN = new Set(["function_item"]);

function rustTypeName(impl: Node): string {
  const t = impl.childForFieldName("type")?.text ?? "";
  return /^[\w:]+/.exec(t)?.[0]?.split("::").pop() ?? t;
}

function rustDefs(_rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, RUST_FN)) continue;
    const pub = n.children.some((c) => c.type === "visibility_modifier");
    const owner = ancestor(n, new Set(["impl_item", "trait_item"]));
    if (d.kind === "function") {
      if (owner?.type === "impl_item") {
        const traitImpl = !!owner.childForFieldName("trait");
        put(out, { name: `${rustTypeName(owner)}.${name}`, kind: "method", line: row(n), exported: pub || traitImpl }, n);
      } else if (owner?.type === "trait_item") {
        put(out, { name: `${owner.childForFieldName("name")?.text ?? ""}.${name}`, kind: "method", line: row(n), exported: owner.children.some((c) => c.type === "visibility_modifier") }, n);
      } else {
        put(out, { name, kind: "function", line: row(n), exported: pub }, n);
        if (name === "main" && n.parent?.type === "source_file") out.add({ name: "main", kind: "entry", line: row(n) });
      }
    } else if (!owner) {
      put(out, { name, kind: d.kind as SymbolInfo["kind"], line: row(n), exported: pub }, n);
    }
  }
}

function rustImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text }); }
  return out;
}

function rustRoutes(_rt: Rt, matches: Match[], out: Out): void {
  for (const m of matches) {
    const path = m.caps["path"]!.text;
    if (m.tag === "route") {
      const verb = m.caps["verb"]!.text;
      out.add({ name: path, kind: "route", line: row(m.caps["route"]!), method: verb.toUpperCase(), path });
    } else if (m.tag === "route.axum") {
      const method = m.caps["method"]!.text;
      if (/^(get|post|put|patch|delete|any)$/.test(method)) out.add({ name: path, kind: "route", line: row(m.caps["route.axum"]!), method: method === "any" ? "ANY" : method.toUpperCase(), path });
    }
  }
}

// ====================================================================== Java

const JAVA_LOCAL = new Set(["method_declaration", "constructor_declaration", "lambda_expression", "object_creation_expression", "static_initializer", "block"]);
const JAVA_TYPES = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"]);

function javaDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, JAVA_LOCAL)) continue;
    const owner = ancestor(n, JAVA_TYPES);
    const h = header(rt, d);
    const inInterface = owner?.type === "interface_declaration" || owner?.type === "annotation_type_declaration";
    const exported = /\bpublic\b/.test(h) || (inInterface && !/\bprivate\b/.test(h));
    if (d.kind === "method") {
      if (!owner) continue;
      put(out, { name: `${owner.childForFieldName("name")?.text ?? ""}.${name}`, kind: "method", line: row(n), exported }, n);
      if (name === "main" && /\bstatic\b/.test(h)) out.add({ name: "main", kind: "entry", line: row(n) });
    } else {
      put(out, { name, kind: d.kind as SymbolInfo["kind"], line: row(n), exported: exported || (!owner && /\bpublic\b/.test(h)) }, n);
    }
  }
}

const importSpec = (text: string): string => text.replace(/^\s*import\s+/, "").replace(/^static\s+/, "").replace(/;\s*$/, "").replace(/\s+as\s+\w+\s*$/, "").replace(/\.\*\s*$/, "").trim();

function javaImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const i = m.caps["import"]; if (i) out.push({ spec: importSpec(i.text) }); }
  return out;
}

function javaRoutes(_rt: Rt, matches: Match[], out: Out): void {
  const mapping = /^(Get|Post|Put|Patch|Delete|Request)Mapping$/;
  const classOf = (a: Node): Node | null => {
    const mods = a.parent;
    return mods?.type === "modifiers" && mods.parent && JAVA_TYPES.has(mods.parent.type) ? mods.parent : null;
  };
  const prefixes = new Map<number, string>();
  for (const m of matches) {
    const a = m.caps["route"];
    if (!a || m.tag !== "route") continue;
    const mm = mapping.exec(m.caps["verb"]!.text);
    const owner = classOf(a);
    if (mm?.[1] === "Request" && owner && m.caps["path"]) prefixes.set(owner.id, `/${m.caps["path"].text.replace(/^\/+|\/+$/g, "")}`);
  }
  for (const m of matches) {
    const a = m.caps["route"] ?? m.caps["route.bare"];
    if (!a) continue;
    const mm = mapping.exec(m.caps["verb"]!.text);
    if (!mm) continue;
    if (classOf(a)) continue; // the class's own @RequestMapping is a prefix, not a route
    const cls = ancestor(a, JAVA_TYPES);
    const prefix = cls ? prefixes.get(cls.id) ?? "" : "";
    const sub = m.caps["path"] ? `/${m.caps["path"].text.replace(/^\/+/, "")}` : "";
    const full = (prefix + sub) || "/";
    out.add({ name: full, kind: "route", line: row(a), method: mm[1] === "Request" ? "ANY" : mm[1]!.toUpperCase(), path: full });
  }
}

// ==================================================================== Kotlin

const KT_FN = new Set(["function_declaration", "lambda_literal", "anonymous_function", "secondary_constructor", "anonymous_initializer"]);
const KT_OWNERS = new Set(["class_declaration", "object_declaration", "companion_object"]);

function ktDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, KT_FN)) continue;
    const h = header(rt, d);
    const exported = !/\b(?:private|protected)\b/.test(h);
    const owner = ancestor(n, KT_OWNERS);
    const ownerName = owner ? (owner.type === "companion_object" ? ancestor(owner, new Set(["class_declaration", "object_declaration"]))?.namedChildren.find((c) => c.type === "type_identifier")?.text : owner.namedChildren.find((c) => c.type === "type_identifier")?.text) : undefined;
    if (d.kind === "function") {
      if (owner && ownerName) put(out, { name: `${ownerName}.${name}`, kind: "method", line: row(n), exported }, n);
      else if (!owner) {
        put(out, { name, kind: "function", line: row(n), exported }, n);
        if (name === "main") out.add({ name: "main", kind: "entry", line: row(n) });
      }
    } else if (d.kind === "class") {
      put(out, { name, kind: /\binterface\b/.test(h) ? "interface" : /\benum\b/.test(h) ? "enum" : "class", line: row(n), exported }, n);
    } else if (d.kind === "type") {
      put(out, { name, kind: "type", line: row(n), exported }, n);
    } else if (d.kind === "variable" && !owner && /\bconst\b/.test(h) && n.parent?.type === "source_file") {
      put(out, { name, kind: "const", line: row(n), exported }, n);
    }
  }
}

function ktImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const i = m.caps["import"]; if (i) out.push({ spec: importSpec(i.text) }); }
  return out;
}

function ktRoutes(_rt: Rt, matches: Match[], out: Out): void {
  for (const m of matches) {
    const verb = m.caps["verb"]!.text;
    const path = stripQuotes(m.caps["path"]!.text);
    if (!path.startsWith("/")) continue;
    out.add({ name: path, kind: "route", line: row(m.caps["route"]!), method: verb.toUpperCase(), path });
  }
}

// ===================================================================== Ruby

const RB_FN = new Set(["method", "singleton_method", "lambda"]);
const RB_OWNERS = new Set(["class", "module"]);

function rbDefs(_rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    let name = d.name.text;
    if (ancestor(n, RB_FN)) continue;
    const owner = ancestor(n, RB_OWNERS);
    const ownerName = owner?.childForFieldName("name")?.text;
    if (d.kind === "class" || d.kind === "module") {
      put(out, { name, kind: d.kind === "module" ? "module" : "class", line: row(n), exported: true }, n);
    } else if (d.kind === "method") {
      // `private` on a line of its own makes the methods after it private.
      let priv = name.startsWith("_");
      for (let s = n.previousNamedSibling; s && !priv; s = s.previousNamedSibling) {
        if (s.type === "identifier" && /^(?:private|protected|public)$/.test(s.text)) { priv = s.text !== "public"; break; }
        if (s.type === "identifier" || s.type === "call") continue;
      }
      if (n.type === "singleton_method") name = name.replace(/^self\./, "");
      put(out, { name: owner && ownerName ? `${ownerName}.${name}` : name, kind: owner ? "method" : "function", line: row(n), exported: !priv }, n);
    } else if (d.kind === "const" && /^[A-Z][A-Z0-9_]+$/.test(name)) {
      put(out, { name, kind: "const", line: row(n), exported: true }, n);
    }
  }
}

function rbImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text }); }
  return out;
}

function rbRoutes(rt: Rt, matches: Match[], out: Out): void {
  const rails = /(?:^|\/)routes(?:\/[\w-]+)?\.rb$/.test(rt.path);
  for (const m of matches) {
    const at = m.caps["route"] ?? m.caps["route.resources"] ?? m.caps["route.root"];
    if (!at) continue;
    if (m.tag === "route.resources") {
      if (rails) { const nm = `/${m.caps["symbol"]!.text.replace(/^:/, "")}`; out.add({ name: nm, kind: "route", line: row(at), method: "ANY", path: nm }); }
    } else if (m.tag === "route.root") {
      if (rails) out.add({ name: "/", kind: "route", line: row(at), method: "GET", path: "/" });
    } else {
      const verb = m.caps["verb"]!.text;
      const raw = m.caps["path"]!.text;
      if (rails) { const p = `/${raw.replace(/^\//, "")}`; out.add({ name: p, kind: "route", line: row(at), method: verb === "match" ? "ANY" : verb.toUpperCase(), path: p }); }
      else if (raw.startsWith("/") && verb !== "match" && (at.childForFieldName("block") || /,/.test(at.childForFieldName("arguments")?.text ?? ""))) {
        out.add({ name: raw, kind: "route", line: row(at), method: verb.toUpperCase(), path: raw });
      }
    }
  }
}

// ======================================================================= PHP

const PHP_FN = new Set(["function_definition", "method_declaration", "anonymous_function", "arrow_function"]);
const PHP_OWNERS = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"]);

function phpDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, PHP_FN)) continue;
    const owner = ancestor(n, PHP_OWNERS);
    const h = header(rt, d);
    const exported = !/\b(?:private|protected)\b/.test(h) && !n.children.some((c) => c.type === "visibility_modifier" && /private|protected/.test(c.text));
    if (d.kind === "method") {
      if (owner) put(out, { name: `${owner.childForFieldName("name")?.text ?? ""}.${name}`, kind: "method", line: row(n), exported }, n);
    } else if (d.kind === "function") {
      put(out, { name, kind: "function", line: row(n), exported: true }, n);
    } else if (d.kind === "const") {
      if (!owner) put(out, { name, kind: "const", line: row(n), exported: true }, n);
    } else {
      put(out, { name, kind: d.kind as SymbolInfo["kind"], line: row(n), exported: true }, n);
    }
  }
}

function phpImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text }); }
  return out;
}

function phpRoutes(_rt: Rt, matches: Match[], out: Out): void {
  for (const m of matches) {
    const verb = m.caps["verb"]!.text;
    const p = `/${m.caps["path"]!.text.replace(/^\/+/, "")}`;
    out.add({ name: p, kind: "route", line: row(m.caps["route"]!), method: verb === "any" || verb === "match" ? "ANY" : verb.toUpperCase(), path: p });
  }
}

// ===================================================================== Swift

const SWIFT_FN = new Set(["function_declaration", "init_declaration", "lambda_literal", "deinit_declaration"]);
const SWIFT_OWNERS = new Set(["class_declaration", "protocol_declaration"]);

function swiftDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, SWIFT_FN)) continue;
    const owner = ancestor(n, SWIFT_OWNERS);
    const h = header(rt, d);
    const attrs = rt.text.slice(n.startIndex, d.name.startIndex);
    const exported = !/\b(?:private|fileprivate)\b/.test(h);
    if (/(?:^|\s)@main\b/.test(attrs)) out.add({ name: "main", kind: "entry", line: row(n) });
    if (d.kind === "class") {
      const kw = /\b(struct|class|enum|actor|extension)\b/.exec(h)?.[1] ?? "class";
      // An extension adds to a type that is defined somewhere else: its methods are recorded, it is not a definition of its own.
      if (kw === "extension") continue;
      const rest = rt.text.slice(d.name.endIndex, (n.childForFieldName("body")?.startIndex ?? n.endIndex));
      const view = /:\s*[^{]*\bView\b/.test(rest);
      put(out, { name, kind: view ? "component" : kw === "enum" ? "enum" : kw === "struct" ? "struct" : "class", line: row(n), exported }, n);
    } else if (d.kind === "interface") {
      put(out, { name, kind: "interface", line: row(n), exported }, n);
    } else if (d.kind === "function") {
      if (owner) {
        const on = owner.childForFieldName("name");
        const oname = on?.text;
        if (oname) put(out, { name: `${oname}.${name}`, kind: "method", line: row(n), exported }, n);
      } else put(out, { name, kind: "function", line: row(n), exported }, n);
    } else if (d.kind === "type") {
      put(out, { name, kind: "type", line: row(n), exported }, n);
    } else if (d.kind === "variable" && !owner && n.parent?.type === "source_file") {
      put(out, { name, kind: "const", line: row(n), exported }, n);
    }
  }
}

// ====================================================================== C#

const CS_LOCAL = new Set(["method_declaration", "constructor_declaration", "local_function_statement", "lambda_expression", "anonymous_method_expression", "accessor_declaration"]);
const CS_TYPES = new Set(["class_declaration", "record_declaration", "struct_declaration", "interface_declaration", "enum_declaration"]);

function csDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, CS_LOCAL)) continue;
    const owner = ancestor(n, CS_TYPES);
    const mods = n.children.filter((c) => c.type === "modifier").map((c) => c.text);
    const inInterface = owner?.type === "interface_declaration";
    if (d.kind === "method") {
      if (!owner) continue;
      const exported = mods.includes("public") || (inInterface && !mods.includes("private"));
      put(out, { name: `${owner.childForFieldName("name")?.text ?? ""}.${name}`, kind: "method", line: row(n), exported }, n);
      if (name === "Main" && mods.includes("static")) out.add({ name: "Main", kind: "entry", line: row(n) });
    } else if (d.kind === "module") {
      put(out, { name, kind: "module", line: row(n), exported: true }, n);
    } else {
      const exported = mods.includes("public") || mods.includes("internal") || (!owner && !mods.includes("private"));
      put(out, { name, kind: d.kind as SymbolInfo["kind"], line: row(n), exported }, n);
    }
  }
  if (/\bWebApplication\.CreateBuilder\b/.test(rt.text)) out.add({ name: "Program", kind: "entry", line: 1 });
}

function csRoutes(_rt: Rt, matches: Match[], out: Out): void {
  const prefixes = new Map<number, string>();
  const ownerOf = (a: Node): Node | null => {
    const list = a.parent;
    return list?.type === "attribute_list" && list.parent && CS_TYPES.has(list.parent.type) ? list.parent : null;
  };
  for (const m of matches) {
    const a = m.caps["route.attribute"];
    if (!a || m.caps["verb"]?.text !== "Route") continue;
    const owner = ownerOf(a);
    if (owner && m.caps["path"]) {
      const cname = (owner.childForFieldName("name")?.text ?? "").replace(/Controller$/, "").toLowerCase();
      prefixes.set(owner.id, `/${m.caps["path"].text.replace(/\[controller\]/gi, cname).replace(/^\/+|\/+$/g, "")}`);
    }
  }
  for (const m of matches) {
    const a = m.caps["route.attribute"];
    if (a) {
      const mm = /^Http(Get|Post|Put|Patch|Delete)$/.exec(m.caps["verb"]!.text);
      if (!mm) continue;
      // The bare pattern also matches an attribute that has arguments (the grammar names no field for them): the one with the path is the route.
      if (!m.caps["path"] && a.namedChildren.some((c) => c.type === "attribute_argument_list")) continue;
      const cls = ancestor(a, CS_TYPES);
      const prefix = cls ? prefixes.get(cls.id) ?? "" : "";
      const sub = m.caps["path"] ? `/${m.caps["path"].text.replace(/^\/+/, "")}` : "";
      const full = (prefix + sub) || "/";
      out.add({ name: full, kind: "route", line: row(a), method: mm[1]!.toUpperCase(), path: full });
    } else if (m.tag === "route") {
      const mm = /^Map(Get|Post|Put|Patch|Delete)$/.exec(m.caps["verb"]!.text);
      if (!mm) continue;
      const p = `/${m.caps["path"]!.text.replace(/^\/+/, "")}`;
      out.add({ name: p, kind: "route", line: row(m.caps["route"]!), method: mm[1]!.toUpperCase(), path: p });
    }
  }
}

// ===================================================================== Dart

const DART_LOCAL = new Set(["function_body", "function_expression_body"]);
const WIDGET = /\bextends\s+[\w<>,? ]*Widget\b|\bextends\s+(?:Stateless|Stateful|Consumer|Hook)\w*/;

function dartDefs(rt: Rt, defs: Def[], out: Out): void {
  for (const d of defs) {
    const n = d.node;
    const name = d.name.text;
    if (ancestor(n, DART_LOCAL)) continue;
    const exported = !name.startsWith("_");
    if (d.kind === "class") {
      const head = rt.text.slice(n.startIndex, n.childForFieldName("body")?.startIndex ?? n.endIndex);
      put(out, { name, kind: WIDGET.test(head) ? "component" : "class", line: row(n), exported }, n);
    } else if (d.kind === "enum" || d.kind === "type") {
      put(out, { name, kind: d.kind, line: row(n), exported }, n);
    } else if (d.kind === "function") {
      // The body is the signature's next sibling: the definition runs to its end.
      const body = n.nextNamedSibling?.type === "function_body" ? n.nextNamedSibling : n.parent?.type === "method_signature" && n.parent.nextNamedSibling?.type === "function_body" ? n.parent.nextNamedSibling : null;
      const end = body ?? n;
      if (n.parent?.type === "method_signature" || (n.parent?.type === "declaration" && n.parent.parent?.type === "class_body")) {
        const cls = ancestor(n, new Set(["class_definition", "mixin_declaration", "extension_declaration"]));
        const cname = cls?.childForFieldName("name")?.text ?? cls?.namedChildren.find((c) => c.type === "identifier")?.text;
        if (cname) out.add({ name: `${cname}.${name}`, kind: "method", line: row(n), exported: exported && !cname.startsWith("_"), endLine: endRow(end) });
      } else if (n.parent?.type === "program") {
        out.add({ name, kind: "function", line: row(n), exported, endLine: endRow(end) });
        if (name === "main") out.add({ name: "main", kind: "entry", line: row(n) });
      }
    } else if (d.kind === "const" && n.parent?.parent?.type === "program") {
      put(out, { name, kind: "const", line: row(n), exported }, n);
    }
  }
}

function dartImports(_rt: Rt, matches: Match[]): RawImport[] {
  const out: RawImport[] = [];
  for (const m of matches) { const s = m.caps["source"]; if (s) out.push({ spec: s.text.replace(/^['"]|['"]$/g, "") }); }
  return out;
}

function dartRoutes(_rt: Rt, matches: Match[], out: Out): void {
  for (const m of matches) {
    const at = m.caps["route"];
    const p = m.caps["path"];
    if (!at || !p) continue;
    // Only GoRoute(path: ...): the named argument's call is the identifier just before its arguments.
    const call = at.parent?.parent?.parent?.parent?.parent;
    const head = call?.text ?? "";
    if (!/^(?:const\s+)?GoRoute\s*\(/.test(head)) continue;
    const path = p.text.replace(/^['"]|['"]$/g, "");
    out.add({ name: path, kind: "route", line: row(at), method: "GET", path });
  }
}

// ----------------------------------------------------------------- registry

export const ADAPTERS: Readonly<Partial<Record<GrammarId, Adapter>>> = {
  typescript: { defs: tsDefs, imports: tsImports, routes: tsRoutes },
  tsx: { defs: tsDefs, imports: tsImports, routes: tsRoutes },
  javascript: { defs: tsDefs, imports: tsImports, routes: tsRoutes },
  python: { defs: pyDefs, imports: pyImports, routes: pyRoutes },
  go: { defs: goDefs, imports: goImports, routes: goRoutes },
  rust: { defs: rustDefs, imports: rustImports, routes: rustRoutes },
  java: { defs: javaDefs, imports: javaImports, routes: javaRoutes },
  kotlin: { defs: ktDefs, imports: ktImports, routes: ktRoutes },
  ruby: { defs: rbDefs, imports: rbImports, routes: rbRoutes },
  php: { defs: phpDefs, imports: phpImports, routes: phpRoutes },
  swift: { defs: swiftDefs },
  c_sharp: { defs: csDefs, routes: csRoutes },
  dart: { defs: dartDefs, imports: dartImports, routes: dartRoutes },
  html: { defs() { /* HTML defines nothing; its text is read by extract.ts */ } },
};
