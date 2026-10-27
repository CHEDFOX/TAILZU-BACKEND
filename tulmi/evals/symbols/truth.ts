/**
 * GROUND TRUTH FOR TYPESCRIPT: WHAT THE TYPESCRIPT COMPILER ITSELF SAYS A FILE DECLARES.
 *
 * Read with the compiler API (ts.createSourceFile: the parser the compiler uses, no type checking) and following the same contract as gold.ts: the
 * file's top-level declarations (and those of its namespaces), the methods of its top-level classes as `Class.method`, nothing local to a function.
 * A declaration is exported when it carries `export` (or is named in an `export { }` clause, under its alias if it has one).
 */
import ts from "typescript";
import type { Def } from "./score.js";

const lineOf = (sf: ts.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

function unwrap(e: ts.Expression | undefined): ts.Expression | undefined {
  let cur = e;
  while (cur && (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur))) cur = cur.expression;
  return cur;
}

const isExported = (n: ts.Node): boolean => (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
const isDefaultMod = (n: ts.Node): boolean => (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Default) !== 0;

export function truthOf(path: string, text: string): Def[] {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const out: Def[] = [];
  const add = (name: string, k: string, exported: boolean, node: ts.Node, nameNode?: ts.Node): void => {
    out.push({
      name, kind: k, exported, line: lineOf(sf, node.getStart(sf)), nameLine: lineOf(sf, (nameNode ?? node).getStart(sf)), endLine: lineOf(sf, node.getEnd()),
    });
  };

  const members = (cls: ts.ClassDeclaration, name: string, exported: boolean): void => {
    for (const m of cls.members) {
      if (ts.isConstructorDeclaration(m)) continue;
      let nm: string | undefined;
      let ok = false;
      if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) ok = true;
      else if (ts.isPropertyDeclaration(m)) { const init = unwrap(m.initializer); ok = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)); }
      if (!ok || !m.name) continue;
      if (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) nm = m.name.text;
      if (!nm) continue;
      const flags = ts.getCombinedModifierFlags(m);
      const priv = (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0 || ts.isPrivateIdentifier(m.name);
      add(`${name}.${nm}`, "method", exported && !priv, m, m.name);
    }
  };

  const visit = (stmts: readonly ts.Statement[]): void => {
    const names = new Map<string, Def[]>();
    const record = (d: Def): void => { const l = names.get(d.name) ?? []; l.push(d); names.set(d.name, l); };
    const before = (): number => out.length;
    for (const s of stmts) {
      const from = before();
      if (ts.isFunctionDeclaration(s)) {
        add(s.name?.text ?? "default", "function", isExported(s), s, s.name);
      } else if (ts.isClassDeclaration(s)) {
        const name = s.name?.text ?? "default";
        add(name, "class", isExported(s), s, s.name);
        members(s, name, isExported(s));
      } else if (ts.isInterfaceDeclaration(s)) add(s.name.text, "interface", isExported(s), s, s.name);
      else if (ts.isTypeAliasDeclaration(s)) add(s.name.text, "type", isExported(s), s, s.name);
      else if (ts.isEnumDeclaration(s)) add(s.name.text, "enum", isExported(s), s, s.name);
      else if (ts.isModuleDeclaration(s)) {
        add(ts.isStringLiteral(s.name) ? s.name.text : s.name.getText(sf), "module", isExported(s), s, s.name);
        if (s.body && ts.isModuleBlock(s.body)) visit(s.body.statements);
      } else if (ts.isVariableStatement(s)) {
        const exported = isExported(s);
        const decls = s.declarationList.declarations;
        for (const d of decls) {
          if (!ts.isIdentifier(d.name)) continue;
          const init = unwrap(d.initializer);
          const k = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "function" : init && ts.isClassExpression(init) ? "class" : "const";
          add(d.name.text, k, exported, decls.length === 1 ? s : d, d.name);
        }
      } else if (ts.isExportAssignment(s) && !s.isExportEquals) {
        add("default", "const", true, s);
      } else if (ts.isExportDeclaration(s) && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const el of s.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          const as = el.name.text;
          const found = names.get(local);
          if (as === local) {
            if (found) for (const f of found) f.exported = true;
            else add(as, "function", true, s);
          } else add(as, found?.[0]?.kind ?? "function", true, s);
        }
      }
      for (let i = from; i < out.length; i += 1) record(out[i]!);
    }
  };
  visit(sf.statements);
  void isDefaultMod;
  return out;
}

/** Module specifiers a file imports or re-exports, the way the compiler reads them: import/export-from statements, require() and import() of a string. */
export function importsOf(path: string, text: string): string[] {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) out.push(n.moduleReference.expression.text);
    else if (ts.isCallExpression(n) && n.arguments.length >= 1 && ts.isStringLiteralLike(n.arguments[0]!)) {
      const callee = n.expression;
      if ((ts.isIdentifier(callee) && callee.text === "require") || callee.kind === ts.SyntaxKind.ImportKeyword) out.push((n.arguments[0] as ts.StringLiteralLike).text);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}
