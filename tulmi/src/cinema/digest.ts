/**
 * WHAT THE CINEMA BOT'S CHAT KNOWS: the person's films (where each stands, its shots, why it waits) and their latest pictures,
 * as one fenced block of their own data (bots/run.ts puts it in the turn's knowledge). It never holds a link, a key, a model or a cost,
 * only words, so the chat can say "your chai film is waiting for you to look at its storyboard" and point at the page.
 */
import { neutral } from "../bots/prompt.js";
import { asUntrustedFile } from "../media/untrusted.js";
import { cinemaStore, type CinemaStore } from "./store.js";

const MAX_CHARS = 6_000;
const NONE = "They have not made a film or a picture yet. To begin, they describe the film (what happens, how long, for where) or the picture they want.";

const STATUS: Record<string, string> = {
  writing: "the director is writing it",
  script: "its script is waiting for them to read and say go",
  boarding: "its storyboard is being made",
  board: "its storyboard is waiting for them to say go",
  rendering: "its shots are being made",
  cutting: "it is being cut",
  done: "finished",
  failed: "it could not be made",
  stopped: "they stopped it",
};

export async function cinemaDigest(userId: string, o: { store?: CinemaStore } = {}): Promise<string> {
  const store = o.store ?? cinemaStore();
  const [films, pictures] = await Promise.all([store.listFilms(userId, 10), store.listPictures(userId, 8)]);
  if (!films.length && !pictures.length) return asUntrustedFile({ name: "Their films and pictures", kind: "cinema", body: NONE });
  const lines: string[] = [];
  for (const f of films) {
    const title = f.script?.bible.title || f.idea.slice(0, 60);
    const shots = f.script?.shots.length ?? 0;
    const ok = f.shots.filter((s) => s.status === "ok").length;
    const wait = f.hold === "budget" ? "; it has reached today's limit and carries on tomorrow" : f.hold === "shot" ? `; a shot needs them: ${f.shots.find((s) => s.error)?.error ?? "it did not come out right"}` : "";
    lines.push(`- "${title}" (${f.aspect}, ${f.tier}, ${shots} shots, ${ok} made): ${STATUS[f.status] ?? f.status}${wait}.`);
    if (f.notes[0]) lines.push(`  Note: ${f.notes[0]}`);
  }
  if (pictures.length) lines.push(`Latest pictures: ${pictures.map((p) => `"${p.words.slice(0, 60)}"`).join("; ")}.`);
  let body = lines.join("\n");
  if (body.length > MAX_CHARS) body = `${body.slice(0, MAX_CHARS)}\n(more not shown)`;
  return asUntrustedFile({ name: "Their films and pictures, as the cinema bot keeps them", kind: "cinema", body: neutral(body) });
}
