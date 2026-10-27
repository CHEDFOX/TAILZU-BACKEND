/**
 * THE ARTIFACT SERVICE: WHAT A BOT, A PERSON AND A SHARE LINK MAY DO WITH AN ARTIFACT, IN ONE PLACE.
 *
 * The routes (routes/artifacts.ts) and the bot tools (tools.ts) are thin doors over this, so the rules are
 * written once:
 *
 *   WHO       an artifact is its owner's. Anyone else, and an id that is not one, get the same plain not_found.
 *             A SHARE LINK (a secret token, shared/revoked by the owner) lets anyone read the head, and read the
 *             artifact's shared data; saving is the owner's switch (`othersCanSave`). A link's reader who is
 *             signed in also has data of their own (scope "me") and may ask the bot, metered to THEM
 *   WHAT      create, update (exact edits), rewrite, revert, delete; the person's edits by pointing, by saying and
 *             by the viewer's errors (edit.ts); making one from a request (generate); saved data; ask
 *   CHECKED   every text that becomes a version is validated first (validate.ts): size, secrets, imports,
 *             self-contained. A refusal says what to change
 *   VERSIONS  snapshot/patch (versions.ts). A change moves the head only if the head is where the change was
 *             made from (head_moved otherwise), so two edits at once never silently overwrite each other
 *   MONEY     every change returns what it cost, and what the artifact has cost in all. A person's model use is
 *             capped per call and per day (limits.ts); an `ask` is the asker's, not the owner's
 *   LIMITS    saved data is bounded by the protocol's LIMITS, and every door that a stranger's artifact can
 *             reach (data, ask, edit, errors) has a rate limit per person, or per link when there is no person
 *
 * Every dependency is injectable (the store, the model door, the clock, the log).
 */
import { classifyRequest } from "../code/brain/classify.js";
import { callModel, type GatewayDeps } from "../code/brain/gateway.js";
import type { CallFn } from "../code/work/model.js";
import { forModel } from "../code/work/model.js";
import { EditEngine, FixBook, unfence, type Docs, type FixOutcome, type ViewerError } from "./edit.js";
import { Limiter, SpendMeter } from "./limits.js";
import { ArtifactModel } from "./model.js";
import { LIMITS, type ArtifactType, type DesignKitCss } from "./protocol.js";
import { newShareToken, type ArtifactStore } from "./store.js";
import {
  ARTIFACTS_PER_PERSON, ARTIFACT_TYPES, CAP_PAISE, CONTENT_CACHE, KEY_MAX, TITLE_MAX, ArtifactError,
  type Artifact, type Change, type ChangeHow, type DataEntry, type MadeBy, type Scope, type VersionInfo,
} from "./types.js";
import { assertValid, validateArtifact } from "./validate.js";
import { applyEdits, contentAt, newVersion, type PosEdit } from "./versions.js";

export interface ArtifactLog {
  info(o: object, msg: string): void;
  warn(o: object, msg: string): void;
}

export interface ServiceOptions {
  store: ArtifactStore;
  /** callModel, or a stand-in. */
  call?: CallFn;
  gateway?: GatewayDeps;
  now?: () => number;
  log?: ArtifactLog;
  /** What a person's edits, fixes and makings may cost in a day, and what their `ask`s may, in paise. */
  dailyPaise?: number;
  askDailyPaise?: number;
  /** Rate limits (hits per minute) per person or link. */
  rates?: Partial<Record<"data" | "ask" | "edit" | "errors", number>>;
}

/** What opening an artifact gives: its head or the version asked for, and the project's look when it has one. */
export interface ArtifactView {
  artifact: Artifact;
  version: number;
  content: string;
  kit?: DesignKitCss;
}

/** What a share link shows: no owner, no project, no cost. */
export interface SharedView {
  id: string;
  type: ArtifactType;
  title: string;
  version: number;
  content: string;
  othersCanSave: boolean;
  kit?: DesignKitCss;
}

/** Who is at the door of an artifact's saved data or its `ask`. */
export type Access =
  | { role: "owner"; userId: string; artifact: Artifact }
  | { role: "viewer"; userId: string | null; artifact: Artifact };

export type DataScope = "shared" | "me";

export const DEFAULT_RATES = { data: 120, ask: 10, edit: 20, errors: 30 } as const;

