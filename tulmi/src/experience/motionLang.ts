/**
 * THE MOTION LANGUAGE — the small evaluator the mic key's program is written
 * in, as the keyboards run it (SDUIRenderer.swift / .kt carry the same one).
 * The backend keeps a copy so a program can be checked before it is sent:
 * every expression must parse, every function must exist, and a sample
 * frame must evaluate to finite numbers. Numbers only. An expression is
 * arithmetic, comparisons, && || !, ?:, built-in functions, the program's
 * own functions, and names looked up in the context. Anything unknown or
 * non-finite is 0: a bad program is a still mark, never a crash.
 */
export type Ast =
  | { k: "n"; v: number } | { k: "v"; name: string } | { k: "call"; name: string; args: Ast[] }
  | { k: "neg"; x: Ast } | { k: "not"; x: Ast } | { k: "?"; c: Ast; a: Ast; b: Ast } | { k: "bin"; op: string; l: Ast; r: Ast };
const bin = (op: string, l: Ast, r: Ast): Ast => ({ k: "bin", op, l, r });

type Tok = { t: "n"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };
const TOK = /(\d+\.?\d*(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|(\|\||&&|==|!=|<=|>=|[-+*/%^<>!?:(),])/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i]!)) { i++; continue; }
    TOK.lastIndex = i;
    const m = TOK.exec(src);
    if (!m || m.index !== i) throw new Error(`bad character at ${i}: ${src.slice(i, i + 12)}`);
    i = TOK.lastIndex;
    out.push(m[1] != null ? { t: "n", v: parseFloat(m[1]) } : m[2] != null ? { t: "id", v: m[2] } : { t: "op", v: m[3]! });
  }
  return out;
}

export function parse(src: string): Ast {
  const toks = tokenize(String(src));
  let pos = 0;
  const isOp = (v: string) => { const k = toks[pos]; return !!k && k.t === "op" && k.v === v; };
  const take = (v: string) => { if (!isOp(v)) throw new Error(`expected ${v} in ${src}`); pos++; };
  const ternary = (): Ast => { const c = or(); if (isOp("?")) { pos++; const a = ternary(); take(":"); const b = ternary(); return { k: "?", c, a, b }; } return c; };
  const or = (): Ast => { let l = and(); while (isOp("||")) { pos++; l = bin("||", l, and()); } return l; };
  const and = (): Ast => { let l = eq(); while (isOp("&&")) { pos++; l = bin("&&", l, eq()); } return l; };
  const eq = (): Ast => { let l = rel(); while (isOp("==") || isOp("!=")) { const o = (toks[pos++] as Tok).v as string; l = bin(o, l, rel()); } return l; };
  const rel = (): Ast => { let l = add(); while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) { const o = (toks[pos++] as Tok).v as string; l = bin(o, l, add()); } return l; };
  const add = (): Ast => { let l = mul(); while (isOp("+") || isOp("-")) { const o = (toks[pos++] as Tok).v as string; l = bin(o, l, mul()); } return l; };
  const mul = (): Ast => { let l = unary(); while (isOp("*") || isOp("/") || isOp("%")) { const o = (toks[pos++] as Tok).v as string; l = bin(o, l, unary()); } return l; };
  const unary = (): Ast => { if (isOp("-")) { pos++; return { k: "neg", x: unary() }; } if (isOp("!")) { pos++; return { k: "not", x: unary() }; } return power(); };
  const power = (): Ast => { const b = primary(); if (isOp("^")) { pos++; return bin("^", b, unary()); } return b; };
  const primary = (): Ast => {
    const k = toks[pos];
    if (!k) throw new Error(`unexpected end of ${src}`);
    if (k.t === "n") { pos++; return { k: "n", v: k.v }; }
    if (k.t === "id") {
      pos++;
      if (isOp("(")) { pos++; const args: Ast[] = []; if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { pos++; args.push(ternary()); } } take(")"); return { k: "call", name: k.v, args }; }
      return { k: "v", name: k.v };
    }
    if (isOp("(")) { pos++; const e = ternary(); take(")"); return e; }
    throw new Error(`unexpected ${k.v} in ${src}`);
  };
  const ast = ternary();
  if (pos < toks.length) throw new Error(`trailing ${toks[pos]!.v} in ${src}`);
  return ast;
}

const fin = (x: number) => (Number.isFinite(x) ? x : 0);
export const builtins: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: (x) => (x < 0 ? 0 : Math.sqrt(x)), floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp,
  log: (x) => (x > 0 ? Math.log(x) : 0), atan2: Math.atan2, min: Math.min, max: Math.max, pow: (a, b) => (a < 0 && b !== Math.floor(b) ? 0 : Math.pow(a, b)), hypot: Math.hypot,
  clamp: (x, a, b) => (x < a ? a : x > b ? b : x),
  smooth: (a, b, x) => { const u = b === a ? (x >= b ? 1 : 0) : Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); },
  lerp: (a, b, u) => a + (b - a) * u,
  crest: (x) => { const s = Math.sin(x); return s > 0 ? Math.pow(s, 1.6) : 0; },
  ramp: (x, at, len, edge) => { const e = edge || 0.06; return x < at ? 0 : x < at + e ? (x - at) / e : x < at + len ? 1 : x < at + len + e ? 1 - (x - at - len) / e : 0; },
  run: (f, x, at, dur, width) => { const u = (x - at) / dur; if (u < 0 || u > 1) return 0; const half = width / 2, c = u * (1 + width) - half, q = Math.abs(f - c) / half; return q >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * q); },
  noise: (x) => Math.sin(x * 1.7) * Math.sin(x * 0.61 + 2.1),
};

