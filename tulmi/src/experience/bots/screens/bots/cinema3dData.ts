/**
 * THE CINEMA BOT'S 3D, AS THE SCREENS READ IT (routes/bots/cinema.ts sceneView, docs/cinema-3d.md §2a): a person's creations and
 * whether this server can render at all. Every link in it is one of ours, signed; what came back is held to the shape drawn.
 */
type Api = { api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> };

export const SCENES = "/v1/cinema/scenes";

export interface SceneView {
  id: string;
  creation: string;
  version: number;
  ask: string;
  status: "working" | "done" | "failed";
  rounds: number;
  error: string | null;
  at: number;
  /** The latest preview while it builds, the last one after. */
  preview?: string;
  /** The real render. */
  picture?: string;
  /** The other angles round it. */
  views?: string[];
  /** The picture of the idea it was built from, and that picture's id. */
  reference?: string;
  from?: string;
  /** The Blender script that makes it again, and the .blend when it was kept. */
  script?: string;
  blend?: string;
}

export interface ScenesData { render: { ok: boolean; version: string | null }; scenes: SceneView[] }

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const link = (v: unknown): string | undefined => (typeof v === "string" && /^\/v1\/cinema\/media\//.test(v) ? v : undefined);

export function cleanScene(raw: unknown): SceneView | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = str(r.id, 64);
  if (!id) return null;
  const status = r.status === "done" || r.status === "failed" ? r.status : "working";
  const views = Array.isArray(r.views) ? r.views.map(link).filter((x): x is string => !!x).slice(0, 4) : [];
  const out: SceneView = {
    id, creation: str(r.creation, 60), version: Number(r.version) || 1, ask: str(r.ask, 400), status,
    rounds: Math.max(0, Math.round(Number(r.rounds) || 0)), error: r.error ? str(r.error, 200) : null, at: Number(r.at) || 0,
  };
  for (const k of ["preview", "picture", "reference", "script", "blend"] as const) { const l = link(r[k]); if (l) out[k] = l; }
  if (views.length) out.views = views;
  if (/^[A-Za-z0-9_-]{1,64}$/.test(str(r.from, 64))) out.from = str(r.from, 64);
  return out;
}

export async function loadScenes(deps: Api): Promise<ScenesData | undefined> {
  const raw = await deps.api<{ render?: { ok?: unknown; version?: unknown }; scenes?: unknown[] }>("GET", SCENES).catch(() => undefined);
  if (!raw) return undefined;
  return {
    render: { ok: raw.render?.ok === true, version: typeof raw.render?.version === "string" ? raw.render.version : null },
    scenes: (Array.isArray(raw.scenes) ? raw.scenes : []).map(cleanScene).filter((s): s is SceneView => !!s),
  };
}

export async function loadScene(deps: Api, id: string): Promise<SceneView | undefined> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return undefined;
  return deps.api<unknown>("GET", `${SCENES}/${id}`).then((r) => cleanScene(r) ?? undefined).catch(() => undefined);
}

/** Where a creation stands, in words: never a spinner without a sentence. */
export function sceneLine(s: Pick<SceneView, "status" | "rounds" | "error">, rounds = 3): string {
  if (s.status === "done") return "Ready in 3D";
  if (s.status === "failed") return "Couldn't finish building it";
  return s.rounds ? `Building in 3D: round ${Math.min(s.rounds, rounds)} of ${rounds}` : "Reading your idea…";
}
