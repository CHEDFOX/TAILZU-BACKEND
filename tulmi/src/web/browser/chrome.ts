/**
 * FINDING CHROME, AND STARTING IT HEADLESS.
 *
 * findChrome() answers where a Chrome is on this machine: the path it is told
 * (CHROME_PATH, passed in), then the ones Playwright's installer leaves under
 * /opt/pw-browsers (the newest first), then google-chrome, chromium and
 * chromium-browser on PATH. None: null, and the browser is simply not
 * available.
 *
 * launch() starts one with its own empty profile in a temp folder, a debugging
 * port chosen by the system (the line "DevTools listening on ws://..." on its
 * stderr says which), and ALL of its network traffic sent to the guard proxy
 * (guard.ts): --proxy-server points there, and --proxy-bypass-list=<-loopback>
 * takes away Chrome's habit of skipping proxies for localhost, so even a
 * request for 127.0.0.1 or 169.254.169.254 goes to the guard and is refused
 * there. Chrome is also told not to resolve any name itself
 * (--host-resolver-rules), to leave QUIC and WebRTC UDP off, and to do nothing
 * in the background, so nothing it does can bypass the proxy. The profile
 * folder is removed when Chrome is closed, once nothing it started (its process
 * group) is still running.
 *
 * No sandbox flag unless this process is root (a container usually is), where
 * Chrome refuses to start without --no-sandbox. That trades away the sandbox
 * between a page and this machine, which is the reason the guard exists and the
 * reason the browser should run where nothing else is at stake.
 *
 * Free of the app on purpose: node builtins only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface FindOptions {
  /** CHROME_PATH: tried first. A path that is not an executable file is skipped, not an error. */
  chromePath?: string;
  /** The environment to read PATH (and PLAYWRIGHT_BROWSERS_PATH) from. */
  env?: NodeJS.ProcessEnv;
  /** Folders Playwright installs into. Default /opt/pw-browsers. */
  roots?: string[];
}

const PATH_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

const isExecutable = (p: string): boolean => {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Playwright's `chromium-1194` style names, newest build number first. */
const newestFirst = (a: string, b: string): number => (Number(b.match(/(\d+)$/)?.[1] ?? 0) - Number(a.match(/(\d+)$/)?.[1] ?? 0)) || b.localeCompare(a);

/** The path of a Chrome or Chromium on this machine, or null. */
export function findChrome(o: FindOptions = {}): string | null {
  const env = o.env ?? process.env;
  const given = o.chromePath?.trim();
  if (given && isExecutable(given)) return given;

  const roots = o.roots ?? ["/opt/pw-browsers", ...(env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== "0" ? [env.PLAYWRIGHT_BROWSERS_PATH] : [])];
  for (const root of roots) {
    let names: string[] = [];
    try { names = readdirSync(root).filter((n) => n.startsWith("chromium")).sort(newestFirst); } catch { continue; }
    for (const name of names) {
      // chromium_headless_shell has no `chrome`, only headless_shell, which is a different program.
      for (const dir of ["chrome-linux", "chrome-linux64"]) {
        const p = join(root, name, dir, "chrome");
        if (isExecutable(p)) return p;
      }
    }
  }

  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of PATH_NAMES) {
      const p = join(dir, name);
      if (isExecutable(p)) return p;
    }
  }
  return null;
}

export interface LaunchOptions {
  chromePath: string;
  /** The guard proxy's port on 127.0.0.1. */
  proxyPort: number;
  /** How long Chrome has to print its DevTools address. Default 15 s. */
  timeoutMs?: number;
  /** More command-line flags, after ours. */
  extraArgs?: string[];
}

export interface LaunchedChrome {
  /** ws://127.0.0.1:<port>/devtools/browser/<id> */
  wsUrl: string;
  readonly pid: number | undefined;
  /** False once the process has exited. */
  readonly alive: boolean;
  /** Runs `fn` when the process exits (now, if it already has). */
  onExit(fn: () => void): void;
  /** Stops Chrome and what it started, and deletes its profile folder: it is gone when this resolves. Safe to call again. */
  close(): Promise<void>;
}

/** Chrome leads a process group of its own (not on Windows), so that what it started can be found and stopped once it has gone. */
const GROUPED = process.platform !== "win32";

/** Everything launched and not yet closed, so that a process exiting does not leave Chromes behind. */
const live = new Set<ChildProcess>();
let hooked = false;
function killAllOnExit(): void {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => {
    for (const p of live) { try { if (GROUPED && p.pid) process.kill(-p.pid, "SIGKILL"); else p.kill("SIGKILL"); } catch { /* gone */ } }
  });
}

