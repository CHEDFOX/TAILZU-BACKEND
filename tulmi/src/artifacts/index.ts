/**
 * ARTIFACTS: LIVE THINGS A BOT MAKES AND THE PERSON SEES AND CLICKS. THE SERVER'S SIDE. The story is in docs/artifacts.md.
 *
 *   protocol.ts  the contract with the viewer (a page on its own site, in a sandbox, no network). Not changed here
 *   types.ts     what is kept, what a change returns, the numbers
 *   versions.ts  snapshots every 10th version, patches between, contentAt(), exact edits
 *   store.ts     artifacts, artifact_versions, artifact_data, artifact_kits: memory twin and Supabase (migration 0032)
 *   validate.ts  size, secrets, imports, no network, self-contained
 *   scan.ts      from "the element at line 14, column 7" to that element's source and nothing else
 *   limits.ts    rate limits and a person's daily spend
 *   model.ts     the one way to ask a model: a tier, a cap, a check on the answer, one climb
 *   edit.ts      the efficiency engine: edit an element, edit by instruction, fix an error from the viewer
 *   service.ts   what a bot, a person and a share link may do, in one place
 *   tools.ts     artifact_create, artifact_update, artifact_rewrite: the bot's tools, for any bot
 *   kitparse.ts  the readers that turn a project's files into design tokens
 *   kit.ts       designKit (the project's look, cached per head) and componentArtifact (a component shown in place)
 *   build.ts     "build it": an approved artifact becomes a Code bot job whose spec it is; the compare seam (CompareHook)
 *   pixels.ts    a PNG reader and the cheap gate (small grids of lightness and colour), in pure TypeScript
 *   shothost.ts  the host page an artifact's screenshot is taken of (it frames the viewer, posts load, marks #done)
 *   shots.ts     screenshots of a page and of an artifact (Cloudflare Browser Rendering, or our own Chrome), kept in the owner's saved data, with signed 7-day links
 *   compare.ts   the compare step (CompareHook): the cheap gate, then the vision tier, per viewport, metered in the job's budget
 *
 * Off unless ARTIFACTS=true (config.ts). Nothing here reaches a network or a store unless it is called to; every piece takes its
 * dependencies as arguments, so the tests drive it against a fake model and the memory twin.
 */
import { getConfig } from "../config.js";
import { ArtifactService, type ServiceOptions } from "./service.js";
import { ArtifactDataShotStore, type ShotStore } from "./shots.js";
import { artifactStore } from "./store.js";

export * from "./types.js";
export { LIMITS, ARTIFACT_LIBS, ELEMENT_ID_ATTR, PROTOCOL_VERSION } from "./protocol.js";
export type { DesignKitCss, ArtifactPayload, HostMsg, FrameMsg } from "./protocol.js";
export { ArtifactService } from "./service.js";
export type { Access, ArtifactView, SharedView, DataScope } from "./service.js";
export { MemoryArtifactStore, SupabaseArtifactStore, artifactStore, resetArtifactStoreForTests, ARTIFACT_TABLES, ARTIFACT_USER_TABLES, deleteViewerData } from "./store.js";
export type { ArtifactStore, ArtifactExport, StoredKit } from "./store.js";
export { ARTIFACT_TOOLS, ARTIFACT_TOOL_NAMES, runArtifactTool, isArtifactTool } from "./tools.js";
export { validateArtifact, assertValid } from "./validate.js";
export { EditEngine, FixBook } from "./edit.js";
export { designKit, componentArtifact, workspaceFiles, liveFiles } from "./kit.js";
export { buildFromArtifact, noCompare } from "./build.js";
export type { CompareHook, CompareInput, CompareResult, DesignIssue, ViewportResult } from "./build.js";
export { createCompareHook, compareShots, routeUrl } from "./compare.js";
export { shootUrl, shootArtifact, shootDepsFromConfig, shootProblem, ShotError, ArtifactDataShotStore, MemoryShotStore, signShotPath, verifyShotLink, isShotId, SHOT_TTL_MS } from "./shots.js";
export type { ShotStore, ShootDeps, ShotMeta } from "./shots.js";
export { decodePng, encodePng, gate, isPng, PngError } from "./pixels.js";
export { SHOT_VIEWPORTS, VIEWPORT_NAMES } from "./shothost.js";
export type { ViewportName } from "./shothost.js";

/** What the server holds while artifacts are on. */
export interface Artifacts {
  service: ArtifactService;
  /** The screenshots of a design check (shots.ts), in the owner's own scope of the artifact's saved data. */
  shots: ShotStore;
  /** Signs and checks the 7-day links to them (ARTIFACT_SHOT_SECRET, else CODE_JOBS_SECRET); null: none are served. */
  shotSecret: string | null;
}

/**
 * The artifact core, or null while ARTIFACTS is off. `o` is for tests and for a server that wants its own store or model door.
 */
export function createArtifacts(o: Partial<ServiceOptions> & { force?: boolean } = {}): Artifacts | null {
  const cfg = getConfig();
  if (!cfg.ARTIFACTS && !o.force) return null;
  const { force: _force, ...rest } = o;
  void _force;
  const store = rest.store ?? artifactStore();
  return {
    service: new ArtifactService({
      store, dailyPaise: cfg.ARTIFACT_DAILY_PAISE, askDailyPaise: cfg.ARTIFACT_ASK_DAILY_PAISE, ...rest,
    }),
    shots: new ArtifactDataShotStore(store),
    shotSecret: cfg.ARTIFACT_SHOT_SECRET || cfg.CODE_JOBS_SECRET || null,
  };
}
