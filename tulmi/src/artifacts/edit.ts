/**
 * THE EFFICIENCY ENGINE: CHANGE AN ARTIFACT BY SENDING A MODEL AS LITTLE OF IT AS THE CHANGE NEEDS.
 *
 * The usual way to change a generated page is to send the model the whole page and have it write the
 * whole page back: a one-word change costs the page twice over, in and out, at the strongest model.
 * Here a change is made by the smallest thing that can make it, and the numbers (docs/artifacts.md)
 * are measured against that baseline:
 *
 *   BY THE BOT'S OWN WORDS   artifact_update: exact replacements the bot wrote. No model call at all here;
 *                            stored as the patch itself (versions.ts)
 *   BY POINTING              editElement: the person taps an element, and the model is sent ONLY that
 *                            element's source (found from its data-tz-id by scan.ts), a few lines of context
 *                            around it, and the project's compact kit, on the CHEAP tier. It writes back the
 *                            element (or, for a big one, a few exact replacements inside it), which is
 *                            spliced in, checked, and stored as a patch of that one span
 *   BY SAYING                editWhole: an instruction with no element. The model gets the artifact once and
 *                            answers with exact replacements, not the artifact (a full rewrite only if most
 *                            of it must change). Cheap tier when the artifact and the instruction are small
 *   BY THE VIEWER'S ERROR    reportError: the viewer found a compile or runtime error. The model is sent the
 *                            error and the dozen lines around where it happened, never the artifact, on the
 *                            cheap tier, and answers with the replacement that fixes it. At most two attempts
 *                            for a version, never the same error twice, and a chain of fixes stops at three,
 *                            so a broken artifact cannot become a loop that spends money
 *
 * TIERS. Small edits and fixes start on the cheap tier. A model failure (every model of the tier down, or an
 * answer that does not make a valid artifact) climbs ONE tier, once (model.ts). Making an artifact from a
 * request is the code tier, the strong tier when the classifier says it is complex (service.ts, kit.ts).
 *
 * CACHE. Every prompt is laid out stable first: the system prompt (the same for every artifact), the
 * project's kit (the same for every artifact of a project), the artifact or the span of it, and the
 * instruction last. A provider that caches the start of a prompt hits it on the next edit.
 *
 * MONEY. Every change returns what it cost in paise and what the artifact has cost in all (types.ts Change).
 * What an attempt cost is added to the artifact even if the attempt failed.
 *
 * Nothing here reaches a store directly: it works through `Docs`, which service.ts implements.
 */
import { createHash } from "node:crypto";
import { forModel } from "../code/work/model.js";
import { CAP_PAISE, ArtifactError, type Artifact, type Change, type ChangeHow, type Edit, type MadeBy } from "./types.js";
import { ArtifactModel, type Ran } from "./model.js";
import { contextAround, elementAt, findElementSpan, linesWindow } from "./scan.js";
import { validateArtifact } from "./validate.js";
import { applyEdits, type PosEdit } from "./versions.js";

// ------------------------------------------------------------------ what the engine asks of the service

export interface Docs {
  /** The artifact and its head text, for a person who owns it (not_found for anyone else). */
  load(userId: string, id: string): Promise<{ artifact: Artifact; content: string }>;
  /** Checks and keeps `next` as the next version of `artifact`, with what it cost. Throws head_moved if the head moved since `artifact` was read. */
  commit(artifact: Artifact, next: string, o: { madeBy: MadeBy; note: string; hint?: readonly PosEdit[]; paise: number; how: Omit<ChangeHow, "warnings"> }): Promise<Change>;
  /** Money spent on an attempt that produced no version. */
  spend(artifactId: string, paise: number): Promise<void>;
  /** The project's compact kit text for the artifact, or "". */
  kitText(artifact: Artifact): Promise<string>;
}

// ------------------------------------------------------------------ numbers

/** An element this size or smaller is rewritten whole; a bigger one is changed by exact replacements inside it. */
export const ELEMENT_WHOLE_MAX = 1200;
/**
 * An element bigger than this is not edited by pointing: it is most of the artifact, and an instruction does the same for less. (It is also
 * about the most the cheap tier's cap covers in the worst case: the span in, and 1,800 tokens of replacements out.)
 */