export type Funcs = Record<string, { args: string[]; ast: Ast }>;
export type Ctx = Record<string, number | ((...a: number[]) => number)>;

export function evaluate(n: Ast, ctx: Ctx, funcs: Funcs, depth = 0): number {
  switch (n.k) {
    case "n": return n.v;
    case "v": { const v = ctx[n.name]; return typeof v === "number" && Number.isFinite(v) ? v : 0; }
    case "neg": return -evaluate(n.x, ctx, funcs, depth);
    case "not": return evaluate(n.x, ctx, funcs, depth) ? 0 : 1;
    case "?": return evaluate(n.c, ctx, funcs, depth) ? evaluate(n.a, ctx, funcs, depth) : evaluate(n.b, ctx, funcs, depth);
    case "call": {
      const { name, args } = n;
      const f = funcs[name];
      if (f) {
        if (depth > 8) return 0;
        const c2: Ctx = Object.create(ctx);
        f.args.forEach((a, i) => { c2[a] = i < args.length ? evaluate(args[i]!, ctx, funcs, depth) : 0; });
        return fin(evaluate(f.ast, c2, funcs, depth + 1));
      }
      const b = builtins[name];
      if (b) return fin(b(...args.map((a) => evaluate(a, ctx, funcs, depth))));
      const lent = ctx[`fn:${name}`];
      if (typeof lent === "function") return fin(lent(...args.map((a) => evaluate(a, ctx, funcs, depth))));
      return 0;
    }
  }
  if (n.op === "||") return evaluate(n.l, ctx, funcs, depth) || evaluate(n.r, ctx, funcs, depth) ? 1 : 0;
  if (n.op === "&&") return evaluate(n.l, ctx, funcs, depth) && evaluate(n.r, ctx, funcs, depth) ? 1 : 0;
  const a = evaluate(n.l, ctx, funcs, depth), b = evaluate(n.r, ctx, funcs, depth);
  switch (n.op) {
    case "+": return a + b; case "-": return a - b; case "*": return a * b;
    case "/": return b === 0 ? 0 : a / b; case "%": return b === 0 ? 0 : a - Math.floor(a / b) * b;
    case "^": return fin(Math.pow(a, b));
    case "<": return a < b ? 1 : 0; case "<=": return a <= b ? 1 : 0; case ">": return a > b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
    case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
  }
  return 0;
}

/** Every expression in a program, parsed; the places that failed, named. */
export function compile(spec: any): { funcs: Funcs; exprs: Array<{ where: string; ast: Ast }>; errors: string[] } {
  const errors: string[] = [], exprs: Array<{ where: string; ast: Ast }> = [], funcs: Funcs = {};
  const X = (src: unknown, where: string): Ast => {
    try { const ast = parse(String(src)); exprs.push({ where, ast }); return ast; }
    catch (e) { errors.push(`${where}: ${(e as Error).message}`); return { k: "n", v: 0 }; }
  };
  for (const [k, f] of Object.entries<any>(spec.funcs ?? {})) funcs[k] = { args: f.args ?? [], ast: X(f.expr, `funcs.${k}`) };
  for (const [k, s] of Object.entries<any>(spec.springs ?? {})) { X(s.target ?? "0", `springs.${k}.target`); X(s.rate ?? "8", `springs.${k}.rate`); X(s.damp ?? "1", `springs.${k}.damp`); }
  for (const [k, v] of Object.entries<any>(spec.mark ?? {})) X(v, `mark.${k}`);
  for (const [id, sh] of Object.entries<any>(spec.shapes ?? {})) for (const [k, v] of Object.entries<any>(sh)) if (k !== "vars") X(v, `shapes.${id}.${k}`);
  (spec.emit ?? []).forEach((e: any, n: number) => {
    (e.repeat ?? []).forEach((r: unknown, j: number) => X(r, `emit[${n}].repeat[${j}]`));
    X(e.opacity ?? "1", `emit[${n}].opacity`); X(e.width ?? "1", `emit[${n}].width`);
    if (Array.isArray(e.points)) e.points.forEach((p: unknown[], j: number) => { X(p[0], `emit[${n}].points[${j}].x`); X(p[1], `emit[${n}].points[${j}].y`); });
    else if (e.points) { X(e.points.count ?? "0", `emit[${n}].points.count`); X(e.points.x ?? "0", `emit[${n}].points.x`); X(e.points.y ?? "0", `emit[${n}].points.y`); }
    for (const k of ["x1", "y1", "x2", "y2", "cx", "cy", "r"]) if (e[k] != null) X(e[k], `emit[${n}].${k}`);
  });
  return { funcs, exprs, errors };
}
