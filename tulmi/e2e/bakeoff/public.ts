/**
 * PUBLIC BENCHMARKS: TERMINAL-BENCH AND SWE-BENCH PRO, THROUGH HARBOR.
 *
 * Both run each task in a Docker container (Terminal-Bench: the task's own image; SWE-bench Pro: one image per instance from GHCR). This container has the docker CLI
 * but no daemon, so there is no way to run even five tasks here without Docker, and nothing in this file pretends otherwise: it checks for a daemon, and says what
 * to run where there is one. Harbor (Apache-2.0) is the runner for both, and its installed-agent adapters cover the same open-source agents as agents/versions.json
 * (aider, codex, opencode, mini-swe-agent, openhands), so the same contestants, the same model and the same proxy can be scored on the public tasks.
 */
import { run } from "../util.js";

export const HARBOR_PIN = "0.24.0";

export interface PublicBench {
  status: "docker-available" | "skipped";
  reason: string;
  harbor: { version: string; licence: string; installed: false };
  benchmarks: Array<{ id: string; what: string; sample: string; licence: string }>;
  howTo: string[];
}

export async function checkDocker(): Promise<{ ok: boolean; why: string }> {
  const r = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15_000 });
  return r.code === 0 && r.stdout.trim() ? { ok: true, why: `docker daemon ${r.stdout.trim()}` } : { ok: false, why: (r.stderr.trim().split("\n")[0] ?? "no docker daemon").slice(0, 160) };
}

export async function publicBench(): Promise<PublicBench> {
  const d = await checkDocker();
  return {
    status: d.ok ? "docker-available" : "skipped",
    reason: d.ok ? "a Docker daemon is there: run the commands below (they are not started automatically: a sample is real money and about 20 GB of images)" : `no Docker daemon in this container (${d.why}), and both benchmarks run their tasks in containers: documented, not run`,
    harbor: { version: HARBOR_PIN, licence: "Apache-2.0", installed: false },
    benchmarks: [
      { id: "terminal-bench@4.0.0", what: "66 shell tasks in sandboxes (build, install, server setup, debugging)", sample: "5 tasks", licence: "Apache-2.0" },
      { id: "SWE-bench Pro (public, V2)", what: "642 long-horizon issue-to-patch tasks in 11 repos; the `hard` subset has 51", sample: "5 tasks of the hard subset", licence: "MIT code; dataset without a licence tag, internal evaluation only" },
    ],
    howTo: [
      `# On a machine with Docker, once. Pinned: harbor ${HARBOR_PIN} (Apache-2.0, released 2026-10-05; never @latest).`,
      `uv tool install harbor==${HARBOR_PIN}`,
      "# The recording proxy gives each agent the same model, a hard cap and a cassette. From tulmi/:",
      "OPENROUTER_API_KEY=... npm run e2e:proxy -- --mode mixed --cassette public --budget-inr 150      # port 8787",
      "# A container reaches the host's proxy at host.docker.internal:8787 (add --add-host=host.docker.internal:host-gateway on Linux).",
      "export OPENAI_API_BASE=http://host.docker.internal:8787/v1 OPENAI_BASE_URL=http://host.docker.internal:8787/v1 OPENAI_API_KEY=any-text",
      "# Terminal-Bench 4.0, a 5-task sample, one agent (repeat with -a aider, -a codex, -a opencode, -a openhands):",
      "harbor run -d terminal-bench/terminal-bench@4.0.0 -a mini-swe-agent -m openai/qwen/qwen3.7-flash -n 5",
      "# SWE-bench Pro, a 5-task sample of the hard subset (Docker images from GHCR, no login):",
      "harbor run -p v2/tasks -a mini-swe-agent -m openai/qwen/qwen3.7-flash -n 5",
      "# Flags are as Harbor's README documents them for 0.24: check `harbor run --help` first. Report resolved, cost per task (the proxy's /run/<id>/stats), tokens, wall time.",
      "# SWE-bench Verified is not a headline any more (OpenAI stopped using it, February 2026); use it only as a regression smoke test.",
    ],
  };
}
