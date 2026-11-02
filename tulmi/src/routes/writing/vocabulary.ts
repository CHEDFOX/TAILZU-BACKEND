/**
 * The person's own words and snippets: POST /v1/words and POST /v1/snippets.
 */

import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { updatePersonality } from "../../personality/store.js";
import { unauthorized } from "../../http/helpers.js";

export interface VocabularyRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
}

export function registerVocabularyRoutes(app: FastifyInstance, deps: VocabularyRouteDeps): void {
  const { rateLimit: AUTHED_RL } = deps;
  // --- Words and snippets, one at a time (the desk's Words page) ---------------
  // The vocabulary is one newline-separated string and the snippets another, and
  // both are saved whole by PUT /v1/personality. A page with an add field and a
  // remove link per row needs to change ONE line without holding the rest, so
  // these do that under the personality lock.
  const WORD_MAX = 80, SNIP_SAY_MAX = 40, SNIP_GET_MAX = 600, LINES_MAX = 400;
  const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

  app.post("/v1/words", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const b = (req.body ?? {}) as { add?: unknown; remove?: unknown; kind?: unknown };
    const add = oneLine(b.add, WORD_MAX), remove = oneLine(b.remove, WORD_MAX);
    if (!add && !remove) return reply.code(400).send({ code: "bad_request", message: "Say which word to add or remove" });
    const same = (a: string, z: string) => a.toLowerCase() === z.toLowerCase();
    const merged = await updatePersonality(user, (existing) => {
      let lines = String(existing.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let dictionary = existing.dictionary ?? [];
      if (add && !lines.some((l) => same(l, add))) lines = [...lines, add].slice(-LINES_MAX);
      if (remove) {
        lines = lines.filter((l) => !same(l, remove));
        // A proof mark on the page is a dictionary pair, named by what it is
        // written as.
        if (b.kind === "pair") dictionary = dictionary.filter((d) => !same(String(d.replacement ?? ""), remove));
      }
      return { ...existing, vocabulary: lines.join("\n"), dictionary };
    });
    return reply.send({ ok: true, words: String(merged.vocabulary ?? "").split("\n").filter(Boolean).length });
  });

  app.post("/v1/snippets", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const b = (req.body ?? {}) as { say?: unknown; get?: unknown; remove?: unknown };
    const say = oneLine(b.say, SNIP_SAY_MAX).replace(/=/g, ""), remove = oneLine(b.remove, SNIP_SAY_MAX);
    // What it writes may span lines; stored on one, the way the parser reads it.
    const get = String(b.get ?? "").trim().slice(0, SNIP_GET_MAX).replace(/\r?\n/g, "\\n");
    if (!remove && (!say || !get)) return reply.code(400).send({ code: "bad_request", message: "A snippet needs a name and what it writes" });
    const key = (l: string) => l.slice(0, Math.max(0, l.indexOf("="))).trim().toLowerCase();
    await updatePersonality(user, (existing) => {
      let lines = String(existing.snippets ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("="));
      if (remove) lines = lines.filter((l) => key(l) !== remove.toLowerCase());
      if (say && get) lines = [...lines.filter((l) => key(l) !== say.toLowerCase()), `${say} = ${get}`].slice(-LINES_MAX);
      return { ...existing, snippets: lines.join("\n") };
    });
    return reply.send({ ok: true });
  });
}
