/**
 * THE 3D HALF, CONNECTED: what turns "a brass desk lamp on an oak table" into a picture a phone can open.
 *
 * The loop (make.ts) was written to know nothing about where it runs or who asked. This is the thing that knows: it takes a person's
 * words, gives the creation a key, runs the loop against the renderer this machine is (blender.ts renderHere), keeps the row (store.ts)
 * and hands back an id. The pictures go to the bucket under that person's own keys; the row only names them.
 *
 *   ready()    whether there is a Blender here at all. A machine with none SAYS SO, before anything is asked of it, instead of
 *              taking the work and failing a minute later
 *   start()    the creation's row, then the loop in the background. A render is a minute or two; nothing waits on an HTTP request
 *   get/list   what a person comes back to
 *
 * ONE AT A TIME, PER PERSON AND PER MACHINE. blenderRunner already queues renders on one lane, because two on one box share the cores
 * and take the app down with them. On top of that a person may have one creation going: a second ask gets a plain refusal, not a queue
 * nobody can see. Both limits are the point rather than an apology — this is a box that also serves the app.
 *
 * WHAT THIS BOX CAN DO. No graphics card, so Cycles renders on cores (script.ts falls back by itself): a small preview is seconds, a
 * full frame is minutes, and an animation is 24 of those frames a second. So a still is what a person gets here; a moving scene wants
 * their own computer or a rented card, which the same script already runs on unchanged.
 */
import { randomUUID } from "node:crypto";
import { getConfig } from "../../config.js";
import type { CallFn } from "../../code/work/model.js";
import { blobStoreFromConfig, MemoryBlobStore, type BlobStore } from "../../media/blob.js";
import { renderHere } from "./blender.js";
import { make, type Made } from "./make.js";
import type { Render } from "./ports.js";
import { sceneStore, type KeptKeys, type SceneRecord, type SceneStore } from "./store.js";

export interface SceneDeps {
  store: SceneStore;
  blobs: BlobStore | null;
  render: Render;
  ready: () => Promise<{ ok: boolean; version: string | null }>;
  capPaise: number;
  /** callModel, or a stand-in (ModelCtx.call). Tests drive the loop with a fake model; the server leaves it out. */
  call?: CallFn;
  now?: () => number;
  /** Tests wait on this instead of sleeping. */
  onDone?: (r: SceneRecord) => void;
  log?: (line: string) => void;
}

/** What a person may have going at once. */
export const PER_PERSON = 1;
/** How many build-and-look rounds a creation gets here. */
export const ROUNDS = 3;

export class SceneService {
  private readonly working = new Set<string>();

  constructor(private readonly d: SceneDeps) {}

  private now(): number { return (this.d.now ?? Date.now)(); }

  /** Whether this machine can render at all, and which Blender it has. */
  async ready(): Promise<{ ok: boolean; version: string | null }> {
    return this.d.ready().catch(() => ({ ok: false, version: null }));
  }

  /**
   * A new creation, or the next version of one. The row is written before the loop starts, so a person who asks and closes the app
   * still has the thing they asked for when they come back.
   */
  async start(userId: string, ask: string, o: { creation?: string; keepBlend?: boolean } = {}): Promise<{ id: string; creation: string; version: number }> {
    const words = ask.trim();
    if (!words) throw new Error("say what to build");
    if (this.working.has(userId)) throw new Error("one at a time");

    // A change to something already made starts from its scene, and is the next version of the same creation.
    const creation = (o.creation ?? "").trim() || randomUUID().slice(0, 8);
    const before = o.creation ? await this.d.store.latest(userId, creation).catch(() => null) : null;
    const version = before ? Math.min(999, before.version + 1) : 1;

    const at = this.now();
    const row: SceneRecord = {
      id: randomUUID(), ownerId: userId, creation, version, ask: words.slice(0, 4000),
      status: "working", why: null, rounds: 0, objects: 0, kept: {}, mime: null, paise: 0, error: null,
      createdAt: at, updatedAt: at,
    };
    await this.d.store.create(row);

    this.working.add(userId);
    void this.run(row, o.keepBlend === true).finally(() => this.working.delete(userId));
    return { id: row.id, creation, version };
  }

