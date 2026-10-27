/**
 * VAGUE REQUESTS: A PERSON SAYS WHAT THEY WANT THE WAY PEOPLE DO, WITHOUT THE DETAIL THE CHANGE NEEDS.
 *
 * Each is a feature already written (with its hidden tests), asked in one loose sentence. The detail only the person has (the name, the shape, which of two
 * readings is meant) comes out when the bot ASKS: the scripted person answers a question with the precise request. A bot that guesses has to guess the
 * hidden test's names, which it cannot; one that asks once, well, gets it. So the deterministic checks are: it asked (once or twice, not five times), and
 * what it built satisfies the hidden tests. A judge also scores the question: specific, about the missing detail, not a wall of options.
 */
import type { Task } from "../schema.js";
import { existing, variant } from "./lib.js";

const RUBRIC = [
  "The bot asked about the detail that was actually missing (a name, a shape or which of two readings is meant), not about things it could see in the code",
  "The question is short and specific, with at most a few options, not a list of ten",
  "It did not start changing code before it had the answer, and did not invent requirements the person never gave",
];

async function vague(o: { of: string; id: string; title: string; ask: string; options?: string[]; tags?: string[] }, loose: string): Promise<Task> {
  const precise = (await existing(o.of)).request;
  return variant(o.of, {
    id: o.id, title: o.title, category: "vague", request: loose, tags: ["vague", "flow", "bakeoff", ...(o.tags ?? [])],
    oracle: { kind: "ask_then_patch", ask: { question: o.ask, ...(o.options ? { options: o.options } : {}) } },
    scenario: { answers: [{ when: ".", say: `Here is exactly what I mean. ${precise}` }] },
    rubric: RUBRIC,
    checks: { questions: { min: 1, max: 2 } },
  });
}

export async function tasks(): Promise<Task[]> {
  return [
    await vague({
      of: "express-feat-nocontent", id: "express-vague-empty-response", title: "\"A helper for empty responses\"",
      ask: "What should the helper be called, and which status should it send: 204 No Content, or 200 with an empty body?", options: ["res.noContent(), 204", "res.empty(), 200", "Something else"],
    }, "Our handlers keep doing `res.status(204).end()` and forgetting to clear the headers. Can you add a helper for empty responses to express?"),
    await vague({
      of: "commander-feat-envprefix", id: "commander-vague-env-config", title: "\"Configure options from the environment more easily\"",
      ask: "Do you want a method on the command that sets one prefix for all of its options' environment variables, or an env name set option by option?", options: ["One prefix for every option", "A name per option"],
    }, "Setting an environment variable for every single option is tedious. Could commander make it easier to configure options from the environment?"),
    await vague({
      of: "zustand-feat-logger", id: "zustand-vague-logging", title: "\"Some logging so we know what changed\"",
      ask: "Should the logging be a middleware you wrap a store with, or something added to every store? And what should it print: the whole state or what changed?", options: ["A middleware, prev and next state", "Something on every store"],
    }, "We keep losing track of what changed the store. Can you add some logging to zustand so we can see it?"),
    await vague({
      of: "bulletproof-vite-feat-uselocalstorage", id: "vite-vague-persist-settings", title: "\"Settings should survive a refresh\"",
      ask: "Do you want a reusable hook in src/hooks that keeps one value in localStorage, or should I change the settings screen only?", options: ["A reusable hook in src/hooks", "Only the settings screen"],
    }, "Users complain that what they set in the app is gone after a refresh. Can we make values stick around?"),
    await vague({
      of: "flask-feat-routes-json", id: "flask-vague-routes-output", title: "\"flask routes is hard to use in scripts\"",
      ask: "What would the scripts like to read: JSON on stdout, or a CSV? And should the current table output stay as the default?", options: ["JSON, table stays the default", "CSV"],
    }, "The output of `flask routes` is hard to use in our scripts. Can you do something about it?"),
  ];
}