const TITLES: Record<ArtifactType, string> = { html: "Untitled page", react: "Untitled component", svg: "Untitled graphic", mermaid: "Untitled diagram", markdown: "Untitled note" };
const KEY = /^[A-Za-z0-9_][\w .:/@#-]{0,127}$/;

export class ArtifactService implements Docs {
  readonly store: ArtifactStore;
  readonly model: ArtifactModel;
  readonly engine: EditEngine;
  readonly meter: SpendMeter;
  readonly askMeter: SpendMeter;
  private readonly call: CallFn | undefined;
  private readonly gateway: GatewayDeps | undefined;
  private readonly now: () => number;
  private readonly log: ArtifactLog | undefined;
  private readonly limiters: Record<"data" | "ask" | "edit" | "errors", Limiter>;
  private readonly cache = new Map<string, string>();

  constructor(o: ServiceOptions) {
    this.store = o.store;
    this.call = o.call;
    this.gateway = o.gateway;
    this.now = o.now ?? Date.now;
    this.log = o.log;
    this.meter = new SpendMeter(o.dailyPaise ?? 2000, { now: this.now });
    this.askMeter = new SpendMeter(o.askDailyPaise ?? 500, { now: this.now });
    this.model = new ArtifactModel({ ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), meter: this.meter });
    this.engine = new EditEngine({ docs: this, model: this.model, fixes: new FixBook(this.now) });
    const r = { ...DEFAULT_RATES, ...o.rates };
    this.limiters = {
      data: new Limiter(r.data, 60_000, { now: this.now }), ask: new Limiter(r.ask, 60_000, { now: this.now }),
      edit: new Limiter(r.edit, 60_000, { now: this.now }), errors: new Limiter(r.errors, 60_000, { now: this.now }),
    };
  }

  // ------------------------------------------------------------------ limits

  /** Counts a hit against a door for a person (or a link); throws rate_limited when it is over. */
  rate(door: "data" | "ask" | "edit" | "errors", key: string): void {
    const l = this.limiters[door];
    if (!l.allow(`${door}:${key}`)) {
      throw new ArtifactError("rate_limited", "That is too fast. Wait a moment and try again.", { retryAfterSec: l.retryAfterSec(`${door}:${key}`) });
    }
  }

  // ------------------------------------------------------------------ reading

  private remember(key: string, text: string): void {
    this.cache.delete(key);
    this.cache.set(key, text);
    if (this.cache.size > CONTENT_CACHE) this.cache.delete(this.cache.keys().next().value!);
  }

  /** A version's whole text: from memory when it is a head being worked on, else rebuilt from the nearest snapshot. */
  async contentOf(id: string, version: number): Promise<string> {
    const k = `${id}@${version}`;
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    let text: string;
    try {
      text = await contentAt(this.store, id, version);
    } catch (err) {
      this.log?.warn({ error: (err as Error).message.slice(0, 80) }, "artifact: a version could not be rebuilt");
      throw new ArtifactError("not_found", "That version could not be found.");
    }
    this.remember(k, text);
    return text;
  }

  /** The artifact, if it is this person's. Anyone else's, and anything that is not an id, is the same not_found. */
  async own(userId: string, id: string): Promise<Artifact> {
    const a = typeof id === "string" ? await this.store.get(id) : null;
    if (!a || a.userId !== userId) throw new ArtifactError("not_found", "I couldn't find that artifact.");
    return a;
  }

  async load(userId: string, id: string): Promise<{ artifact: Artifact; content: string }> {
    const artifact = await this.own(userId, id);
    return { artifact, content: await this.contentOf(artifact.id, artifact.headVersion) };
  }

  async kitText(artifact: Artifact): Promise<string> {
    if (!artifact.projectId) return "";
    try {
      const k = await this.store.getKit(artifact.projectId);
      const p = (k?.kit as { prompt?: unknown } | undefined)?.prompt;
      return typeof p === "string" ? p : "";
    } catch { return ""; }
  }

  private async kitCss(artifact: Artifact): Promise<DesignKitCss | undefined> {
    if (!artifact.projectId) return undefined;
    try {
      const css = ((await this.store.getKit(artifact.projectId))?.kit as { css?: DesignKitCss } | undefined)?.css;
      return css && typeof css.css === "string" ? css : undefined;
    } catch { return undefined; }
  }

  async get(userId: string, id: string, version?: number): Promise<ArtifactView> {
    const artifact = await this.own(userId, id);
    const v = version === undefined ? artifact.headVersion : version;
    if (!Number.isInteger(v) || v < 1 || v > artifact.headVersion) throw new ArtifactError("not_found", "That version doesn't exist.");
    const kit = await this.kitCss(artifact);
    return { artifact, version: v, content: await this.contentOf(artifact.id, v), ...(kit ? { kit } : {}) };
  }

  async list(userId: string, o: { projectId?: string } = {}): Promise<Artifact[]> {
    return this.store.list(userId, o);
  }

  async versions(userId: string, id: string): Promise<VersionInfo[]> {
    const a = await this.own(userId, id);
    return this.store.listVersions(a.id);
  }

  // ------------------------------------------------------------------ writing

  /** Checks and keeps `next` as the next version. This is Docs.commit, and everything that changes an artifact ends here. */
  async commit(artifact: Artifact, next: string, o: { madeBy: MadeBy; note: string; hint?: readonly PosEdit[]; paise: number; how: Omit<ChangeHow, "warnings"> }): Promise<Change> {
    const warnings = assertValid({ type: artifact.type, content: next });
    const prev = await this.contentOf(artifact.id, artifact.headVersion);
    if (prev === next) throw new ArtifactError("edit_failed", "That would change nothing. Nothing was changed.");
    const version = artifact.headVersion + 1;
    const v = newVersion(version, prev, next, { madeBy: o.madeBy, note: o.note, ...(o.hint ? { hint: o.hint } : {}) });
    const saved = await this.store.addVersion(artifact.id, artifact.headVersion, v, { paise: o.paise });
    if (!saved) throw new ArtifactError("head_moved", "The artifact changed while this was being made. Look at it again, then ask again. Nothing was changed.");
    this.remember(`${artifact.id}@${version}`, next);
    this.log?.info({ mode: o.how.mode, tier: o.how.tier, paise: o.paise, sentChars: o.how.sentChars, artifactChars: next.length, kind: v.kind }, "artifact changed");
    return { artifact: saved, version, paise: o.paise, totalPaise: saved.spentPaise, how: { ...o.how, warnings } };
  }

  async spend(artifactId: string, paise: number): Promise<void> {
    await this.store.addSpend(artifactId, paise);
  }

  private title(raw: unknown, type: ArtifactType): string {
    const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    return t ? t.slice(0, TITLE_MAX) : TITLES[type];
  }

  async create(userId: string, o: { type: unknown; title?: unknown; content: unknown; projectId?: unknown; madeBy?: MadeBy; note?: string }): Promise<Change> {
    const type = o.type as ArtifactType;
    if (!ARTIFACT_TYPES.includes(type)) throw new ArtifactError("bad_request", `type is one of ${ARTIFACT_TYPES.join(", ")}.`);
    if (typeof o.content !== "string") throw new ArtifactError("bad_request", "content is the artifact's source, as text.");
    if (o.projectId !== undefined && o.projectId !== null && (typeof o.projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(o.projectId))) {
      throw new ArtifactError("bad_request", "projectId is a project's id.");
    }
    const warnings = assertValid({ type, content: o.content });
    if ((await this.store.countFor(userId)) >= ARTIFACTS_PER_PERSON) {
      throw new ArtifactError("too_many", `You have ${ARTIFACTS_PER_PERSON} artifacts, which is the most. Delete one first.`);
    }
    const title = this.title(o.title, type);
    const artifact = await this.store.create(
      { userId, type, title, projectId: typeof o.projectId === "string" ? o.projectId : null },
      newVersion(1, "", o.content, { madeBy: o.madeBy ?? "bot", note: o.note ?? "Created" }),
    );
    this.remember(`${artifact.id}@1`, o.content);
    return { artifact, version: 1, paise: 0, totalPaise: 0, how: { mode: "create", warnings, artifactChars: o.content.length } };
  }

  /** artifact_update: exact, unique replacements, all or nothing. No model call; the patch is the edits. */
  async update(userId: string, id: string, edits: unknown, note?: string): Promise<Change> {
    const { artifact, content } = await this.load(userId, id);
    const { content: next, pos } = applyEdits(content, edits);
    return this.commit(artifact, next, {
      madeBy: "bot", note: note ?? `${pos.length} edit${pos.length === 1 ? "" : "s"}`, hint: pos, paise: 0, how: { mode: "edits", artifactChars: next.length },
    });
  }

  /** artifact_rewrite: the whole new text. For when most of it changes. */
  async rewrite(userId: string, id: string, content: unknown, note?: string): Promise<Change> {
    if (typeof content !== "string") throw new ArtifactError("bad_request", "content is the artifact's whole new source, as text.");
    const { artifact } = await this.load(userId, id);
    return this.commit(artifact, content, { madeBy: "bot", note: note ?? "Rewritten", paise: 0, how: { mode: "rewrite", artifactChars: content.length } });
  }

  async revert(userId: string, id: string, version: unknown): Promise<Change> {
    if (typeof version !== "number" || !Number.isInteger(version)) throw new ArtifactError("bad_request", "version is the version to go back to.");
    const artifact = await this.own(userId, id);
    if (version < 1 || version >= artifact.headVersion) throw new ArtifactError("bad_request", `version is one of 1 to ${artifact.headVersion - 1}: an earlier version than the one showing.`);
    const old = await this.contentOf(artifact.id, version);
    return this.commit(artifact, old, { madeBy: "person", note: `Went back to version ${version}`, paise: 0, how: { mode: "revert", artifactChars: old.length } });
  }

  async remove(userId: string, id: string): Promise<void> {
    const a = await this.own(userId, id);
    await this.store.delete(a.id);
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${a.id}@`)) this.cache.delete(k);
  }

  // ------------------------------------------------------------------ the person's edits (edit.ts)

  async editElement(userId: string, id: string, elementId: string, instruction: string, signal?: AbortSignal): Promise<Change> {
    this.rate("edit", userId);
    return this.engine.editElement(userId, id, elementId, instruction, { ...(signal ? { signal } : {}) });
  }

  async editWhole(userId: string, id: string, instruction: string, signal?: AbortSignal): Promise<Change> {
    this.rate("edit", userId);
    return this.engine.editWhole(userId, id, instruction, { ...(signal ? { signal } : {}) });
  }

  async reportError(userId: string, id: string, version: number, err: ViewerError, signal?: AbortSignal): Promise<FixOutcome> {
    this.rate("errors", `${userId}:${id}`);
    return this.engine.reportError(userId, id, version, err, { ...(signal ? { signal } : {}) });
  }

  // ------------------------------------------------------------------ sharing

  async share(userId: string, id: string, o: { othersCanSave?: boolean } = {}): Promise<Artifact> {
    const a = await this.own(userId, id);
    const out = await this.store.setShare(a.id, { shareToken: a.shareToken ?? newShareToken(), ...(o.othersCanSave !== undefined ? { othersCanSave: o.othersCanSave } : {}) });
    return out!;
  }

  async unshare(userId: string, id: string): Promise<Artifact> {
    const a = await this.own(userId, id);
    return (await this.store.setShare(a.id, { shareToken: null, othersCanSave: false }))!;
  }

  /** What a share link shows. A token that is not (or is no longer) one is not_shared: the same words for both. */
  async shared(token: string): Promise<SharedView> {
    const a = typeof token === "string" && token.length >= 16 && token.length <= 100 ? await this.store.getByToken(token) : null;
    if (!a) throw new ArtifactError("not_shared", "That link doesn't open anything.");
    const kit = await this.kitCss(a);
    return {
      id: a.id, type: a.type, title: a.title, version: a.headVersion, content: await this.contentOf(a.id, a.headVersion), othersCanSave: a.othersCanSave, ...(kit ? { kit } : {}),
    };
  }

  // ------------------------------------------------------------------ saved data and ask

  /**
   * Who is at the door. The owner, by their session. Or anyone with the artifact's share token (with or without a session). A session that
   * is not the owner's and has no token is not_found, as everywhere.
   */
  async access(artifactId: string, who: { userId: string | null; token?: string | null }): Promise<Access> {
    const a = typeof artifactId === "string" ? await this.store.get(artifactId) : null;
    if (a && who.userId && a.userId === who.userId) return { role: "owner", userId: who.userId, artifact: a };
    if (a && a.shareToken && who.token && who.token === a.shareToken) return { role: "viewer", userId: who.userId, artifact: a };
    if (!who.userId && !who.token) throw new ArtifactError("needs_login", "Sign in to open this.");
    throw new ArtifactError("not_found", "I couldn't find that artifact.");
  }

  /** The scope in storage for a request's `scope`, and whether the door is allowed to write to it. */
  private scopeFor(acc: Access, scope: DataScope, write: boolean): Scope {
    if (write && acc.role === "viewer" && !acc.artifact.othersCanSave) {
      throw new ArtifactError("forbidden", "The owner has not turned on saving for people who open this link.");
    }
    if (scope === "shared") return "shared";
    if (!acc.userId) throw new ArtifactError("needs_login", "Sign in to keep data of your own in this.");
    return acc.userId;
  }

  private principal(acc: Access, token?: string | null): string {
    return acc.userId ?? `link:${(token ?? acc.artifact.id).slice(0, 12)}`;
  }

  async dataKeys(acc: Access, scope: DataScope, token?: string | null): Promise<string[]> {
    this.rate("data", this.principal(acc, token));
    return this.store.dataKeys(acc.artifact.id, this.scopeFor(acc, scope, false));
  }

  async dataGet(acc: Access, scope: DataScope, key: string, token?: string | null): Promise<DataEntry | null> {
    this.rate("data", this.principal(acc, token));
    return this.store.dataGet(acc.artifact.id, this.scopeFor(acc, scope, false), keyOf(key));
  }

  async dataPut(acc: Access, scope: DataScope, key: string, value: unknown, token?: string | null): Promise<void> {
    this.rate("data", this.principal(acc, token));
    const k = keyOf(key);
    const sc = this.scopeFor(acc, scope, true);
    if (value === undefined) throw new ArtifactError("bad_request", "value is any JSON value.");
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
    if (bytes > LIMITS.storageValueBytes) throw new ArtifactError("too_large", `A saved value may be ${LIMITS.storageValueBytes / 1024} KB at most; this one is ${Math.ceil(bytes / 1024)} KB.`);
    if ((await this.store.dataPut(acc.artifact.id, sc, k, value)) === "too_many") {
      throw new ArtifactError("too_many", `An artifact may keep ${LIMITS.storageKeys} keys in a scope, and this one has them. Delete one first.`);
    }
  }

  async dataDelete(acc: Access, scope: DataScope, key: string, token?: string | null): Promise<boolean> {
    this.rate("data", this.principal(acc, token));
    return this.store.dataDelete(acc.artifact.id, this.scopeFor(acc, scope, true), keyOf(key));
  }

  /**
   * The artifact asks the bot a question. It is metered against the CALLER, never the owner: the cheap tier by default, one call, no climb,
   * held to the caller's day and to a rate. The caller must be signed in (there is no one else to meter).
   */
  async ask(acc: Access, prompt: unknown, o: { tier?: "cheap" | "code"; signal?: AbortSignal } = {}): Promise<{ text: string; paise: number; leftPaise: number }> {
    if (!acc.userId) throw new ArtifactError("needs_login", "Sign in to ask.");
    if (typeof prompt !== "string" || !prompt.trim()) throw new ArtifactError("bad_request", "prompt is what to ask.");
    if (prompt.length > LIMITS.askChars) throw new ArtifactError("too_large", `A question may be ${LIMITS.askChars} characters at most.`);
    this.rate("ask", acc.userId);
    if (this.askMeter.leftPaise(acc.userId) <= 0) throw new ArtifactError("limit_reached", "You have used what asking may cost in a day. It starts again tomorrow.");
    const askModel = new ArtifactModel({ ...(this.call ? { call: this.call } : {}), ...(this.gateway ? { gateway: this.gateway } : {}), meter: this.askMeter });
    const ran = await askModel.run<string>({
      userId: acc.userId, tier: o.tier ?? "cheap", purpose: "artifact.ask", noClimb: true, role: "artifact_ask",
      artifact: `<artifact title="${acc.artifact.title.replace(/["<>\n]/g, " ").slice(0, 80)}" type="${acc.artifact.type}"/>`,
      instruction: `<question>\n${forModel(prompt.trim()).replace(/<\/question/gi, "<\\/question")}\n</question>`,
      maxTokens: o.tier === "code" ? 2500 : 1200, capPaise: CAP_PAISE.ask, ...(o.signal ? { signal: o.signal } : {}),
      accept: (text) => (text.trim() ? { ok: true, value: text.trim() } : { ok: false, reason: "the answer is empty" }),
    });
    return { text: ran.value, paise: ran.paise, leftPaise: this.askMeter.leftPaise(acc.userId) };
  }

  // ------------------------------------------------------------------ making one from a request

  /**
   * A new artifact from words. The code tier, or the strong tier when the classifier says the request is complex; a failure climbs once.
   * `context` is the part of a project the artifact should look at home in (kit.ts passes the surrounding section and the located place).
   */
  async generate(userId: string, o: {
    request: string; type?: ArtifactType; title?: string; projectId?: string; kit?: string; context?: string; signal?: AbortSignal; image?: string; note?: string;
  }): Promise<Change & { classifiedAs: { difficulty: string; type: string } }> {
    const request = typeof o.request === "string" ? o.request.trim() : "";
    if (request.length < 3) throw new ArtifactError("bad_request", "Say what to make.");
    if (request.length > 8000) throw new ArtifactError("too_large", "The request is over 8,000 characters.");
    const type: ArtifactType = o.type && ARTIFACT_TYPES.includes(o.type) ? o.type : "html";
    this.rate("edit", userId);
    // The classifier is rules first and a tiny model only when unsure; what it costs is counted.
    let classifierPaise = 0;
    const counting: CallFn = (async (input, deps) => {
      const r = await (this.call ?? (callModel as CallFn))(input, deps);
      classifierPaise += r.paise;
      this.meter.add(userId, r.paise);
      return r;
    }) as CallFn;
    const cls = await classifyRequest(request, { repoEmpty: false }, { call: counting, ...(this.gateway ? { deps: this.gateway } : {}), userId });
    const tier = cls.difficulty === "high" ? "strong" : "code";
    const forType = FORMAT_RULES[type];
    const ran = await this.model.run<string>({
      userId, tier, purpose: "artifact.generate", role: "artifact_make", kit: o.kit ?? "", ...(o.image ? { image: o.image } : {}),
      artifact: `<artifact type="${type}">\n${forType}\n</artifact>${o.context ? `\n<surroundings>\n${o.context}\n</surroundings>` : ""}`,
      instruction: `Make it: ${forModel(request)}`,
      maxTokens: tier === "strong" ? 12000 : 6000, capPaise: tier === "strong" ? CAP_PAISE.strong : CAP_PAISE.code, ...(o.signal ? { signal: o.signal } : {}),
      accept: (text) => {
        const content = unfence(text);
        const checked = validateArtifact({ type, content });
        return checked.ok ? { ok: true, value: content } : { ok: false, reason: checked.errors.join(" ") };
      },
    });
    const made = await this.create(userId, {
      type, title: o.title ?? titleOf(request), content: ran.value, projectId: o.projectId ?? null, madeBy: "bot", note: o.note ?? cut(request, 100),
    });
    const paise = ran.paise + classifierPaise;
    await this.store.addSpend(made.artifact.id, paise);
    return {
      ...made, artifact: { ...made.artifact, spentPaise: made.artifact.spentPaise + paise }, paise, totalPaise: made.artifact.spentPaise + paise,
      classifiedAs: { difficulty: cls.difficulty, type: cls.type },
      how: { ...made.how, mode: "generate", tier: ran.tier, model: ran.model, promptTokens: ran.promptTokens, completionTokens: ran.completionTokens, sentChars: ran.sentChars },
    };
  }
}

// ------------------------------------------------------------------ prompts and small things

const FORMAT_RULES: Record<ArtifactType, string> = {
  html: "An HTML page: one self-contained document (inline <style> and <script>).",
  react: "A React component in one file, with a default export (JSX, hooks). Style with inline styles or a <style> tag, or Tailwind classes when a PROJECT STYLE says the project uses Tailwind.",
  svg: "One <svg>…</svg> element with a viewBox.",
  mermaid: "Mermaid diagram text only.",
  markdown: "Markdown text.",
};

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function titleOf(request: string): string {
  const first = request.replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0] ?? request;
  const t = cut(first.replace(/^(?:please\s+)?(?:make|build|create|design|show|draw|write)\s+(?:me\s+)?(?:an?\s+|the\s+)?/i, "").replace(/[.!?]+$/, "") || request, 60);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function keyOf(key: unknown): string {
  if (typeof key !== "string" || !KEY.test(key) || key.length > KEY_MAX) {
    throw new ArtifactError("bad_request", `A key is 1 to ${KEY_MAX} letters, digits, spaces and . _ : / @ # -, starting with a letter, digit or _.`);
  }
  return key;
}