export const ELEMENT_MAX = 24_000;
/** An artifact bigger than this, or an instruction longer, starts on the code tier instead of the cheap one (editWhole). */
export const SMALL_ARTIFACT_CHARS = 20_000;
export const SMALL_INSTRUCTION_CHARS = 240;
/** Fix attempts for one version, and fixes in a row (a fix of a fix of a fix). */
export const FIX_ATTEMPTS = 2;
export const FIX_CHAIN = 3;
/** Lines of the artifact a fix is shown, each side of the failing line. */
export const FIX_WINDOW = 6;
const INSTRUCTION_MAX = 2000;
const CHARS_PER_TOKEN = 3.5;

const tokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

// ------------------------------------------------------------------ the prompts
// Who the model is for each call (artifact_element, artifact_edit, artifact_fix) is principles/roles.ts, and the output it is held to is its
// contract; the kit, the artifact and the instruction are the dynamic part, laid out by ArtifactModel.messages (model.ts).

// ------------------------------------------------------------------ reading answers

/** An answer with a code fence round it, unwrapped. */
export function unfence(text: string): string {
  const t = text.trim();
  const m = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1]! : t).trim();
}

/** The <edit> pairs in an answer, in order. A newline just inside a tag is the model's layout, not text. */
export function parseEdits(text: string): Edit[] {
  const trim = (s: string) => s.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  const out: Edit[] = [];
  for (const m of text.matchAll(/<old>([\s\S]*?)<\/old>\s*<new>([\s\S]*?)<\/new>/g)) out.push({ old: trim(m[1]!), new: trim(m[2]!) });
  return out;
}

