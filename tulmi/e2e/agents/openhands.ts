/**
 * OpenHands (MIT, pip openhands 1.16.0) AS A CONTESTANT, HEADLESS AND WITHOUT DOCKER: `openhands --headless --override-with-envs --json -t <task>`.
 *
 * Verified here: the CLI runs the agent in-process on the current directory (a local workspace), so it needs no Docker daemon (`requiresDocker` is false). The
 * model comes from LLM_MODEL / LLM_API_KEY / LLM_BASE_URL (--override-with-envs), the base URL being our proxy. Its conversation store is in the throwaway home.
 * See versions.json for the licence note: two of its Python dependencies are copyleft (bashlex GPL-3.0+, func_timeout LGPL-2); it is run as a separate program only.
 */
import { externalAgent, type Digest, type ExternalSpec } from "./external.js";

export const OPENHANDS_REQUIRES_DOCKER = false;

export const openhandsSpec: ExternalSpec = {
  id: "openhands",
  describe: "OpenHands 1.16.0: headless CLI on a local workspace (no Docker), OpenAI-compatible base URL on the proxy",
  tool: "openhands",
  plan(i) {
    return {
      cmd: i.bin,
      args: ["--headless", "--override-with-envs", "--json", "-t", i.request],
      env: { LLM_MODEL: `openai/${i.model}`, LLM_API_KEY: i.apiKey, LLM_BASE_URL: i.baseUrl, OPENHANDS_SUPPRESS_BANNER: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True", LITELLM_LOG: "ERROR", OPENHANDS_TELEMETRY: "false", TTY_INTERACTIVE: "0" },
      files: {},
      exclude: [".openhands/", ".agents/"],
    };
  },
  digest({ stdout, stderr }): Digest {
    let steps = 0, tools = 0, failed = 0;
    let said = "";
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const m = e.llm_message;
      if (e.source === "agent" && m) {
        steps += 1;
        if (Array.isArray(m.tool_calls)) tools += m.tool_calls.length;
        const text = Array.isArray(m.content) ? m.content.map((c: { text?: string }) => c.text ?? "").join("\n") : "";
        if (text) said = text;
      }
      if (e.kind === "AgentErrorEvent" || e.error) failed += 1;
    }
    const finished = /Agent finished/.test(stdout);
    const err = /(AuthenticationError|BadRequestError|APIConnectionError|RateLimitError|Traceback)[^\n]*/.exec(`${stdout}\n${stderr}`)?.[0] ?? "";
    return { steps, toolCalls: tools, toolErrors: failed, answer: said.slice(0, 8000), ...(!finished && err ? { verdict: { status: "failed" as const, reason: err.slice(0, 200) } } : {}) };
  },
};

export const openhandsAgent = externalAgent(openhandsSpec);
