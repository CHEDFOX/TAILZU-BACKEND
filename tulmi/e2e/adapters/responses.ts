/**
 * THE RESPONSES API, SPOKEN ON TOP OF CHAT COMPLETIONS: SO AN AGENT THAT ONLY SPEAKS /v1/responses CAN BE RECORDED AND REPLAYED LIKE THE REST.
 *
 * Codex CLI dropped `wire_api = "chat"`: it speaks the Responses API and nothing else. Every cassette in this harness is a chat-completions recording
 * (adapters/cassette.ts), so the proxy (proxy.ts) accepts POST /v1/responses, turns it into the chat request it means, runs it through the same cassette
 * and the same spend guards, and turns the chat answer back into a Responses object (or the stream of events Codex reads).
 *
 *   request    instructions -> a system message; input items -> chat messages (message, function_call, function_call_output, and the freeform
 *              "custom" tool calls); function tools -> chat tools; a freeform (custom) tool -> a function with one string argument `input`;
 *              tools the chat API has no word for (web_search, local_shell, image_generation) are left out; reasoning items are dropped.
 *   response   a text answer -> a message item; a tool call -> a function_call item (or custom_tool_call for a freeform tool); usage is renamed.
 *   stream     response.created, then per item output_item.added, the deltas, output_item.done, and response.completed with the usage.
 *
 * Pure functions: no network, no clock besides the `created_at` they are given.
 */

type Obj = Record<string, any>;

const CUSTOM_ARG = "input";

/** The text of a Responses content value: a string, or an array of input_text / output_text / text parts. */
function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map((p: Obj) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : p?.type === "refusal" ? String(p.refusal ?? "") : "")).filter(Boolean).join("\n");
}

/** A chat content value from a Responses message: plain text when there are only text parts, else parts with images kept. */
function chatContent(c: unknown): string | Obj[] {
  if (!Array.isArray(c)) return textOf(c);
  const hasImage = c.some((p: Obj) => p?.type === "input_image");
  if (!hasImage) return textOf(c);
  return c.map((p: Obj) => (p?.type === "input_image"
    ? { type: "image_url", image_url: { url: String(p.image_url ?? p.url ?? "") } }
    : { type: "text", text: typeof p === "string" ? p : String(p?.text ?? "") }));
}

export interface ChatFromResponses {
  chat: Obj;
  /** Names of tools that were freeform (custom) in the request: their calls go back as custom_tool_call. */
  customTools: string[];
  stream: boolean;
}

/** The chat-completions request a Responses request means. */
export function responsesToChat(body: Obj): ChatFromResponses {
  const customTools: string[] = [];
  const tools: Obj[] = [];
  for (const t of Array.isArray(body.tools) ? body.tools : []) {
    if (t?.type === "function" && t.name) {
      tools.push({ type: "function", function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters ?? { type: "object", properties: {} } } });
    } else if (t?.type === "custom" && t.name) {
      customTools.push(String(t.name));
      tools.push({ type: "function", function: { name: t.name, description: String(t.description ?? ""), parameters: { type: "object", properties: { [CUSTOM_ARG]: { type: "string", description: "the whole input of the tool, as text" } }, required: [CUSTOM_ARG] } } });
    }
  }
  const messages: Obj[] = [];
  if (typeof body.instructions === "string" && body.instructions) messages.push({ role: "system", content: body.instructions });
  const items: Obj[] = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : Array.isArray(body.input) ? body.input : [];
  let pending: Obj | null = null;
  const flush = (): void => { if (pending) { messages.push(pending); pending = null; } };
  for (const it of items) {
    const type = it?.type ?? (it?.role ? "message" : "");
    if (type === "message") {
      flush();
      const role = it.role === "developer" ? "system" : it.role === "assistant" ? "assistant" : it.role === "system" ? "system" : "user";
      const content = role === "assistant" ? textOf(it.content) : chatContent(it.content);
      messages.push({ role, content });
    } else if (type === "function_call" || type === "custom_tool_call") {
      const args = type === "custom_tool_call" ? JSON.stringify({ [CUSTOM_ARG]: String(it.input ?? "") }) : String(it.arguments ?? "{}");
      if (type === "custom_tool_call" && it.name) customTools.push(String(it.name));
      // Consecutive calls are one assistant turn with several tool_calls.
      if (!pending) pending = { role: "assistant", content: null, tool_calls: [] };
      pending.tool_calls.push({ id: String(it.call_id ?? it.id ?? `call_${pending.tool_calls.length}`), type: "function", function: { name: String(it.name ?? ""), arguments: args } });
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      flush();
      messages.push({ role: "tool", tool_call_id: String(it.call_id ?? ""), content: typeof it.output === "string" ? it.output : textOf(it.output) || JSON.stringify(it.output ?? "") });
    }
    // reasoning items, item references, web_search_call and the like have no chat form: dropped.
  }
  flush();
  const chat: Obj = { model: String(body.model ?? ""), messages };
  if (tools.length) chat.tools = tools;
  const mt = body.max_output_tokens ?? body.max_tokens;
  if (typeof mt === "number") chat.max_tokens = mt;
  if (typeof body.temperature === "number") chat.temperature = body.temperature;
  if (body.tool_choice === "auto" || body.tool_choice === "none" || body.tool_choice === "required") chat.tool_choice = body.tool_choice;
  return { chat, customTools: [...new Set(customTools)], stream: body.stream === true };
}

