/**
 * WHAT THE CINEMA BOT'S CHAT KNOWS: the person's films (where each stands, its shots, why it waits) and their latest pictures,
 * as one fenced block of their own data (bots/run.ts puts it in the turn's knowledge). It never holds a link, a key, a model or a cost,
 * only words, so the chat can say "your chai film is waiting for you to look at its storyboard" and point at the page.
 */
import { neutral } from "../bots/prompt.js";
import { asUntrustedFile } from "../media/untrusted.js";
import { cinemaStore, type CinemaStore } from "./store.js";
import { filmsOn } from "./films.js";
import { sceneStore, type SceneStore } from "./scene/store.js";

const MAX_CHARS = 6_000;
const NONE = "They have not made a film or a picture yet. To begin, they describe the film (what happens, how long, for where) or the picture they want.";
/** While films are off (cinema/films.ts): a picture of the idea, then the picture built in 3D. */
const NONE_3D = "They have not made a picture or a 3D creation yet. To begin, they describe the idea; it is shown as a picture, and the picture can then be built in 3D.";

const SCENE_STATUS: Record<string, string> = { working: "still being built in 3D", done: "built in 3D and ready to look at", failed: "could not be built in 3D" };

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

export async function cinemaDigest(userId: string, o: { store?: CinemaStore; scenes?: SceneStore | null } = {}): Promise<string> {
  const store = o.store ?? cinemaStore();
  const films3d = !filmsOn();
  const scenesFrom = o.scenes === undefined ? sceneStore() : o.scenes;
  const [films, pictures, scenes] = await Promise.all([
    films3d ? Promise.resolve([]) : store.listFilms(userId, 10),
    store.listPictures(userId, 8),
    scenesFrom ? scenesFrom.list(userId, 8).catch(() => []) : Promise.resolve([]),
  ]);
  if (!films.length && !pictures.length && !scenes.length) {
    return asUntrustedFile({ name: "Their films and pictures", kind: "cinema", body: films3d ? NONE_3D : NONE });
  }
  const lines: string[] = [];
  for (const sc of scenes) lines.push(`- 3D: "${sc.ask.slice(0, 60)}"${sc.refKey ? " (from one of their pictures)" : ""}: ${SCENE_STATUS[sc.status] ?? sc.status}${sc.status === "working" && sc.rounds ? `, round ${sc.rounds}` : ""}.`);
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
