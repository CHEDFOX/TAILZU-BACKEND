/**
 * The open-source contestants (e2e/agents): how each one's command is built, what environment it is started with, how its output is read, how the proxy counts its
 * calls and speaks the Responses API for Codex, what versions.json pins, and that no adapter can read a real key. No tool is started and no model is called: the
 * wiring itself (each tool really run against the proxy with a scripted model) is `npm run e2e:agents -- --prove`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatToResponses, responseEvents, responsesToChat, sseOf } from "../e2e/adapters/responses.js";
import { aiderSpec } from "../e2e/agents/aider.js";
import { codexSpec } from "../e2e/agents/codex.js";
import { optionsFromEnv, scrubbedEnv, splitProxyUrl, labelFor, type PlanInput } from "../e2e/agents/external.js";
import { fakeAgentModel, patchCommand, wholeFileReply } from "../e2e/agents/fake.js";
import { AGENTS, CONTESTANTS } from "../e2e/agents/index.js";
import { miniSpec } from "../e2e/agents/miniswe.js";
import { opencodeSpec } from "../e2e/agents/opencode.js";
import { openhandsSpec } from "../e2e/agents/openhands.js";
import { AGENTS_DIR, versions } from "../e2e/agents/tools.js";
import { startProxy } from "../e2e/proxy.js";
import { loadTasks } from "../e2e/tasks/schema.js";
import type { ChatClient } from "../src/code/brain/gateway.js";

const plan = (over: Partial<PlanInput> = {}): PlanInput => ({
  taskId: "t1", request: "fix the pagination", bin: "/tools/bin/x", model: "qwen/qwen3.7-flash", baseUrl: "http://127.0.0.1:8787/run/r1/v1", apiKey: ["tok", "abc"].join("_"),
  home: "/work/home", checkout: "/work/checkout", timeoutSec: 300, options: {}, ...over,
});

describe("each agent's command", () => {
  it("aider: yes-always, no commits, no network extras, the model through the proxy's base URL, its own files out of the checkout", () => {
    const p = aiderSpec.plan(plan());
    expect(p.cmd).toBe("/tools/bin/x");
    expect(p.args).toEqual(expect.arrayContaining(["--yes-always", "--no-auto-commits", "--no-check-update", "--analytics-disable", "--no-show-model-warnings"]));
    expect(p.args[p.args.indexOf("--model") + 1]).toBe("openai/qwen/qwen3.7-flash");
    expect(p.args[p.args.indexOf("--message") + 1]).toBe("fix the pagination");
    expect(p.args[p.args.indexOf("--edit-format") + 1]).toBe("diff");
    expect(p.args[p.args.indexOf("--chat-history-file") + 1]).toBe("/work/home/aider.chat.history.md");
    expect(p.env.OPENAI_API_BASE).toBe("http://127.0.0.1:8787/run/r1/v1");
    expect(p.env.OPENAI_API_KEY).toBe("tok_abc");
    expect(p.exclude).toContain(".aider*");
    expect(Object.keys(p.files).some((f) => f.endsWith("model_prices_and_context_window.json"))).toBe(true);
    expect(JSON.parse(p.files["/work/home/model-metadata.json"]!)["openai/qwen/qwen3.7-flash"].max_input_tokens).toBeGreaterThan(0);
  });

  it("aider: the edit format is an option, and a format it does not have is refused", () => {
    expect(aiderSpec.plan(plan({ options: { edit_format: "whole" } })).args).toContain("whole");
    expect(() => aiderSpec.plan(plan({ options: { edit_format: "nonsense" } }))).toThrow(/edit format/);
  });

  it("mini-swe-agent: yolo, no cost limit (the proxy's cap stops it), exits at once when it submits, the base URL as a config override", () => {
    const p = miniSpec.plan(plan());
    expect(p.args).toEqual(expect.arrayContaining(["-y", "--exit-immediately"]));
    expect(p.args[p.args.indexOf("-l") + 1]).toBe("0");
    expect(p.args[p.args.indexOf("-m") + 1]).toBe("openai/qwen/qwen3.7-flash");
    expect(p.args).toContain("model.model_kwargs.api_base=http://127.0.0.1:8787/run/r1/v1");
    expect(p.env.MSWEA_COST_TRACKING).toBe("ignore_errors");
    expect(p.env.MSWEA_CONFIGURED).toBe("true");
  });

  it("opencode: run mode with no plugins, one config that names the proxy as an openai-compatible provider, the title call off, web fetches denied", () => {
    const p = opencodeSpec.plan(plan());
    expect(p.args.slice(0, 2)).toEqual(["run", "--pure"]);
    expect(p.args).toContain("e2e/qwen/qwen3.7-flash");
    const cfg = JSON.parse(p.files["/work/home/opencode.json"]!);
    expect(cfg.provider.e2e.npm).toBe("@ai-sdk/openai-compatible");
    expect(cfg.provider.e2e.options.baseURL).toBe("http://127.0.0.1:8787/run/r1/v1");
    expect(cfg.agent.title.disable).toBe(true);
    expect(cfg.permission.webfetch).toBe("deny");
    expect(cfg.autoupdate).toBe(false);
    expect(p.env.OPENCODE_CONFIG).toBe("/work/home/opencode.json");
    expect(p.env.XDG_DATA_HOME?.startsWith("/work/home")).toBe(true);
  });

  it("codex: exec mode with JSON events in the checkout under its own workspace-write sandbox, a Responses provider on the proxy, telemetry off", () => {
    const p = codexSpec.plan(plan());
    expect(p.args.slice(0, 3)).toEqual(["exec", "--json", "--skip-git-repo-check"]);
    expect(p.args[p.args.indexOf("-C") + 1]).toBe("/work/checkout");
    expect(p.args[p.args.indexOf("-s") + 1]).toBe("workspace-write");
    const toml = p.files["/work/home/config.toml"]!;
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('base_url = "http://127.0.0.1:8787/run/r1/v1"');
    expect(toml).toContain('approval_policy = "never"');
    expect(toml).toMatch(/\[analytics\]\nenabled = false/);
    expect(p.env.CODEX_HOME).toBe("/work/home");
    expect(p.env.E2E_API_KEY).toBe("tok_abc");
  });

  it("openhands: headless, models from the LLM_ variables, the base URL the proxy's, no Docker", () => {
    const p = openhandsSpec.plan(plan());
    expect(p.args).toEqual(["--headless", "--override-with-envs", "--json", "-t", "fix the pagination"]);
    expect(p.env.LLM_MODEL).toBe("openai/qwen/qwen3.7-flash");
    expect(p.env.LLM_BASE_URL).toBe("http://127.0.0.1:8787/run/r1/v1");
  });

  it("every contestant is registered, and the grid knows them in order", () => {
    for (const id of CONTESTANTS) expect(AGENTS[id], id).toBeDefined();
    expect(CONTESTANTS[0]).toBe("tailzu");
    for (const id of CONTESTANTS.filter((c) => c !== "tailzu")) { expect(AGENTS[id]!.usesCheckout).toBe(true); expect(AGENTS[id]!.modes).toEqual(["real"]); }
  });
});

describe("reading what an agent printed", () => {
  it("aider: counts the model calls and applied edits, takes its words from between the header and the token count, and calls an API error a failure", () => {
    const out = "Aider v0.86.2\nModel: openai/m with diff edit format\nRepo-map: using 1024 tokens\nI changed the page start.\nApplied edit to src/pagination.js\nTokens: 3.4k sent, 800 received.\n";
    const d = aiderSpec.digest({ stdout: out, stderr: "", home: "", checkout: "" });
    expect(d.steps).toBe(1);
    expect(d.toolCalls).toBe(1);
    expect(d.answer).toContain("I changed the page start.");
    expect(d.verdict).toBeUndefined();
    const bad = aiderSpec.digest({ stdout: "Repo-map: x\nlitellm.AuthenticationError: bad key\n", stderr: "", home: "", checkout: "" });
    expect(bad.verdict?.status).toBe("failed");
  });

  it("codex: reads the JSON events: commands run, failed ones, the last message", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"x"}', '{"type":"item.completed","item":{"type":"command_execution","command":"ls","exit_code":0}}',
      '{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":1}}', '{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
    ].join("\n");
    const d = codexSpec.digest({ stdout, stderr: "", home: "/nonexistent", checkout: "" });
    expect(d).toMatchObject({ toolCalls: 2, toolErrors: 1, answer: "Done.", steps: 1 });
  });

  it("opencode: counts steps and tool uses from its JSON lines and takes the last text", () => {
    const stdout = ['{"type":"step_start"}', '{"type":"tool_use","part":{"state":{"status":"completed"}}}', '{"type":"step_finish"}', '{"type":"text","part":{"text":"All done"}}', '{"type":"step_finish"}'].join("\n");
    expect(opencodeSpec.digest({ stdout, stderr: "", home: "", checkout: "" })).toMatchObject({ steps: 2, toolCalls: 1, answer: "All done" });
  });

  it("openhands: counts the agent's own events and their tool calls, and reads the finish", () => {
    const stdout = ['{"source":"user","llm_message":{"role":"user","content":[{"text":"task"}]}}', '{"source":"agent","llm_message":{"role":"assistant","content":[{"text":"on it"}],"tool_calls":[{"id":"1"}]}}', '{"source":"agent","kind":"AgentErrorEvent","error":"x"}', "Agent finished"].join("\n");
    expect(openhandsSpec.digest({ stdout, stderr: "", home: "", checkout: "" })).toMatchObject({ steps: 1, toolCalls: 1, toolErrors: 1, answer: "on it" });
  });

  it("mini-swe-agent: no trajectory means the run died; one that ends Submitted is finished", () => {
    expect(miniSpec.digest({ stdout: "boom", stderr: "", home: "/nonexistent", checkout: "" }).verdict).toBeUndefined();
  });
});

describe("the environment an agent is started with", () => {
  const parent = {
    PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", HOME: "/root", OPENROUTER_API_KEY: "real-key-do-not-leak", GITHUB_TOKEN: "ghp_x", GROQ_API_KEY: "g", HTTPS_PROXY: "http://proxy:1", SSL_CERT_FILE: "/ca.pem",
    ANTHROPIC_API_KEY: "a", AWS_SECRET_ACCESS_KEY: "s", SUPABASE_URL: "u", NODE_EXTRA_CA_CERTS: "/ca.pem", OPENAI_API_KEY: "o",
  } as NodeJS.ProcessEnv;
  const env = scrubbedEnv({ parent, home: "/work/home", tmp: "/work/tmp", pathDirs: ["/tools/bin"], projectEnv: { FLASK_ENV: "x", STRIPE_API_KEY: "nope", HTTP_PROXY: "p" }, extra: { OPENAI_API_KEY: "tok_fake", OPENAI_API_BASE: "http://127.0.0.1:8787/v1" } });

  it("carries no key, token, proxy or certificate setting of the parent: only the fake one the plan adds", () => {
    expect(Object.values(env)).not.toContain("real-key-do-not-leak");
    for (const k of ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GROQ_API_KEY", "HTTPS_PROXY", "SSL_CERT_FILE", "ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY", "SUPABASE_URL", "NODE_EXTRA_CA_CERTS"]) expect(env[k], k).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe("tok_fake");
    expect(env.STRIPE_API_KEY).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.FLASK_ENV).toBe("x");
  });

  it("has the tool's folder first on the PATH, a throwaway home and tmp, and CI mode", () => {
    expect(env.PATH!.split(":")[0]).toBe("/tools/bin");
    expect(env.HOME).toBe("/work/home");
    expect(env.TMPDIR).toBe("/work/tmp");
    expect(env.CI).toBe("1");
    expect(env.LANG).toBe("en_US.UTF-8");
  });

  it("no adapter source reads OPENROUTER_API_KEY or the real-key helper: the key is the proxy's alone", () => {
    for (const f of fs.readdirSync(AGENTS_DIR).filter((x) => x.endsWith(".ts") && x !== "tailzu.ts")) {
      const src = fs.readFileSync(path.join(AGENTS_DIR, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/process\.env\.OPENROUTER|realKey|OPENROUTER_API_KEY/);
    }
  });

  it("parses the proxy's labelled URL, builds safe labels, and reads an agent's options from E2E_<AGENT>_<OPTION>", () => {
    expect(splitProxyUrl("http://127.0.0.1:9/run/a__b/v1")).toEqual({ root: "http://127.0.0.1:9", label: "a__b" });
    expect(splitProxyUrl("http://127.0.0.1:9/v1")).toEqual({ root: "http://127.0.0.1:9", label: null });
    expect(labelFor(["qwen/qwen3.7-flash", "aider", "t 1"])).toBe("qwen_qwen3.7-flash__aider__t_1");
    expect(optionsFromEnv("mini-swe-agent", { E2E_MINI_SWE_AGENT_EDIT_FORMAT: "x", E2E_AIDER_EDIT_FORMAT: "whole", E2E_AIDER_API_KEY: "secret" })).toEqual({ edit_format: "x" });
    expect(optionsFromEnv("aider", { E2E_AIDER_EDIT_FORMAT: "whole", E2E_AIDER_API_KEY: "secret" })).toEqual({ edit_format: "whole" });
  });
});

describe("versions.json", () => {
  const v = versions();
  it("pins every tool to an exact version, with a licence that is not copyleft, and says which have lock files with hashes", () => {
    for (const [name, t] of Object.entries(v.tools)) {
      expect(t.version, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(t.licence, name).toMatch(/^(MIT|Apache-2\.0|ISC)$/);
      expect(t.licenceNote.length, name).toBeGreaterThan(20);
      expect(t.installCmd, name).not.toMatch(/latest/);
      if (!t.lock) continue;
      const lock = fs.readFileSync(path.join(AGENTS_DIR, t.lock), "utf8");
      if (t.kind === "pip") { expect(lock, name).toContain("--hash=sha256:"); expect(lock, name).toContain(`${t.package}==${t.version}`); expect(lock, name).toContain("--exclude-newer"); }
      else { expect(lock, name).toContain("sha512-"); expect(lock, name).toContain(t.version); }
    }
  });
  it("keeps the e2e-only extraction libraries in devDependencies at exact versions", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "..", "..", "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const [name, spec] of Object.entries(v.nodeDevDependencies).filter(([k]) => k !== "note") as Array<[string, { version: string }]>) {
      expect(pkg.devDependencies[name], name).toBe(spec.version);
      expect(pkg.dependencies[name], name).toBeUndefined();
    }
  });
  it("never vendors a copyleft tool: the one with copyleft dependencies says so and is run as a separate program", () => {
    expect(v.tools.openhands!.licenceNote).toMatch(/bashlex.*GPL/);
    expect(v.tools.openhands!.licenceNote).toMatch(/separate program/);
  });
});

describe("the scripted model that proves the wiring", () => {
  const task = loadTasks().find((t) => t.id === "smoke-api-bug-pagination")!;
  it("writes the oracle's files with here-documents and removes the ones the patch deletes", () => {
    const cmd = patchCommand({ "src/a.js": "x\ny", "b.txt": null });
    expect(cmd).toContain("mkdir -p 'src' && cat > 'src/a.js' <<'TAILZU_FAKE_EOF'\nx\ny\nTAILZU_FAKE_EOF");
    expect(cmd).toContain("rm -f 'b.txt'");
  });
  it("answers aider with whole files, and a shell agent with one command and then its finish", async () => {
    expect(wholeFileReply({ "src/a.js": "x" }, "Here.")).toContain("src/a.js\n```\nx\n```");
    const model = fakeAgentModel(task);
    const first = (await model.chat.completions.create({ model: "m", messages: [{ role: "user", content: "go" }], tools: [{ function: { name: "exec_command" } }] })) as { choices: Array<{ message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> };
    expect(first.choices[0]!.message.tool_calls![0]!.function.name).toBe("exec_command");
    expect(JSON.parse(first.choices[0]!.message.tool_calls![0]!.function.arguments).cmd).toContain("src/pagination.js");
    const second = (await model.chat.completions.create({ model: "m", messages: [{ role: "user", content: "go" }, { role: "assistant", content: null }, { role: "tool", content: "ok" }], tools: [{ function: { name: "exec_command" } }] })) as { choices: Array<{ message: { content: string; tool_calls?: unknown } }> };
    expect(second.choices[0]!.message.tool_calls).toBeUndefined();
    const aider = (await model.chat.completions.create({ model: "m", messages: [{ role: "system", content: "Act as an expert software developer." }, { role: "user", content: "fix" }] })) as { choices: Array<{ message: { content: string } }> };
    expect(aider.choices[0]!.message.content).toContain("src/pagination.js\n```");
  });
});

describe("the Responses API on top of chat completions (Codex speaks nothing else)", () => {
  const request = {
    model: "qwen/qwen3.7-flash", instructions: "You are a coding agent.", stream: true,
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "env" }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] },
      { type: "reasoning", summary: [] }, { type: "function_call", call_id: "c1", name: "exec_command", arguments: '{"cmd":"ls"}' },
      { type: "function_call_output", call_id: "c1", output: "a.js" }, { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin Patch" }, { type: "custom_tool_call_output", call_id: "c2", output: "ok" },
    ],
    tools: [{ type: "function", name: "exec_command", description: "run", parameters: { type: "object", properties: { cmd: { type: "string" } } } }, { type: "custom", name: "apply_patch", description: "patch", format: {} }, { type: "web_search" }],
  };

  it("turns a request into the chat request it means: instructions first, calls grouped, results as tool messages, freeform tools as one-string functions, the rest dropped", () => {
    const { chat, customTools, stream } = responsesToChat(request);
    expect(stream).toBe(true);
    expect(customTools).toEqual(["apply_patch"]);
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(["system", "system", "user", "assistant", "tool", "assistant", "tool"]);
    expect(chat.messages[3].tool_calls[0]).toMatchObject({ id: "c1", function: { name: "exec_command", arguments: '{"cmd":"ls"}' } });
    expect(JSON.parse(chat.messages[5].tool_calls[0].function.arguments)).toEqual({ input: "*** Begin Patch" });
    expect(chat.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["exec_command", "apply_patch"]);
    expect(chat.tools[1].function.parameters.required).toEqual(["input"]);
  });

  it("turns a chat answer into a response: text as a message, a call as function_call, a freeform call as custom_tool_call, usage renamed", () => {
    const r = chatToResponses({ id: "chatcmpl-1", model: "m", choices: [{ message: { content: "ok", tool_calls: [{ id: "k1", function: { name: "exec_command", arguments: '{"cmd":"x"}' } }, { id: "k2", function: { name: "apply_patch", arguments: '{"input":"patch text"}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 7 } }, ["apply_patch"], 1);
    expect(r.output.map((o) => o.type)).toEqual(["message", "function_call", "custom_tool_call"]);
    expect(r.output[2]).toMatchObject({ name: "apply_patch", input: "patch text", call_id: "k2" });
    expect(r.usage).toMatchObject({ input_tokens: 100, output_tokens: 7, total_tokens: 107 });
    expect(r.id).toBe("resp-1");
  });

  it("streams created, then each item added / delta / done, then completed with the usage last", () => {
    const r = chatToResponses({ id: "c", model: "m", choices: [{ message: { content: "hi", tool_calls: [{ id: "k1", function: { name: "f", arguments: "{}" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const names = responseEvents(r).map(([n]) => n);
    expect(names[0]).toBe("response.created");
    expect(names[names.length - 1]).toBe("response.completed");
    expect(names).toEqual(expect.arrayContaining(["response.output_item.added", "response.output_text.delta", "response.function_call_arguments.done", "response.output_item.done"]));
    expect(sseOf(responseEvents(r))).toMatch(/^event: response\.created\ndata: \{/);
    expect(JSON.parse(sseOf(responseEvents(r)).trim().split("\n\n").pop()!.split("data: ")[1]!).response.usage.total_tokens).toBe(2);
  });
});

describe("the proxy, as the contestants use it", () => {
  const answer = (text: string, cost = 0.01): unknown => ({ id: "x", model: "m/one", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost } });
  const upstream = (): ChatClient & { calls: number } => { const u = { calls: 0 } as ChatClient & { calls: number }; (u as { chat: ChatClient["chat"] }).chat = { completions: { async create(b: Record<string, unknown>) { u.calls += 1; return answer(`n${u.calls} ${String((b.messages as Array<{ content: string }>).slice(-1)[0]!.content).slice(0, 10)}`); } } }; return u; };
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "proxy-agents-"));

  it("counts tokens, dollars and models per run at /run/<id>/stats, and answers a Responses request from the same cassette a chat request filled", async () => {
    const up = upstream();
    const p = await startProxy({ port: 0, mode: "mixed", cassette: "agents-a", cassetteDir: dir, capUsd: 1, upstream: up });
    try {
      const root = p.url.replace(/\/v1$/, "");
      const post = (u: string, b: unknown) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, text: await r.text() }));
      await post(`${root}/run/r1/v1/chat/completions`, { model: "m/one", messages: [{ role: "user", content: "hello" }] });
      // The same words as a Responses request: same cassette key, so no second upstream call.
      const viaResponses = await post(`${root}/run/r1/v1/responses`, { model: "m/one", input: "hello", stream: false });
      expect(viaResponses.status).toBe(200);
      expect(JSON.parse(viaResponses.text).output[0].content[0].text).toMatch(/^n1 /);
      expect(up.calls).toBe(1);
      const stats = (await (await fetch(`${root}/run/r1/stats`)).json()) as { calls: number; promptTokens: number; completionTokens: number; costUsd: number; models: Record<string, number> };
      expect(stats).toMatchObject({ calls: 2, promptTokens: 20, completionTokens: 10, models: { "m/one": 2 } });
      expect(stats.costUsd).toBeCloseTo(0.02, 5);
      const stream = await post(`${root}/run/r1/v1/responses`, { model: "m/one", input: "hello", stream: true });
      expect(stream.text).toContain("event: response.completed");
    } finally { await p.close(); }
  });

  it("refuses a run's calls with a 402 once its own cap is reached, while another run goes on", async () => {
    const p = await startProxy({ port: 0, mode: "record", cassette: "agents-b", cassetteDir: dir, capUsd: 10, upstream: upstream() });
    try {
      const root = p.url.replace(/\/v1$/, "");
      const post = (run: string, text: string) => fetch(`${root}/run/${run}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m/one", messages: [{ role: "user", content: text }] }) });
      expect((await fetch(`${root}/run/capped/cap`, { method: "POST", body: JSON.stringify({ capUsd: 0.015 }) })).status).toBe(200);
      expect((await post("capped", "a")).status).toBe(200);
      expect((await post("capped", "b")).status).toBe(200);
      const over = await post("capped", "c");
      expect(over.status).toBe(402);
      expect(((await over.json()) as { error: { code: string } }).error.code).toBe("budget_exceeded");
      expect((await post("free", "d")).status).toBe(200);
      expect(p.usage("capped").refused).toBe(1);
    } finally { await p.close(); }
  });
});
