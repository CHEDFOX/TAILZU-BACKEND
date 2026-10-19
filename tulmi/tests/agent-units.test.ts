/**
 * Ask's planner, piece by piece: the grammar and the mode, the resolver, the
 * line protocol, the risk rules, the request reader and the event sink. No
 * server and no model; tests/agent-route.test.ts runs them together.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { aboutTheText, commandText, grammar, modeOf, spokenChord } = await import("../src/agent/grammar.js");
const { labelScore, resolve, resolverAsk } = await import("../src/agent/resolver.js");
const { LineReader, LineSplitter, normalizeChord, parseLine } = await import("../src/agent/lines.js");
const { riskOf, withRisk } = await import("../src/agent/risk.js");
const { EventSink, readStepRequest, withoutUrlSecrets } = await import("../src/agent/protocol.js");
const { AGENT_SYSTEM, agentUserMessage, elementLine } = await import("../src/agent/prompt.js");
const { modelLadder, plannerRequest } = await import("../src/agent/llm.js");
import type { AgentElement, AgentStepRequest } from "../../shared/types/api.js";

const NAMES = ["Tailzu", "Blip", "Zara"];

describe("commandText and the mode", () => {
  it("takes off fillers, a name it was called by, and politeness", () => {
    expect(commandText("Hey Tailzu, um, can you scroll down please?", NAMES)).toBe("scroll down");
    expect(commandText("Zara, go back.", NAMES)).toBe("go back");
    expect(commandText("okay so just undo that, thanks", NAMES)).toBe("undo that");
    expect(commandText("right click the file", NAMES)).toBe("right click the file");
  });

  it("shows for questions and pointing, does for commands", () => {
    for (const q of ["where's export?", "How do I turn on captions", "what does this error mean?", "show me the settings", "point at the send button", "find export", "Is there a dark mode?", "export kahan hai", "help me understand this chart"]) {
      expect(modeOf(q, NAMES), q).toBe("show");
    }
    for (const c of ["turn on captions", "open #design and tell them the mockups are ready", "Can you turn on captions?", "Hey Tailzu, could you export this?", "scroll down"]) {
      expect(modeOf(c, NAMES), c).toBe("do");
    }
  });
});

describe("the grammar", () => {
  it("open, launch and switch to name an app", () => {
    expect(grammar("open slack", "mac")).toEqual({ kind: "open", app: "Slack" });
    expect(grammar("launch visual studio code", "win")).toEqual({ kind: "open", app: "Visual Studio Code" });
    expect(grammar("switch to notion", "mac")).toEqual({ kind: "open", app: "Notion" });
  });

  it("but open of something on the screen is not an app", () => {
    const els: AgentElement[] = [{ id: "e1", role: "menu", label: "Export" }];
    expect(grammar("open export", "mac", els)).toBeNull();
    expect(grammar("open the settings", "mac")).toBeNull();
    expect(grammar("open #design", "mac")).toBeNull();
    expect(grammar("open a new tab", "mac")).toBeNull();
  });

  it("scrolls in four directions, and to the top or bottom", () => {
    expect(grammar("scroll down", "mac")).toEqual({ kind: "scroll", dir: "down" });
    expect(grammar("scroll up a bit", "win")).toEqual({ kind: "scroll", dir: "up" });
    expect(grammar("scroll left", "mac")).toEqual({ kind: "scroll", dir: "left" });
    expect(grammar("scroll to the bottom", "mac")).toEqual({ kind: "scroll", dir: "down" });
  });

  it("back, forward, undo and redo are each platform's chord", () => {
    expect(grammar("go back", "mac")?.keys).toBe("cmd+[");
    expect(grammar("go back", "win")?.keys).toBe("alt+left");
    expect(grammar("forward", "mac")?.keys).toBe("cmd+]");
    expect(grammar("undo", "mac")?.keys).toBe("cmd+z");
    expect(grammar("undo that", "win")?.keys).toBe("ctrl+z");
    expect(grammar("redo", "win")?.keys).toBe("ctrl+y");
  });

  it("press names keys and chords, with the platform's command key", () => {
    expect(grammar("press enter", "mac")?.keys).toBe("enter");
    expect(grammar("hit the escape key", "win")?.keys).toBe("escape");
    expect(grammar("press tab", "mac")?.keys).toBe("tab");
    expect(grammar("press command k", "mac")?.keys).toBe("cmd+k");
    expect(grammar("press command k", "win")?.keys).toBe("ctrl+k");
    expect(grammar("press control shift t", "mac")?.keys).toBe("ctrl+shift+t");
    expect(spokenChord("page down", "mac")).toBe("pagedown");
    expect(grammar("press save", "mac")).toBeNull();
  });

  it("is anchored at both ends", () => {
    expect(grammar("don't scroll down", "mac")).toBeNull();
    expect(grammar("scroll down to the comments and reply", "mac")).toBeNull();
    expect(grammar("go back to the inbox and archive it", "mac")).toBeNull();
  });

  it("knows when what they said is about the selected text", () => {
    for (const s of ["make this shorter", "rewrite it", "bullet points", "translate to hindi", "fix the grammar", "more formal"]) {
      expect(aboutTheText(s), s).toBe(true);
    }
    expect(aboutTheText("send it to sam")).toBe(false);
  });
});

describe("the label resolver", () => {
  const els: AgentElement[] = [
    { id: "e1", role: "button", label: "Search" },
    { id: "e2", role: "menu", label: "File" },
    { id: "e3", role: "button", label: "Export…" },
    { id: "e4", role: "text", label: "Export settings are below" },
    { id: "e5", role: "button", label: "Save" },
    { id: "e6", role: "button", label: "Save" },
    { id: "e7", role: "link", label: "Share" },
    { id: "e8", role: "heading", label: "Share" },
    { id: "e9", role: "tab", label: "Settings" },
  ];

  it("reads what they asked for and the kind of control they named", () => {
    expect(resolverAsk("where's export")).toEqual({ verb: "point", target: "export", roleHint: undefined });
    expect(resolverAsk("where is the export button")).toEqual({ verb: "point", target: "export", roleHint: "button" });
    expect(resolverAsk("show me where export is")).toMatchObject({ verb: "point", target: "export" });
    expect(resolverAsk("click on export")).toMatchObject({ verb: "press", target: "export" });
    expect(resolverAsk("turn on captions")).toBeNull();
  });

  it("accepts a clear match, a misspoken one included", () => {
    expect(resolve({ verb: "point", target: "export" }, els)?.element.id).toBe("e3");
    expect(resolve({ verb: "press", target: "setings" }, els)?.element.id).toBe("e9");
    expect(labelScore("search", "Search")).toBe(1);
  });

  it("rejects a tie, and a weak match", () => {
    expect(resolve({ verb: "press", target: "save" }, els)).toBeNull();
    expect(resolve({ verb: "point", target: "the settings for exporting" }, els)).toBeNull();
    expect(resolve({ verb: "point", target: "captions" }, els)).toBeNull();
  });

  it("a press never lands on text or a heading, and a role named breaks a tie", () => {
    expect(resolve({ verb: "press", target: "share" }, els)?.element.id).toBe("e7");
    expect(resolve({ verb: "point", target: "share" }, els)).toBeNull();
    expect(resolve({ verb: "point", target: "share", roleHint: "link" }, els)?.element.id).toBe("e7");
  });

  it("a disabled control is never pressed", () => {
    expect(resolve({ verb: "press", target: "search" }, [{ id: "e1", role: "button", label: "Search", disabled: true }])).toBeNull();
  });
});

describe("the line protocol", () => {
  it("holds a line split across chunks until it is whole", () => {
    const s = new LineSplitter();
    expect(s.push("SAY Hel")).toEqual([]);
    expect(s.push("lo there\nPOI")).toEqual(["SAY Hello there"]);
    expect(s.push("NT e1\r\nDO")).toEqual(["POINT e1"]);
    expect(s.flush()).toEqual(["DO"]);
    expect(s.flush()).toEqual([]);
  });

  it("parses each verb, and nothing that is not one", () => {
    expect(parseLine("SAY Hello.", "mac")).toEqual({ verb: "SAY", text: "Hello." });
    expect(parseLine("- **POINT** e12 | Export", "mac")).toEqual({ verb: "POINT", id: "e12", caption: "Export" });
    expect(parseLine("STEPS Open it ; Write ; Send", "mac")).toEqual({ verb: "STEPS", items: ["Open it", "Write", "Send"] });
    expect(parseLine("SET e5 | hello world", "mac")).toEqual({ verb: "SET", id: "e5", text: "hello world" });
    expect(parseLine('TYPE "design"', "mac")).toEqual({ verb: "TYPE", text: "design" });
    expect(parseLine("KEY Cmd + K", "win")).toEqual({ verb: "KEY", keys: "ctrl+k" });
    expect(parseLine("SCROLL down e4", "mac")).toEqual({ verb: "SCROLL", dir: "down", id: "e4" });
    expect(parseLine("OPEN Slack", "mac")).toEqual({ verb: "OPEN", app: "Slack" });
    expect(parseLine("DONE", "mac")).toEqual({ verb: "DONE" });
    expect(parseLine("PRESS Export", "mac")).toEqual({ verb: "PRESS", id: "" });
    expect(parseLine("Sure, here you go:", "mac")).toBeNull();
    expect(parseLine("Press the button, then type your name.", "mac")).toBeNull();
    expect(parseLine("```", "mac")).toBeNull();
    expect(parseLine("KEY not a chord at all", "mac")).toBeNull();
    expect(normalizeChord("option+shift+Return", "mac")).toBe("alt+shift+enter");
  });

  const read = (lines: string[], mode: "show" | "do", ids = ["e1", "e2"]) => {
    const r = new LineReader(new Set(ids), mode);
    return lines.flatMap((l) => r.read(parseLine(l, "mac")!));
  };

  it("keeps SAY then POINT in the order written, and honours only the first action", () => {
    expect(read(["SAY Here it is.", "POINT e1", "PRESS e1", "PRESS e2", "DONE"], "do")).toEqual([
      { emit: { t: "say", text: "Here it is." } },
      { emit: { t: "point", id: "e1" } },
      { act: { verb: "PRESS", id: "e1" } },
    ]);
  });

  it("drops a point at an unknown id, and refuses an action on one", () => {
    expect(read(["POINT e9", "PRESS e9", "PRESS e1"], "do")).toEqual([
      { emit: { t: "error", code: "bad_target", message: expect.any(String) } },
    ]);
    // A scroll's id only says where; an unknown one is dropped, not refused.
    expect(read(["SCROLL down e9"], "do")).toEqual([{ act: { verb: "SCROLL", dir: "down" } }]);
  });

  it("never acts in show mode", () => {
    expect(read(["SAY Look here.", "PRESS e2", "KEY enter", "TYPE hi", "DONE"], "show")).toEqual([
      { emit: { t: "say", text: "Look here." } },
      { emit: { t: "point", id: "e2" } },
      { emit: { t: "done" } },
    ]);
  });

  it("ends at ASK or DONE", () => {
    expect(read(["ASK Which one?", "PRESS e1"], "do")).toEqual([{ emit: { t: "ask", text: "Which one?" } }]);
  });
});

function scene(over: Partial<AgentStepRequest> = {}, said = "do it") {
  const req: AgentStepRequest = {
    runId: "run_abc123", step: 0, platform: "mac", app: "Slack",
    screen: {
      elements: [
        { id: "e1", role: "button", label: "Send" },
        { id: "e2", role: "button", label: "Delete message" },
        { id: "e3", role: "button", label: "Pay now" },
        { id: "e4", role: "button", label: "Bold" },
        { id: "e5", role: "area", label: "Message #design", value: "Ship it", focused: true },
        { id: "e6", role: "text", label: "Your code is 482913" },
        { id: "e7", role: "field", label: "Recovery", value: "abcd-efgh-ijkl-mnop" },
      ],
    },
    ...over,
  };
  return { req, said };
}

describe("risk", () => {
  it("send asks first; delete and pay ask every time; the rest is free", () => {
    expect(riskOf({ kind: "press", id: "e1" }, scene())).toBe("confirm");
    expect(riskOf({ kind: "press", id: "e2" }, scene())).toBe("always");
    expect(riskOf({ kind: "press", id: "e3" }, scene())).toBe("always");
    expect(riskOf({ kind: "press", id: "e4" }, scene())).toBe("free");
    expect(riskOf({ kind: "type", text: "please order more paper" }, scene())).toBe("always");
  });

  it("enter in a message box asks, with the message and where it goes", () => {
    expect(withRisk({ kind: "key", keys: "enter" }, scene())).toEqual({
      t: "action", kind: "key", keys: "enter", risk: "confirm", confirm: "Send to #design: “Ship it”",
    });
    expect(withRisk({ kind: "press", id: "e1" }, scene()).confirm).toBe("Send to #design: “Ship it”");
  });

  it("keys that send or destroy ask", () => {
    for (const keys of ["cmd+enter", "ctrl+enter", "cmd+w", "ctrl+w", "cmd+q", "alt+f4", "cmd+backspace"]) {
      expect(riskOf({ kind: "key", keys }, scene()), keys).toBe("confirm");
    }
    // Delete is a word on the always list, so a chord that says it asks every time.
    expect(riskOf({ kind: "key", keys: "cmd+delete" }, scene())).toBe("always");
    expect(riskOf({ kind: "key", keys: "shift+delete" }, scene())).toBe("always");
    expect(riskOf({ kind: "key", keys: "escape" }, scene())).toBe("free");
    expect(riskOf({ kind: "key", keys: "cmd+k" }, scene())).toBe("free");
  });

  it("a bare letter or typing outside a text field asks, because it would be a shortcut", () => {
    const onButton = scene({ screen: { elements: [{ id: "e1", role: "button", label: "Inbox", focused: true }] } });
    expect(riskOf({ kind: "key", keys: "e" }, onButton)).toBe("confirm");
    expect(riskOf({ kind: "key", keys: "#" }, onButton)).toBe("confirm");
    expect(riskOf({ kind: "type", text: "hello" }, onButton)).toBe("confirm");
    expect(riskOf({ kind: "key", keys: "e" }, scene())).toBe("free");
    expect(riskOf({ kind: "type", text: "hello" }, scene())).toBe("free");
  });

  it("a code or address from the screen they did not say asks; one they said does not", () => {
    expect(riskOf({ kind: "type", text: "the code is 482913" }, scene())).toBe("confirm");
    expect(riskOf({ kind: "type", text: "the code is 482913" }, scene({}, "type 482913"))).toBe("free");
    const mail = scene({ screen: { elements: [{ id: "e1", role: "area", focused: true }, { id: "e2", role: "text", label: "sam@corp.example" }] } });
    expect(riskOf({ kind: "set", id: "e1", text: "write to sam@corp.example" }, mail)).toBe("confirm");
    // Twelve characters lifted from another element's value.
    expect(riskOf({ kind: "type", text: "it is abcd-efgh-ijkl" }, scene())).toBe("confirm");
    // Rewriting their own selection carries nothing anywhere.
    expect(riskOf({ kind: "type", text: "the code is 482913" }, scene(), true)).toBe("free");
  });

  it("every press in a browser asks", () => {
    expect(riskOf({ kind: "press", id: "e4" }, scene({ app: "Google Chrome" }))).toBe("confirm");
    expect(riskOf({ kind: "press", id: "e4" }, scene({ app: "Arc" }))).toBe("confirm");
  });

  it("opening another app asks; the one they are in does not", () => {
    expect(riskOf({ kind: "open", app: "Notion" }, scene())).toBe("confirm");
    expect(riskOf({ kind: "open", app: "slack" }, scene())).toBe("free");
  });
});

describe("the request reader", () => {
  const caps = { maxElements: 250, screenMaxChars: 24_000 };
  const base = { runId: "run_abc123", step: 0, platform: "mac", app: "Slack", utterance: "hi", screen: { elements: [] } };

  it("keeps good elements, drops bad and repeated ones, and cuts long text short", () => {
    const r = readStepRequest({
      ...base,
      app: "A".repeat(90),
      screen: {
        elements: [
          { id: "e1", role: "Button", label: `  Save\n${"x".repeat(100)}`, region: "t", focused: true, checked: false },
          { id: "e1", role: "button", label: "dup" },
          { id: "x9", role: "button" },
          { id: "e2" },
          { id: "e3", role: "link", region: "middle", value: "v".repeat(200) },
        ],
      },
    }, caps);
    expect("req" in r).toBe(true);
    const req = (r as { req: AgentStepRequest }).req;
    expect(req.app).toHaveLength(60);
    expect(req.screen.elements.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(req.screen.elements[0]).toMatchObject({ role: "button", region: "t", focused: true, checked: false });
    expect(req.screen.elements[0]!.label).toHaveLength(80);
    expect(req.screen.elements[1]!.region).toBeUndefined();
    expect(req.screen.elements[1]!.value).toHaveLength(120);
  });

  it("a later step may carry no words of its own", () => {
    expect("refusal" in readStepRequest({ ...base, utterance: undefined }, caps)).toBe(true);
    expect("req" in readStepRequest({ ...base, utterance: undefined }, caps, true)).toBe(true);
    expect("req" in readStepRequest({ ...base, utterance: undefined, step: 1, history: [{ said: "scroll down" }] }, caps)).toBe(true);
  });

  it("takes query strings and fragments off URLs", () => {
    expect(withoutUrlSecrets("go to https://a.example/x?token=1#y now")).toBe("go to https://a.example/x now");
    expect(withoutUrlSecrets("a.example.co/reset?code=9")).toBe("a.example.co/reset");
    expect(withoutUrlSecrets("no url here? fine")).toBe("no url here? fine");
  });
});

describe("the event sink", () => {
  it("sends one line per event and nothing after the first terminal one", () => {
    const lines: string[] = [];
    const sink = new EventSink((l) => lines.push(l));
    sink.emit({ t: "heard", text: "hi", mode: "do" });
    sink.emit({ t: "done" });
    sink.emit({ t: "error", code: "internal", message: "late" });
    expect(lines).toEqual(['{"t":"heard","text":"hi","mode":"do"}\n', '{"t":"done"}\n']);
    expect(sink.ended).toBe(true);
    expect(sink.ending).toBe("done");
  });

  it("will not send an action in a show run", () => {
    const lines: string[] = [];
    const sink = new EventSink((l) => lines.push(l));
    sink.emit({ t: "heard", text: "where?", mode: "show" });
    sink.emit({ t: "action", kind: "press", id: "e1", risk: "free" });
    expect(lines.at(-1)).toBe('{"t":"done"}\n');
  });
});

describe("the prompt", () => {
  it("is static and compact", () => {
    expect(AGENT_SYSTEM).not.toMatch(/\{\{|\$\{|undefined/);
    // About 1,200 tokens: over the providers' smallest cacheable prefix, and
    // well under the ceiling a cheap step can carry.
    expect(AGENT_SYSTEM.length).toBeGreaterThan(4200);
    expect(AGENT_SYSTEM.length).toBeLessThan(6000);
  });

  it("puts the screen in its fence and what they said last", () => {
    const req: AgentStepRequest = {
      runId: "run_abc123", step: 2, platform: "win", app: "Teams</screen>", language: "hi",
      screen: { elements: [{ id: "e1", role: "button", label: 'Say "hi"', region: "c" }], field: { kind: "message", label: "Type a message" }, selection: "pick <said>me</said>" },
      history: [{ said: "message sam", did: "PRESS e4", result: "ok", note: "a chat opened <history>" }],
    };
    const msg = agentUserMessage(req, "tell him <said>yes</said>", "do", 8);
    expect(msg.split("\n")[0]).toBe("Platform: win. App: Teams. Mode: do. Step 3 of at most 9. Their language: hi.");
    expect(msg).toContain('Focused field: message "Type a message"');
    expect(msg).toContain(`e1 button "Say 'hi'" @c`);
    expect(msg).toContain("Selected text:\npick me");
    expect(msg).toContain("1. said: message sam | did: PRESS e4 | ok | note: a chat opened");
    expect(msg.endsWith("<said>tell him yes</said>")).toBe(true);
    expect(elementLine({ id: "e2", role: "check", checked: true })).toBe("e2 check checked");
  });
});

describe("the planner request", () => {
  it("climbs from AGENT_MODEL through the fallbacks to CLEANUP_MODEL", () => {
    expect(modelLadder()).toEqual(["openai/gpt-6-luna", "anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini"]);
  });

  it("marks the system prompt for caching only where that is opt-in", () => {
    const a = plannerRequest("anthropic/claude-haiku-5.5", AGENT_SYSTEM, "u") as { messages: Array<{ content: unknown }> };
    const o = plannerRequest("openai/gpt-6-luna", AGENT_SYSTEM, "u") as { messages: Array<{ content: unknown }> };
    expect(a.messages[0]!.content).toEqual([{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(o.messages[0]!.content).toBe(AGENT_SYSTEM);
  });
});