export interface ResponsesObject extends Obj {
  id: string;
  object: "response";
  status: "completed";
  model: string;
  output: Obj[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details: { cached_tokens: number }; output_tokens_details: { reasoning_tokens: number } };
}

/** The Responses object for a chat-completions answer. */
export function chatToResponses(answer: Obj, customTools: readonly string[] = [], now = Math.floor(Date.now() / 1000)): ResponsesObject {
  const choice = (answer.choices ?? [])[0] ?? {};
  const msg = choice.message ?? {};
  const output: Obj[] = [];
  const text = typeof msg.content === "string" ? msg.content : textOf(msg.content);
  if (text) output.push({ id: `msg_${output.length}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] });
  (msg.tool_calls ?? []).forEach((t: Obj, i: number) => {
    const name = String(t.function?.name ?? "");
    const callId = String(t.id ?? `call_${i}`);
    const args = String(t.function?.arguments ?? "{}");
    if (customTools.includes(name)) {
      let input = "";
      try { const parsed = JSON.parse(args) as Obj; input = typeof parsed[CUSTOM_ARG] === "string" ? parsed[CUSTOM_ARG] : args; } catch { input = args; }
      output.push({ id: `ctc_${i}`, type: "custom_tool_call", status: "completed", call_id: callId, name, input });
    } else {
      output.push({ id: `fc_${i}`, type: "function_call", status: "completed", call_id: callId, name, arguments: args });
    }
  });
  const u = (answer.usage ?? {}) as Obj;
  const inTok = Number(u.prompt_tokens ?? 0) || 0;
  const outTok = Number(u.completion_tokens ?? 0) || 0;
  return {
    id: String(answer.id ?? "resp_cassette").replace(/^chatcmpl/, "resp"), object: "response", created_at: now, status: "completed", model: String(answer.model ?? ""), output,
    usage: {
      input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok,
      input_tokens_details: { cached_tokens: Number(u.prompt_tokens_details?.cached_tokens ?? 0) || 0 },
      output_tokens_details: { reasoning_tokens: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) || 0 },
    },
  };
}

/** The server-sent events a streaming Responses client expects for a whole answer. Each is [event name, data]. */
export function responseEvents(r: ResponsesObject): Array<[string, Obj]> {
  const ev: Array<[string, Obj]> = [];
  let seq = 0;
  const push = (type: string, data: Obj): void => { ev.push([type, { type, sequence_number: seq, ...data }]); seq += 1; };
  const shell = { ...r, status: "in_progress", output: [], usage: null };
  push("response.created", { response: shell });
  push("response.in_progress", { response: shell });
  r.output.forEach((item, index) => {
    if (item.type === "message") {
      const text = String(item.content?.[0]?.text ?? "");
      push("response.output_item.added", { output_index: index, item: { ...item, status: "in_progress", content: [] } });
      push("response.content_part.added", { item_id: item.id, output_index: index, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      if (text) push("response.output_text.delta", { item_id: item.id, output_index: index, content_index: 0, delta: text });
      push("response.output_text.done", { item_id: item.id, output_index: index, content_index: 0, text });
      push("response.content_part.done", { item_id: item.id, output_index: index, content_index: 0, part: item.content[0] });
      push("response.output_item.done", { output_index: index, item });
    } else if (item.type === "function_call") {
      push("response.output_item.added", { output_index: index, item: { ...item, status: "in_progress", arguments: "" } });
      push("response.function_call_arguments.delta", { item_id: item.id, output_index: index, delta: item.arguments });
      push("response.function_call_arguments.done", { item_id: item.id, output_index: index, arguments: item.arguments });
      push("response.output_item.done", { output_index: index, item });
    } else {
      push("response.output_item.added", { output_index: index, item: { ...item, status: "in_progress", input: "" } });
      push("response.custom_tool_call_input.delta", { item_id: item.id, output_index: index, delta: item.input });
      push("response.custom_tool_call_input.done", { item_id: item.id, output_index: index, input: item.input });
      push("response.output_item.done", { output_index: index, item });
    }
  });
  push("response.completed", { response: r });
  return ev;
}

/** The wire form of the events: `event: x\ndata: {...}\n\n`. */
export const sseOf = (events: ReadonlyArray<[string, Obj]>): string => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
