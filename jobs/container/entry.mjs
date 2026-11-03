// X0's cloud runner, for one live session of one Xode job (jobs/src/containers.ts starts the container with the step in X0_STEP).
//
//   1. reads the step (the same offer a person's PC gets: the repo, how to fetch it, the session's ticket) and drops it from the environment
//   2. fetches the code at the step's commit into /work/repo as a git checkout: with the read-only token for this one repo (an app project),
//      or the one-time download link (a sign-in project). The token is used once, by URL, and kept nowhere
//   3. runs the session exactly as GitHub's computers do (run.mjs runSession): connect to the job's room, run what it sends, until it closes
//
// It exits 0 when the session ended as it should, 1 otherwise; the Worker reports the step from that (containers.ts onStop).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { runSession } from "./run.mjs";

const DIR = "/work/repo";
const say = (m) => console.log("X0 cloud: " + m);
const fail = (m) => { console.error("X0 cloud: " + m); process.exit(1); };

const raw = process.env.X0_STEP || "";
delete process.env.X0_STEP;
let step;
try { step = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { fail("the step could not be read"); }
if (!step || !step.session || typeof step.session.url !== "string") fail("this runner takes live sessions only");
const repo = step.repo || {};

const git = (args) => execFileSync("git", ["-c", "advice.detachedHead=false", ...args], { cwd: DIR, stdio: ["ignore", "ignore", "inherit"], timeout: 300_000 });

async function fetchCode() {
  mkdirSync(DIR, { recursive: true });
  git(["init", "-q"]);
  if (repo.kind === "app" && repo.readToken && /^https:\/\/github\.com\//.test(repo.cloneUrl || "")) {
    const url = new URL(repo.cloneUrl);
    url.username = "x-access-token";
    url.password = repo.readToken;
    // GitHub serves any commit by its sha; the token goes in the URL for this one fetch and is never written to the repo's config.
    git(["fetch", "-q", "--depth", "1", url.href, repo.headSha || repo.branch]);
    git(["checkout", "-q", "FETCH_HEAD"]);
    return;
  }
  // https, or this machine itself (a test's stand-in; a real container has nothing listening on it).
  if (repo.tarballUrl && /^(?:https:\/\/|http:\/\/127\.0\.0\.1:\d+\/)/.test(repo.tarballUrl)) {
    const res = await fetch(repo.tarballUrl);
    if (!res.ok) fail("the code could not be downloaded (" + res.status + ")");
    writeFileSync("/work/code.tgz", Buffer.from(await res.arrayBuffer()));
    execFileSync("tar", ["-xzf", "/work/code.tgz", "--strip-components=1", "-C", DIR], { stdio: "inherit", timeout: 300_000 });
    rmSync("/work/code.tgz", { force: true });
    // The session resets and searches with git, so the download becomes the checkout's one commit.
    git(["add", "-A"]);
    git(["-c", "user.name=X0", "-c", "user.email=x0@localhost", "commit", "-q", "-m", "checkout", "--no-verify"]);
    return;
  }
  fail("the step says no way to get the code");
}

try {
  await fetchCode();
} catch (err) {
  fail("the code could not be fetched: " + String(err && err.message ? err.message : err).replace(/x-access-token:[^@]+@/g, "x-access-token:***@").slice(0, 200));
}
say("code ready at " + (repo.headSha || repo.branch || "the branch").slice(0, 12) + "; joining the job's room");
const ended = await runSession({ session: step.session }, { cwd: DIR });
say("session ended (" + ended.reason + "), " + ended.commands + " command(s) run");
process.exit(ended.exitCode === 0 ? 0 : 1);
