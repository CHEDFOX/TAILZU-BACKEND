/**
 * THE WORDS WEB SEARCH IS MADE OF: A PLAN, A RESULT, A SOURCE, AND THE MODEL
 * CALL IT MAY BE HANDED.
 *
 * Shared by the planner (plan.ts), the sources (sources/), the ranker
 * (rank.ts), the engine (engine.ts) and research (../research.ts), and
 * imported by nothing outside src/web except the glue in code/webTools.ts. It
 * names no model and no store: a model is an AskFn handed in, a store is a
 * SearchStore handed in.
 */
import type { z } from "zod";
import type { FetchLike } from "../../connectors/egress.js";

export type { FetchLike } from "../../connectors/egress.js";

// ------------------------------------------------------------------ the plan

export const INTENTS = ["package_lookup", "api_docs", "error_fix", "how_to", "compare_libs", "version_news", "general"] as const;
export type Intent = (typeof INTENTS)[number];

/** The keyless sources a plan may name: each one a public API with a shape of its own. */
export const DIRECT_SOURCES = ["npm", "pypi", "crates", "github", "stackoverflow", "mdn", "hn", "wikipedia"] as const;
export type SourceId = (typeof DIRECT_SOURCES)[number];

/** Search engines that find pages anywhere: tried in this order, the next only when one fails or finds nothing. */
export const DISCOVERY_SOURCES = ["searxng", "ddg", "brave"] as const;
export type DiscoveryId = (typeof DISCOVERY_SOURCES)[number];

/** Where a result came from: a direct source, a discovery engine, or our own index. */
export type ResultSource = SourceId | DiscoveryId | "index";

export type Freshness = "any" | "year" | "month";

/** What the caller knows about the project, so a question can be read in its light. */
export interface PlanCtx {
  /** "typescript", "python", ... */
  languages?: string[];
  /** The project's dependencies, by name. */
  deps?: string[];
  /** The main framework, by name ("react", "next", "django"). */
  framework?: string;
}

export interface SearchPlan {
  intent: Intent;
  /** One to three search queries, already free of paths, numbers and anything that looks like a secret. */
  queries: string[];
  /** The direct sources to ask, most useful first. */
  sources: SourceId[];
  /** Official documentation hosts to prefer ("react.dev", "nextjs.org/docs"). */
  site?: string[];
  freshness: Freshness;
  /** 0 to 1: how sure the plan is. Under 0.7 the planner asks a model. */
  confidence: number;
}

// ------------------------------------------------------------------ results

/** One thing found, in the shape every source answers in. */
export interface Result {
  title: string;
  url: string;
  /** A few hundred characters of what it says. Web text: never put it in a prompt except through asUntrusted. */
  snippet: string;
  source: ResultSource;
  /** Epoch ms of when it was published or last changed, when the source says. */
  published?: number;
  /**
   * What the source knows about it. `kind` is always there and is one of
   * package, repo, issue, question, doc, story, article, page; the rest depends
   * on the source (version, license, stars, accepted, ...).
   */
  meta?: Record<string, unknown>;
}

export interface Ranked extends Result {
  score: number;
  /** Why it scored as it did, in short phrases. */
  reasons: string[];
}

// ------------------------------------------------------------------ sources

/** Keys and addresses a source may use, all optional: a source without what it needs says nothing. */
export interface SearchEnv {
  /** The self-hosted SearXNG, https. */
  searxngUrl?: string;
  braveKey?: string;
  stackKey?: string;
  /** A GitHub token: raises the search limit from 10 a minute to 30. Never cached with results. */
  githubToken?: string;
}

export interface SourceOpts {
  /** In place of the guarded egress fetch (10 seconds, 1 MiB). Tests only. */
  fetchFn?: FetchLike;
  /** Results wanted. */
  limit?: number;
  now?: () => number;
  intent?: Intent;
  freshness?: Freshness;
  env?: SearchEnv;
  /** Waits. Tests only. */
  sleep?: (ms: number) => Promise<void>;
}

export interface Source {
  id: ResultSource;
  /** Throws WebError for a source that failed, SearchSkip for one that stands aside. */
  search(q: string, opts?: SourceOpts): Promise<Result[]>;
}

/** A source that stands aside on purpose (a rate limit used up, a block to wait out). Not a failure. */
export class SearchSkip extends Error {
  constructor(readonly reason: "rate_limited" | "blocked" | "busy" | "not_configured") {
    super(`search source skipped (${reason})`);
    this.name = "SearchSkip";
  }
}

// -------------------------------------------------------------------- the model

export type AskLevel = "tiny" | "cheap" | "code" | "strong";

/** One model call that search or research wants made. The system text is ours; `user` may carry web text only inside asUntrusted wrappers. */
export interface AskRequest {
  /** How much model the job deserves: the caller maps it to a tier. */
  level: AskLevel;
  /** A word for the log and the ledger, never any content. */
  purpose: string;
  system: string;
  user: string;
  /** A zod schema to hold the answer to, or true for any JSON. */
  json?: z.ZodType<unknown> | true;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AskReply {
  text: string;
  /** The parsed JSON, when `json` was asked for. */
  json?: unknown;
  /** What the call cost, in paise, when the caller knows. */
  paise?: number;
}

/** The model, as search and research see it. May throw: a budget error has `code: "budget_exceeded"`. */
export type AskFn = (req: AskRequest) => Promise<AskReply>;

/** Whether a thrown thing is the model gateway's "the budget cannot cover this call". Structural: this layer does not import the gateway. */
export function isBudgetError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "budget_exceeded";
}
