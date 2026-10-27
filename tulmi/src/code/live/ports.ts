/**
 * WHAT THE AGENT LOOP ASKS OF THE LIVE SESSION: FOUR SMALL PORTS, EACH OPTIONAL.
 *
 * The loop (code/agent) knows nothing of Durable Objects, WebSockets or Cloudflare. Everything the live session adds comes in through
 * `AgentDeps.live`, and a server that gives none behaves exactly as it always has (the VPS in local mode, a test with no room):
 *
 *   files      a job's copy of the code for instant read, list, glob and grep (the room, jobs/src/jobRoom.ts). When there is
 *              none, or it says `unavailable`, the tools use GitHub's API as before
 *   inbox      the person's words sent while the job works (POST /v1/code/jobs/:id/message): taken at the start of a model turn
 *   progress   compact events for the app's live view: the phase, a tool call and its result, the cost
 *   preview    the project's dev server on the job's runner, seen from a browser (the design round compares it to the approved design)
 *   closeSession / endJob
 *              the rules of the session that only the loop can keep: the session is closed BEFORE the person is asked anything
 *              (a session open while a person thinks costs minutes), and a job that is over leaves nothing behind
 *
 * The fake room the tests use (tulmi/tests/live-fakes.ts) and the real one answer through the same shapes.
 */
import type { OverlayFile } from "../jobs/types.js";
import type { CloseReason, ViewerEvent } from "./protocol.js";
import type { GlobOut, GrepOk, GrepOptions, ListOut, ReadOut } from "./search.js";

export interface LiveStatus {
  /** The copy is made and can answer. */
  ready: boolean;
  /** The repo did not fit in a copy: grep and glob go to the runner, read and list to GitHub. */
  remote: boolean;
  files: number;
  bytes: number;
  /** The commit the copy is of. */
  headSha: string;
}

export type LiveRead =
  | { kind: "ok"; out: ReadOut; staged: boolean }
  /** No such file in the copy (or it is deleted in the staged edits). */
  | { kind: "missing"; deleted: boolean }
  /** In the repo but not held (vendored, a lockfile, generated, binary, too big): GitHub can still be asked. */
  | { kind: "skipped"; reason: string }
  | { kind: "unavailable" };

export type LiveList = { kind: "ok"; out: ListOut } | { kind: "empty" } | { kind: "unavailable" };
export type LiveGlob = { kind: "ok"; out: GlobOut } | { kind: "error"; error: string } | { kind: "unavailable"; why?: string };
export type LiveGrep = { kind: "ok"; out: GrepOk } | { kind: "error"; error: string } | { kind: "unavailable"; why?: string };

export interface LiveFiles {
  /** Makes the copy if it is not made yet (the first need). Never throws: a copy that cannot be made is `ready: false`. */
  status(): Promise<LiveStatus>;
  /** The agent's staged edits, laid over every read. Idempotent. */
  setOverlay(files: readonly OverlayFile[]): Promise<void>;
  read(path: string, o: { offset?: number; limit?: number }): Promise<LiveRead>;
  list(dir: string): Promise<LiveList>;
  glob(pattern: string): Promise<LiveGlob>;
  grep(pattern: string, o: GrepOptions): Promise<LiveGrep>;
  /** The branch moved (a commit): the copy is of an older commit, so it is thrown away and made again at the next need. */
  reset?(): Promise<void>;
}

/** A word from the person, sent while the job works. */
export interface Said { id: string; text: string; at: number }

export interface Inbox {
  /** What the person has said that has not been acknowledged. */
  pending(jobId: string): Promise<Said[]>;
  /** The model has been shown these (and the state saved): they are not offered again. */
  ack(jobId: string, ids: readonly string[]): Promise<void>;
}

export interface LiveJob { id: string; userId: string; projectId: string; branch: string }

/** The result of asking for a preview (the dev server of the project, on the job's runner, seen from a browser). */
export type PreviewStarted = { ok: true } | { ok: false; reason: "off" | "no_session" | "bad_request"; message: string };

export interface PreviewState {
  state: "none" | "starting" | "ready" | "closed";
  /** The address it is seen at (ready or starting). Never log it: it is the way in. */
  url?: string;
  /** Why it did not start (the end of the dev server's output, redacted), or why it closed. */
  error?: string;
  closeReason?: string;
}

/**
 * The project's dev server on the job's runner, seen live: the room starts it with the staged edits laid, makes an address a browser can open (a site
 * of its own, never the app's), and closes it after a time with no request. The agent's design round uses it to shoot the real app.
 */
export interface LivePreview {
  start(job: LiveJob, o: { cmd: string; port?: number; prepare?: string; overlay: readonly OverlayFile[]; readySec?: number }): Promise<PreviewStarted>;
  status(jobId: string): Promise<PreviewState>;
  stop(jobId: string, reason?: string): Promise<void>;
}

export interface LiveDeps {
  files?: (job: LiveJob) => LiveFiles | null;
  inbox?: Inbox;
  /** Fire and forget: a lost event is a gap in a live view, never a failed job. */
  progress?: (jobId: string, ev: ViewerEvent) => void;
  closeSession?: (jobId: string, reason: CloseReason) => Promise<void>;
  endJob?: (jobId: string) => Promise<void>;
  /** The project's dev server on the job's runner (the design round). Absent: there is no preview. */
  preview?: LivePreview;
}

/** An inbox in this process's memory: enough for the VPS in local mode, where one process drives every job. */
export class MemoryInbox implements Inbox {
  private readonly items = new Map<string, Said[]>();
  private n = 0;

  /** Adds a word; returns it. */
  add(jobId: string, text: string, at = Date.now()): Said {
    const said: Said = { id: `m${(this.n += 1)}-${at}`, text, at };
    const list = this.items.get(jobId) ?? [];
    list.push(said);
    this.items.set(jobId, list.slice(-50));
    return said;
  }
  async pending(jobId: string): Promise<Said[]> { return [...(this.items.get(jobId) ?? [])]; }
  async ack(jobId: string, ids: readonly string[]): Promise<void> {
    const drop = new Set(ids);
    const left = (this.items.get(jobId) ?? []).filter((m) => !drop.has(m.id));
    if (left.length) this.items.set(jobId, left); else this.items.delete(jobId);
  }
}