  /** The loop, and the row it leaves behind either way. */
  private async run(row: SceneRecord, keepBlend: boolean): Promise<void> {
    let made: Made | null = null;
    let failed: string | null = null;
    try {
      made = await make(
        { userId: row.ownerId, budget: { maxPaise: this.d.capPaise }, ...(this.d.call ? { call: this.d.call } : {}) },
        {
          ask: row.ask, creation: row.creation, version: row.version, rounds: ROUNDS,
          capPaise: this.d.capPaise, keepBlend,
          render: this.d.render, store: this.d.blobs,
        },
      );
    } catch (err) {
      failed = (err as Error)?.message ?? "the loop stopped";
      this.d.log?.(`[cinema/scene] ${row.id} failed`);
    }

    const last = made?.rounds[made.rounds.length - 1];
    const kept: KeptKeys = {};
    for (const name of ["script", "preview", "final", "blend"] as const) {
      const k = made?.kept[name];
      if (k) kept[name] = k.key;
    }
    const done: SceneRecord = {
      ...row,
      status: made?.ok ? "done" : "failed",
      why: made?.why ?? null,
      rounds: made?.rounds.length ?? 0,
      objects: last?.objects ?? 0,
      kept,
      mime: made?.mime ?? null,
      paise: made?.paise ?? 0,
      error: failed ?? (made && !made.ok ? (last?.renderError ?? `stopped: ${made.why}`) : null),
      updatedAt: this.now(),
    };
    await this.d.store.save(done).catch(() => this.d.log?.(`[cinema/scene] ${row.id} not written down`));
    this.d.onDone?.(done);
  }

  async get(userId: string, id: string): Promise<SceneRecord | null> { return this.d.store.get(userId, id); }
  async list(userId: string, limit = 30): Promise<SceneRecord[]> { return this.d.store.list(userId, limit); }

  /**
   * A restart leaves rows saying 'working' that nothing is working on: the process that was is gone. They are failed, once, at
   * start-up, so a person sees what happened instead of a thing that never finishes.
   */
  async sweep(): Promise<number> {
    const stuck = await this.d.store.stranded(200).catch(() => []);
    for (const r of stuck) {
      await this.d.store.save({ ...r, status: "failed", error: "the server restarted while this was building", updatedAt: this.now() }).catch(() => undefined);
    }
    return stuck.length;
  }

  /** Their rows go with the account; the blobs go with the bucket's own sweep of u/ and c/ keys. */
  async forAccountDelete(userId: string): Promise<void> { await this.d.store.forAccountDelete(userId); }
}

let shared: SceneService | null = null;

/** The 3D half as this server runs it, or null where it is switched off. */
export function buildSceneService(): SceneService {
  const cfg = getConfig();
  const here = renderHere({
    ...(cfg.CINEMA_BLENDER ? { bin: cfg.CINEMA_BLENDER } : {}),
    ...(cfg.CINEMA_WORK ? { workDir: cfg.CINEMA_WORK } : {}),
  });
  // R2 IS WHERE A CREATION LIVES (media/blob.ts: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET). Without it the
  // bytes are in memory and a restart forgets them, which matters more here than it does for a film: the row survives the restart
  // and would go on naming a script and a preview that are gone. So it is said out loud at start-up rather than found later.
  const r2 = blobStoreFromConfig();
  if (!r2) console.warn("[cinema/scene] R2 is not set up: creations are kept in memory, and a restart forgets their files while the rows remain");
  const svc = new SceneService({
    store: sceneStore(),
    blobs: r2 ?? new MemoryBlobStore(),
    render: here.render,
    ready: here.ready,
    capPaise: cfg.CINEMA_CAP_PAISE,
    log: (line) => console.warn(line),
  });
  shared = svc;
  return svc;
}

export const sceneService = (): SceneService | null => shared;
export function setSceneService(s: SceneService | null): void { shared = s; }