const isRoot = (): boolean => typeof process.getuid === "function" && process.getuid() === 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Whether anything in Chrome's process group still runs. Some of what Chrome starts outlives it: after a SIGKILL, and now and then after a SIGTERM, its
 * zygote, GPU process or network service is still running when its exit is reported, and so are the sandbox's brokers, which open and create files in the
 * profile for them and do not have it on their command line. Zombies are not counted: they write nothing, and where nobody reaps orphans (a container whose
 * first process is node) they never go.
 */
function groupRunning(pgid: number): boolean {
  let names: string[];
  try { names = readdirSync("/proc"); } catch {
    try { process.kill(-pgid, 0); return true; } catch { return false; }
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const [state, , group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (state !== "Z" && Number(group) === pgid) return true;
    } catch { /* gone while we looked */ }
  }
  return false;
}

/**
 * Once Chrome itself has exited: kills what is left of its group and waits for it to go, then deletes the profile folder and looks again, until it is really
 * gone (within a few seconds). Deleted while one of them still wrote into it, the folder was not removed or was made again, and stayed in the temp directory.
 */
async function removeProfile(profile: string, pgid: number | undefined): Promise<void> {
  const end = Date.now() + 10_000;
  while (pgid && groupRunning(pgid) && Date.now() < end) {
    try { process.kill(-pgid, "SIGKILL"); } catch { /* gone */ }
    await sleep(50);
  }
  for (;;) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    if (!existsSync(profile) || Date.now() >= end) return;
    await sleep(100);
  }
}

/** Starts Chrome and resolves once it has printed where to talk to it. */
export async function launch(o: LaunchOptions): Promise<LaunchedChrome> {
  const profile = mkdtempSync(join(tmpdir(), "tailzu-chrome-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-quic",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--mute-audio",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    `--proxy-server=http://127.0.0.1:${o.proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
    // Chrome resolves no name itself: the guard does, and checks what it finds.
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    // Nothing Chrome does for itself: no update checks, pings, phishing lists or time sync.
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-default-apps",
    "--no-pings",
    "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
    "--disable-features=Translate,OptimizationHints,MediaRouter,NetworkTimeServiceQuerying,AutofillServerCommunication,CertificateTransparencyComponentUpdater",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-breakpad",
    "--hide-scrollbars",
    ...(isRoot() ? ["--no-sandbox"] : []),
    ...(o.extraArgs ?? []),
    "about:blank",
  ];

  const proc = spawn(o.chromePath, args, { stdio: ["ignore", "ignore", "pipe"], detached: GROUPED });
  live.add(proc);
  killAllOnExit();

  let alive = true;
  const exitFns = new Set<() => void>();
  const gone = new Promise<void>((resolve) => {
    proc.once("exit", () => {
      alive = false;
      live.delete(proc);
      for (const fn of exitFns) { try { fn(); } catch { /* ignore */ } }
      exitFns.clear();
      resolve();
    });
  });
  proc.once("error", () => { alive = false; live.delete(proc); });

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => (closing ??= (async () => {
    if (alive) {
      try { proc.kill("SIGTERM"); } catch { /* gone */ }
      const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } }, 2_000);
      await gone;
      clearTimeout(timer);
    }
    await removeProfile(profile, GROUPED ? proc.pid : undefined);
  })());

  let wsUrl: string;
  try {
    wsUrl = await new Promise<string>((resolve, reject) => {
      let seen = "";
      const timer = setTimeout(() => reject(new Error("Chrome did not say where its DevTools are")), o.timeoutMs ?? 15_000);
      proc.stderr!.on("data", (chunk: Buffer) => {
        seen = (seen + chunk.toString("utf8")).slice(-4_000);
        // The whole line, newline included: stderr may hand it over in pieces, and half an address is not one.
        const m = /DevTools listening on (ws:\/\/\S+)\r?\n/.exec(seen);
        if (m) { clearTimeout(timer); resolve(m[1]!); }
      });
      proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited before it was ready (${code})`)); });
      proc.once("error", () => { clearTimeout(timer); reject(new Error("Chrome could not be started")); });
    });
  } catch (err) {
    await close();
    throw err;
  }
  // Keep reading stderr so Chrome never blocks on a full pipe; none of it is kept.
  proc.stderr!.on("data", () => {});

  return {
    wsUrl,
    get pid() { return proc.pid; },
    get alive() { return alive; },
    onExit(fn) { if (!alive) fn(); else exitFns.add(fn); },
    close,
  };
}
