/**
 * THE PUBLIC OPENROUTER MODEL CATALOG: WHAT EACH MODEL CAN DO AND WHAT IT COSTS, READ LIVE (https://openrouter.ai/api/v1/models, no key needed).
 *
 * A copy is kept in e2e/cache/models.json for a day and used when the network is not there (and says so). The bake-off filters its candidates with it
 * (a model with no tool support is not a tool-role candidate, one that takes no image is not a vision candidate) and the smoke estimate prices from it.
 * Prices are US dollars per MILLION tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, mkdirp } from "./util.js";

export const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const FILE = path.join(CACHE_DIR, "models.json");

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per million tokens. */
  inUsdPerM: number;
  outUsdPerM: number;
  tools: boolean;
  image: boolean;
  jsonMode: boolean;
  contextLength: number;
  created: number;
}

export interface Catalog {
  fetchedAt: number;
  /** "live": just fetched. "cache": the saved copy (the network did not answer). "none": neither; prices are assumed. */
  source: "live" | "cache" | "none";
  models: Map<string, ModelInfo>;
}

interface RawModel {
  id: string; name?: string; created?: number; context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

export function parseCatalog(raw: { data?: RawModel[] }): Map<string, ModelInfo> {
  const out = new Map<string, ModelInfo>();
  for (const m of raw.data ?? []) {
    const per = (s: string | undefined): number => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? n * 1e6 : 0; };
    const params = m.supported_parameters ?? [];
    out.set(m.id, {
      id: m.id, name: m.name ?? m.id, inUsdPerM: per(m.pricing?.prompt), outUsdPerM: per(m.pricing?.completion),
      tools: params.includes("tools"), image: (m.architecture?.input_modalities ?? []).includes("image"),
      jsonMode: params.includes("response_format") || params.includes("structured_outputs"), contextLength: m.context_length ?? 0, created: m.created ?? 0,
    });
  }
  return out;
}

export async function loadCatalog(o: { fetchFn?: typeof fetch; maxAgeMs?: number; offline?: boolean; timeoutMs?: number } = {}): Promise<Catalog> {
  const f = o.fetchFn ?? fetch;
  const maxAge = o.maxAgeMs ?? 6 * 3600_000;
  let cached: { fetchedAt: number; raw: { data?: RawModel[] } } | null = null;
  try { if (fs.existsSync(FILE)) cached = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { cached = null; }
  if (cached && (o.offline || Date.now() - cached.fetchedAt < maxAge)) return { fetchedAt: cached.fetchedAt, source: "cache", models: parseCatalog(cached.raw) };
  if (!o.offline) {
    try {
      const res = await f(CATALOG_URL, { signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
      if (res.ok) {
        const raw = (await res.json()) as { data?: RawModel[] };
        mkdirp(CACHE_DIR);
        fs.writeFileSync(FILE, JSON.stringify({ fetchedAt: Date.now(), raw }));
        return { fetchedAt: Date.now(), source: "live", models: parseCatalog(raw) };
      }
    } catch { /* fall through to the copy */ }
  }
  if (cached) return { fetchedAt: cached.fetchedAt, source: "cache", models: parseCatalog(cached.raw) };
  return { fetchedAt: 0, source: "none", models: new Map() };
}

/** Prices to use for a slug when the catalog does not know it (and an estimate must still be made): a cheap-model guess, labelled by the caller. */
export const ASSUMED = { inUsdPerM: 0.3, outUsdPerM: 1.2 } as const;