export function parseRewrite(text: string): string | null {
  const m = /<rewrite>([\s\S]*)<\/rewrite>/.exec(text);
  return m ? unfence(m[1]!.replace(/^\r?\n/, "")) : null;
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ the fix book

/** What is known of one version's errors: which were seen, how many fixes were tried, how deep the chain of fixes is. */
interface FixEntry { seen: Set<string>; attempts: number; chain: number; at: number }

export type FixOutcome =
  | { status: "fixed"; change: Change }
  | { status: "duplicate" }
  | { status: "limit"; reason: "attempts" | "chain" }
  | { status: "stale"; head: number }
  | { status: "not_fixable"; reason: string }
  | { status: "failed"; reason: string; paise: number };

/** The viewer's `error` message, as the parent forwards it. */
export interface ViewerError {
  kind: "compile" | "runtime" | "import" | "limit";
  message: string;
  line?: number;
  col?: number;
  stack?: string;
}

export class FixBook {
  private entries = new Map<string, FixEntry>();
  constructor(private readonly now: () => number = Date.now) {}

  private entry(id: string, version: number): FixEntry {
    const k = `${id}:${version}`;
    let e = this.entries.get(k);
    if (!e) {
      e = { seen: new Set(), attempts: 0, chain: 0, at: this.now() };
      this.entries.set(k, e);
      if (this.entries.size > 5000) this.sweep();
    }
    return e;
  }

  private sweep(): void {
    const old = this.now() - 6 * 60 * 60_000;
    for (const [k, e] of this.entries) if (e.at < old) this.entries.delete(k);
  }

  /** The error's identity within a version: its kind and its message, whitespace aside. */
  static keyOf(err: ViewerError): string {
    return createHash("sha1").update(`${err.kind}|${oneLine(String(err.message)).slice(0, 300)}`).digest("hex").slice(0, 16);
  }

  /** Takes the error in: "duplicate" if this version has had it, "limit" if its fixes or its chain are used up, else "go" (and it is counted). */
  admit(id: string, version: number, err: ViewerError): "go" | "duplicate" | { limit: "attempts" | "chain" } {
    const e = this.entry(id, version);
    const key = FixBook.keyOf(err);
    if (e.seen.has(key)) return "duplicate";
    e.seen.add(key);
    if (e.chain >= FIX_CHAIN) return { limit: "chain" };
    if (e.attempts >= FIX_ATTEMPTS) return { limit: "attempts" };
    e.attempts += 1;
    return "go";
  }

  /** A fix of `version` made `next`: its chain is one deeper. */
  chained(id: string, version: number, next: number): void {
    this.entry(id, next).chain = this.entry(id, version).chain + 1;
  }

  attempts(id: string, version: number): number { return this.entries.get(`${id}:${version}`)?.attempts ?? 0; }
  chain(id: string, version: number): number { return this.entries.get(`${id}:${version}`)?.chain ?? 0; }
}

// ------------------------------------------------------------------ the engine

export interface EngineDeps {
  docs: Docs;
  model: ArtifactModel;
  fixes?: FixBook;
}

export class EditEngine {
  readonly fixes: FixBook;
  constructor(private readonly d: EngineDeps) {
    this.fixes = d.fixes ?? new FixBook();
  }

  /** Spends are kept even when the attempt failed. */
  private async paid<T>(artifact: Artifact, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const p = (err as ArtifactError | null)?.detail?.paise;
      if (typeof p === "number" && p > 0) await this.d.docs.spend(artifact.id, p).catch(() => undefined);
      throw err;
    }
  }

  /** Docs.commit, and if the change is refused (the head moved, the text failed its check) what the attempt cost is still the artifact's. */
  private async commit(artifact: Artifact, next: string, o: Parameters<Docs["commit"]>[2]): Promise<Change> {
    try {
      return await this.d.docs.commit(artifact, next, o);
    } catch (err) {
      if (o.paise > 0) await this.d.docs.spend(artifact.id, o.paise).catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------- by pointing

  /**
   * The person pointed at an element and said what to change. The model is sent that element's source, a few lines around it and the
   * kit; the answer replaces just that span.
   */
  async editElement(userId: string, id: string, elementId: string, instruction: string, o: { signal?: AbortSignal } = {}): Promise<Change> {
    const said = instructionOf(instruction);
    const { artifact, content } = await this.d.docs.load(userId, id);
    const found = findElementSpan(content, artifact.type, elementId);
    if (!found.ok) throw new ArtifactError("no_element", `${found.reason} Describe the change without pointing, or point again.`);
    const { span } = found;
    if (span.end - span.start > ELEMENT_MAX) {
      throw new ArtifactError("no_element", "That element is most of the artifact. Describe the change without pointing at it, or point at something inside it.");
    }
    const source = content.slice(span.start, span.end);
    const whole = source.length <= ELEMENT_WHOLE_MAX;
    const ctx = contextAround(content, span);
    const kit = await this.d.docs.kitText(artifact);

    const artifactBlock = [
      `<artifact type="${artifact.type}" title="${cut(artifact.title, 60).replace(/["<>\n]/g, " ")}" element="${span.line}:${span.col}" tag="${span.tag || "fragment"}">`,
      ctx.before ? `<context_before>\n${ctx.before}\n</context_before>` : "",
      `<element>\n${source}\n</element>`,
      ctx.after ? `<context_after>\n${ctx.after}\n</context_after>` : "",
      "</artifact>",
    ].filter(Boolean).join("\n");
    const instructionText = whole
      ? `Answer in the WHOLE ELEMENT form.\nChange: ${said}`
      : `This element is long: answer in the REPLACEMENTS form (each old copied from the element, occurring once in it).\nChange: ${said}`;

    const ran = await this.paid(artifact, () => this.d.model.run<{ next: string; hint: PosEdit[] }>({
      userId, tier: "cheap", purpose: "artifact.element", role: "artifact_element", kit, artifact: artifactBlock, instruction: instructionText,
      maxTokens: whole ? clamp(tokens(source.length) * 2 + 200, 300, 2500) : 1800,
      // Sized from the element: the whole element again is its tokens and a margin; the call is given as much of that as its cap pays for.
      wantTokens: whole ? clamp(tokens(source.length) * 2 + 600, 900, 2500) : tokens(source.length) + 1200,
      capPaise: CAP_PAISE.cheap, ...(o.signal ? { signal: o.signal } : {}),
      accept: (text) => {
        let repl: string;
        // In the replacements form the patch is the replacements, at their places in the artifact; in the whole-element form it is the span.
        let inner: PosEdit[] | null = null;
        if (/<old>/.test(text)) {
          try {
            const applied = applyEdits(source, parseEdits(text));
            repl = applied.content;
            inner = applied.pos.map(([a, b, c]) => [span.start + a, b, c] as PosEdit);
          } catch (err) { return { ok: false, reason: (err as Error).message }; }
        } else {
          repl = unfence(text);
        }
        // Trimmed, the answer is the same text only if it was already tight: then the replacements are the patch.
        const tight = inner !== null && repl === repl.trim();
        repl = repl.trim();
        if (repl === source) return { ok: false, reason: "the answer is the element unchanged" };
        if (!repl.startsWith("<")) return { ok: false, reason: "the answer is not an element (it must start with `<`)" };
        const next = content.slice(0, span.start) + repl + content.slice(span.end);
        // The answer must be exactly one element, in the place of the old one.
        const back = elementAt(next, artifact.type, span.start);
        if (!back.ok) return { ok: false, reason: back.reason };
        if (back.span.end !== span.start + repl.length) return { ok: false, reason: "the answer is more than one element, or one that does not end where its last tag does" };
        const checked = validateArtifact({ type: artifact.type, content: next });
        if (!checked.ok) return { ok: false, reason: checked.errors.join(" ") };
        return { ok: true, value: { next, hint: tight && inner ? inner : [[span.start, span.end - span.start, repl]] } };
      },
    }));

    return this.commit(artifact, ran.value.next, {
      madeBy: "person", note: `Changed <${span.tag || "fragment"}> at ${span.line}:${span.col}: ${cut(oneLine(said), 100)}`, hint: ran.value.hint, paise: ran.paise,
      how: howOf("element", ran, content.length),
    });
  }

  // ---------------------------------------------------------------- by saying

  /** An instruction with no element: the model answers with exact replacements against the artifact (or a rewrite when most of it changes). */
  async editWhole(userId: string, id: string, instruction: string, o: { signal?: AbortSignal } = {}): Promise<Change> {
    const said = instructionOf(instruction);
    const { artifact, content } = await this.d.docs.load(userId, id);
    const kit = await this.d.docs.kitText(artifact);
    const small = content.length <= SMALL_ARTIFACT_CHARS && said.length <= SMALL_INSTRUCTION_CHARS;
    const block = `<artifact type="${artifact.type}" title="${cut(artifact.title, 60).replace(/["<>\n]/g, " ")}">\n${content}\n</artifact>`;

    const ran = await this.paid(artifact, () => this.d.model.run<{ next: string; hint?: PosEdit[]; rewrite: boolean }>({
      userId, tier: small ? "cheap" : "code", purpose: "artifact.edit", role: "artifact_edit", kit, artifact: block, instruction: `Change: ${said}`,
      maxTokens: small ? 2000 : 5000,
      // A rewrite (when most of it changes) is the whole artifact again: its tokens, and the framing and the model's own words around it.
      wantTokens: tokens(content.length) + 1200,
      capPaise: small ? CAP_PAISE.cheap : CAP_PAISE.code, ...(o.signal ? { signal: o.signal } : {}),
      accept: (text) => {
        const rewrite = parseRewrite(text);
        let next: string;
        let hint: PosEdit[] | undefined;
        if (rewrite !== null) next = rewrite;
        else {
          try { ({ content: next, pos: hint } = applyEdits(content, parseEdits(text))); } catch (err) { return { ok: false, reason: (err as Error).message }; }
        }
        if (next === content) return { ok: false, reason: "the answer changes nothing" };
        const checked = validateArtifact({ type: artifact.type, content: next });
        if (!checked.ok) return { ok: false, reason: checked.errors.join(" ") };
        return { ok: true, value: { next, ...(hint ? { hint } : {}), rewrite: rewrite !== null } };
      },
    }));

    return this.commit(artifact, ran.value.next, {
      madeBy: "person", note: cut(oneLine(said), 120), ...(ran.value.hint ? { hint: ran.value.hint } : {}), paise: ran.paise,
      how: howOf(ran.value.rewrite ? "rewrite" : "whole", ran, content.length),
    });
  }

  // ---------------------------------------------------------------- by the viewer's error

  /**
   * The viewer reported an error in `version`. Deduped by message and version, at most FIX_ATTEMPTS attempts for a version, and the model is
   * sent the error and the lines around it, never the artifact. The fix is a patch on the head. Never throws for the reasons it answers with.
   */
  async reportError(userId: string, id: string, version: number, err: ViewerError, o: { signal?: AbortSignal } = {}): Promise<FixOutcome> {
    const { artifact, content } = await this.d.docs.load(userId, id);
    if (!Number.isInteger(version) || version < 1 || version > artifact.headVersion) throw new ArtifactError("bad_request", "version is the version the viewer was showing.");
    if (version !== artifact.headVersion) return { status: "stale", head: artifact.headVersion };
    if (err.kind === "limit") return { status: "not_fixable", reason: "The artifact is over a limit; the bot has to make it smaller." };
    if (artifact.type === "markdown") return { status: "not_fixable", reason: "Markdown has nothing to fix." };

    const where = placeOfError(err, content);
    if (!where) return { status: "not_fixable", reason: "The error did not say where it happened, so there is nothing small to fix. Ask the bot to change the artifact instead." };

    const admitted = this.fixes.admit(id, version, err);
    if (admitted === "duplicate") return { status: "duplicate" };
    if (admitted !== "go") return { status: "limit", reason: admitted.limit };

    const kit = await this.d.docs.kitText(artifact);
    const window = linesWindow(content, where.line - FIX_WINDOW, where.line + FIX_WINDOW);
    const artifactBlock = [
      `<artifact type="${artifact.type}" title="${cut(artifact.title, 60).replace(/["<>\n]/g, " ")}">`,
      `<error kind="${err.kind}" line="${where.line}" col="${where.col}">\n${cut(oneLine(String(err.message)), 400)}\n</error>`,
      `<lines>\n${window}\n</lines>`,
      "</artifact>",
    ].join("\n");

    try {
      const ran = await this.paid(artifact, () => this.d.model.run<{ next: string; hint: PosEdit[] }>({
        userId, tier: "cheap", purpose: "artifact.fix", role: "artifact_fix", kit, artifact: artifactBlock, instruction: "Fix this error.",
        maxTokens: 700, capPaise: CAP_PAISE.cheap, ...(o.signal ? { signal: o.signal } : {}),
        accept: (text) => {
          const cannot = /<cannot>([\s\S]*?)<\/cannot>/.exec(text);
          const edits = parseEdits(text);
          if (!edits.length) return { ok: false, reason: cannot ? `it said it cannot fix it (${oneLine(cannot[1]!).slice(0, 100)})` : "the answer has no <edit>" };
          let applied;
          try { applied = applyEdits(content, edits); } catch (e) { return { ok: false, reason: (e as Error).message }; }
          const checked = validateArtifact({ type: artifact.type, content: applied.content });
          if (!checked.ok) return { ok: false, reason: checked.errors.join(" ") };
          return { ok: true, value: { next: applied.content, hint: applied.pos } };
        },
      }));
      const change = await this.commit(artifact, ran.value.next, {
        madeBy: "bot", note: `Auto-fix: ${cut(oneLine(String(err.message)), 100)}`, hint: ran.value.hint, paise: ran.paise, how: howOf("fix", ran, content.length),
      });
      this.fixes.chained(id, version, change.version);
      return { status: "fixed", change };
    } catch (e) {
      if (e instanceof ArtifactError && (e.code === "edit_failed" || e.code === "model_down" || e.code === "limit_reached")) {
        return { status: "failed", reason: e.message, paise: typeof e.detail?.paise === "number" ? e.detail.paise : 0 };
      }
      throw e;
    }
  }
}

// ------------------------------------------------------------------ small things

function instructionOf(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ArtifactError("bad_request", "Say what to change.");
  if (raw.length > INSTRUCTION_MAX) throw new ArtifactError("too_large", `The instruction is over ${INSTRUCTION_MAX} characters.`);
  return forModel(raw.trim());
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function howOf(mode: ChangeHow["mode"], ran: Ran<unknown>, artifactChars: number): Omit<ChangeHow, "warnings"> {
  return { mode, tier: ran.tier, model: ran.model, promptTokens: ran.promptTokens, completionTokens: ran.completionTokens, sentChars: ran.sentChars, artifactChars };
}

/** Where an error happened: its own line and column, else the first `:line:col` of its stack; null if neither. */
export function placeOfError(err: ViewerError, content: string): { line: number; col: number } | null {
  const lines = content.split("\n").length;
  const ok = (line: unknown, col: unknown) => (Number.isInteger(line) && (line as number) >= 1 && (line as number) <= lines ? { line: line as number, col: Number.isInteger(col) && (col as number) >= 1 ? (col as number) : 1 } : null);
  const own = ok(err.line, err.col);
  if (own) return own;
  const m = typeof err.stack === "string" ? /:(\d{1,7}):(\d{1,5})\)?(?:\s|$)/.exec(err.stack) : null;
  return m ? ok(Number(m[1]), Number(m[2])) : null;
}

/**
 * What a model is sent to rewrite a whole artifact for the same instruction: the usual way, as the numbers in the docs and the tests
 * compare against. System, the whole artifact, the instruction.
 */
export function fullRewriteMessages(artifact: { type: string; title: string; content: string }, instruction: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: `You change an interactive ${artifact.type} artifact as asked. Answer with the complete new artifact and nothing else.` },
    { role: "user", content: `<artifact type="${artifact.type}" title="${artifact.title}">\n${artifact.content}\n</artifact>\n\nChange: ${instruction}` },
  ];
}

