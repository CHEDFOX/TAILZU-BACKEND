/**
 * mini-swe-agent (MIT, pip mini-swe-agent 2.4.6) AS THE CONTROL: a bash-only agent of about a hundred lines. If Tailzu's loop does not beat it on pass rate per
 * rupee, the loop is not earning its keep.
 *
 * `mini -m openai/<slug> -t <task> -y -l 0 -o traj.json`: yolo mode (no confirmations); its own cost limit is off (litellm cannot price an OpenRouter slug; the
 * proxy's per-run cap is what stops it); the model's base URL is a config override. Its trajectory file is where steps and the submission are read from.
 */
import fs from "node:fs";
import path from "node:path";
import { externalAgent, type Digest, type ExternalSpec } from "./external.js";

export const miniSpec: ExternalSpec = {
  id: "mini-swe-agent",
  describe: "mini-swe-agent 2.4.6: a bash-only loop (the simple control baseline), yolo mode",
  tool: "mini-swe-agent",
  plan(i) {
    return {
      cmd: i.bin,
      args: ["-m", `openai/${i.model}`, "-t", i.request, "-y", "--exit-immediately", "-l", "0", "-o", path.join(i.home, "traj.json"), "-c", "mini.yaml", "-c", `model.model_kwargs.api_base=${i.baseUrl}`],
      env: {
        OPENAI_API_KEY: i.apiKey, MSWEA_CONFIGURED: "true", MSWEA_COST_TRACKING: "ignore_errors", MSWEA_SILENT_STARTUP: "1", MSWEA_GLOBAL_CONFIG_DIR: path.join(i.home, "mswea"),
        LITELLM_LOCAL_MODEL_COST_MAP: "True", LITELLM_LOG: "ERROR",
      },
      files: {},
      exclude: [],
      dirs: ["mswea"],
    };
  },
  digest({ home, stdout }): Digest {
    let traj: { info?: { model_stats?: { api_calls?: number }; exit_status?: string; submission?: string }; messages?: Array<Record<string, any>> } = {};
    try { traj = JSON.parse(fs.readFileSync(path.join(home, "traj.json"), "utf8")); } catch { /* the run died before it wrote one */ }
    const msgs = traj.messages ?? [];
    const assistant = msgs.filter((m) => m.role === "assistant");
    const toolCalls = assistant.reduce((n, m) => n + (Array.isArray(m.tool_calls) ? m.tool_calls.length : Array.isArray(m.extra?.actions) ? m.extra.actions.length : 0), 0);
    const toolErrors = msgs.filter((m) => /Tool call error|"returncode": [1-9]/.test(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).length;
    const exit = msgs.filter((m) => m.role === "exit").pop() as { extra?: { exit_status?: string; submission?: string } } | undefined;
    const status = traj.info?.exit_status ?? exit?.extra?.exit_status ?? "";
    const submission = traj.info?.submission ?? exit?.extra?.submission ?? "";
    const lastSaid = [...assistant].reverse().map((m) => (typeof m.content === "string" ? m.content : "")).find(Boolean) ?? "";
    const ok = status === "Submitted";
    return {
      steps: traj.info?.model_stats?.api_calls ?? assistant.length, toolCalls, toolErrors, answer: (submission || lastSaid || stdout.trim().split("\n").slice(-5).join("\n")).slice(0, 8000),
      ...(status ? { verdict: ok ? { status: "finished" as const, reason: "" } : { status: "failed" as const, reason: `mini-swe-agent ended with ${status}` } } : {}),
    };
  },
};

export const miniAgent = externalAgent(miniSpec);
