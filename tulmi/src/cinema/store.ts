/**
 * WHERE A PERSON'S FILMS, PICTURES AND CAST ARE KEPT (migration 0101). Supabase when it is set up, else memory (tests, and a dev server
 * with no database: a restart forgets them).
 *
 *   cinema_films     one row a film: where it stands, what was asked, the money agreed and spent, and the film itself as JSON (the script,
 *                    each shot's progress, every take, the cut). A film is read and written whole: one person's film is small, and the
 *                    service changes one film at a time (service.ts holds a lock per film)
 *   cinema_pictures  one row a picture the bot made: the words asked, the model, the media key of the picture, what it cost
 *   cinema_cast      the person's cast: people they keep and use again, in films and pictures, with their reference sheet
 *
 * The pictures, stills, takes and films themselves are blobs (media/blob.ts), under u/<person>/cinema/. Nothing here is logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { Character, Film, FilmStatus, Place } from "./types.js";

export interface Picture {
  id: string;
  ownerId: string;
  words: string;
  kind: string;
  model: string;
  /** Media key of the picture. */
  key: string;
  type: string;
  paise: number;
  note: string | null;
  createdAt: number;
}

/** The statuses the tick moves on by itself. */
export const WORKING: readonly FilmStatus[] = ["boarding", "rendering", "cutting"];

export interface CinemaStore {
  createFilm(f: Film): Promise<void>;
  getFilm(userId: string, id: string): Promise<Film | null>;
  saveFilm(f: Film): Promise<void>;
  listFilms(userId: string, limit: number): Promise<Film[]>;
  /** What one session made, oldest first: the session's screen draws these in the talk, where they happened. */
  inSession(userId: string, session: string): Promise<{ films: Film[]; pictures: Picture[] }>;
  /** Films, anyone's, that the tick has work on. */
  working(limit: number): Promise<Film[]>;
  deleteFilm(userId: string, id: string): Promise<void>;
  addPicture(p: Picture): Promise<void>;
  listPictures(userId: string, limit: number): Promise<Picture[]>;
  getPicture(userId: string, id: string): Promise<Picture | null>;
  deletePicture(userId: string, id: string): Promise<void>;
  cast(userId: string): Promise<Character[]>;
  putCast(userId: string, c: Character): Promise<void>;
  dropCast(userId: string, key: string): Promise<void>;
  /** The places kept across films, so the stall in the next one is the same stall. */
  places(userId: string): Promise<Place[]>;
  putPlace(userId: string, p: Place): Promise<void>;
  dropPlace(userId: string, key: string): Promise<void>;
  /** Everything of a person's, for the account's deletion: the rows go, and the media keys come back for the blobs to go too. */
  forAccountDelete(userId: string): Promise<string[]>;
}

const MEMORY_MAX = 5_000;
const copy = <T>(v: T): T => structuredClone(v);

/** Every media key a film holds. */
export function filmKeys(f: Film): string[] {
  const keys: (string | null | undefined)[] = [];
  if (f.script) {
    keys.push(f.script.bible.lookRef, ...f.script.bible.characters.map((c) => c.ref), ...f.script.bible.places.map((p) => p.ref));
  }
  for (const s of f.shots) keys.push(s.still, s.voice, s.said);
  for (const t of f.takes) keys.push(t.video, t.lastFrame);
  keys.push(f.cut.video, f.cut.srt, f.cut.music, f.cut.big, f.cut.animatic);
  for (const e of f.editions ?? []) keys.push(e.video);
  return [...new Set(keys.filter((k): k is string => !!k))];
}

export class MemoryCinemaStore implements CinemaStore {
  private films = new Map<string, Film>();
  private pictures = new Map<string, Picture>();
  private casts = new Map<string, Character[]>();
  private spots = new Map<string, Place[]>();

  async createFilm(f: Film): Promise<void> {
    if (this.films.size >= MEMORY_MAX) this.films.delete(this.films.keys().next().value!);
    this.films.set(f.id, copy(f));
  }
  async getFilm(userId: string, id: string): Promise<Film | null> {
    const f = this.films.get(id);
    return f && f.ownerId === userId ? copy(f) : null;
  }
  async saveFilm(f: Film): Promise<void> {
    if (this.films.has(f.id)) this.films.set(f.id, copy(f));
  }
  async listFilms(userId: string, limit: number): Promise<Film[]> {
    return [...this.films.values()].filter((f) => f.ownerId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map(copy);
  }
  async inSession(userId: string, session: string): Promise<{ films: Film[]; pictures: Picture[] }> {
    const mine = (x: { ownerId: string; session?: string | null }) => x.ownerId === userId && x.session === session;
    return {
      films: [...this.films.values()].filter(mine).sort((a, b) => a.createdAt - b.createdAt).map(copy),
      pictures: [...this.pictures.values()].filter(mine).sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ ...p })),
    };
  }
  async working(limit: number): Promise<Film[]> {
    return [...this.films.values()].filter((f) => WORKING.includes(f.status)).slice(0, limit).map(copy);
  }
  async deleteFilm(userId: string, id: string): Promise<void> {
    if (this.films.get(id)?.ownerId === userId) this.films.delete(id);
  }
  async addPicture(p: Picture): Promise<void> {
    if (this.pictures.size >= MEMORY_MAX) this.pictures.delete(this.pictures.keys().next().value!);
    this.pictures.set(p.id, { ...p });
  }
  async listPictures(userId: string, limit: number): Promise<Picture[]> {
    return [...this.pictures.values()].filter((p) => p.ownerId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((p) => ({ ...p }));
  }
  async getPicture(userId: string, id: string): Promise<Picture | null> {
    const p = this.pictures.get(id);
    return p && p.ownerId === userId ? { ...p } : null;
  }
  async deletePicture(userId: string, id: string): Promise<void> {
    if (this.pictures.get(id)?.ownerId === userId) this.pictures.delete(id);
  }
  async cast(userId: string): Promise<Character[]> {
    return copy(this.casts.get(userId) ?? []);
  }
  async putCast(userId: string, c: Character): Promise<void> {
    const list = (this.casts.get(userId) ?? []).filter((x) => x.key !== c.key);
    this.casts.set(userId, [...list, { ...c }].slice(-50));
  }
  async dropCast(userId: string, key: string): Promise<void> {
    this.casts.set(userId, (this.casts.get(userId) ?? []).filter((x) => x.key !== key));
  }
  async places(userId: string): Promise<Place[]> {
    return copy(this.spots.get(userId) ?? []);
  }
  async putPlace(userId: string, p: Place): Promise<void> {
    const list = (this.spots.get(userId) ?? []).filter((x) => x.key !== p.key);
    this.spots.set(userId, [...list, { ...p }].slice(-50));
  }
  async dropPlace(userId: string, key: string): Promise<void> {
    this.spots.set(userId, (this.spots.get(userId) ?? []).filter((x) => x.key !== key));
  }
  async forAccountDelete(userId: string): Promise<string[]> {
    const keys: string[] = [];
    for (const f of [...this.films.values()].filter((x) => x.ownerId === userId)) {
      keys.push(...filmKeys(f));
      this.films.delete(f.id);
    }
    for (const p of [...this.pictures.values()].filter((x) => x.ownerId === userId)) {
      keys.push(p.key);
      this.pictures.delete(p.id);
    }
    for (const c of this.casts.get(userId) ?? []) if (c.ref) keys.push(c.ref);
    for (const x of this.spots.get(userId) ?? []) if (x.ref) keys.push(x.ref);
    this.casts.delete(userId);
    this.spots.delete(userId);
    return [...new Set(keys)];
  }
}

interface FilmRow {
  id: string;
  user_id: string;
  status: FilmStatus;
  hold: Film["hold"];
  idea: string;
  aspect: Film["aspect"];
  tier: Film["tier"];
  length: number;
  voice: string;
  budget_paise: number;
  spent_paise: number;
  body: Pick<Film, "script" | "shots" | "takes" | "cut" | "notes" | "editions" | "wantBig">;
  session_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

function toRow(f: Film): FilmRow {
  return {
    id: f.id, user_id: f.ownerId, status: f.status, hold: f.hold, idea: f.idea, aspect: f.aspect, tier: f.tier, length: f.length, voice: f.voice,
    budget_paise: f.budgetPaise, spent_paise: f.spentPaise, session_id: f.session ?? null,
    body: { script: f.script, shots: f.shots, takes: f.takes, cut: f.cut, notes: f.notes, ...(f.editions ? { editions: f.editions } : {}), ...(f.wantBig ? { wantBig: true } : {}) },
    error: f.error, created_at: iso(f.createdAt), updated_at: iso(f.updatedAt),
  };
}

function fromRow(r: FilmRow): Film {
  return {
    id: r.id, ownerId: r.user_id, status: r.status, hold: r.hold, idea: r.idea, aspect: r.aspect, tier: r.tier, length: r.length, voice: r.voice,
    budgetPaise: r.budget_paise, spentPaise: r.spent_paise, script: r.body?.script ?? null, shots: r.body?.shots ?? [], takes: r.body?.takes ?? [],
    cut: r.body?.cut ?? { video: null, srt: null, seconds: 0, of: null }, notes: r.body?.notes ?? [], error: r.error,
    ...(r.session_id ? { session: r.session_id } : {}),
    ...(r.body?.editions ? { editions: r.body.editions } : {}), ...(r.body?.wantBig ? { wantBig: true } : {}),
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
  };
}

interface PictureRow { id: string; user_id: string; words: string; kind: string; model: string; media_key: string; type: string; paise: number; note: string | null; created_at: string }

const pictureOf = (r: PictureRow): Picture => ({
  id: r.id, ownerId: r.user_id, words: r.words, kind: r.kind, model: r.model, key: r.media_key, type: r.type, paise: r.paise, note: r.note, createdAt: Date.parse(r.created_at),
});

export class SupabaseCinemaStore implements CinemaStore {
  constructor(private readonly db: SupabaseClient) {}

  async createFilm(f: Film): Promise<void> {
    const { error } = await this.db.from("cinema_films").insert(toRow(f));
    if (error) throw new Error("cinema_films insert failed");
  }
  async getFilm(userId: string, id: string): Promise<Film | null> {
    const { data, error } = await this.db.from("cinema_films").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error("cinema_films read failed");
    return data ? fromRow(data as FilmRow) : null;
  }
  async saveFilm(f: Film): Promise<void> {
    const { id, user_id, created_at, ...rest } = toRow(f);
    void created_at;
    const { error } = await this.db.from("cinema_films").update(rest).eq("id", id).eq("user_id", user_id);
    if (error) throw new Error("cinema_films update failed");
  }
  async listFilms(userId: string, limit: number): Promise<Film[]> {
    const { data, error } = await this.db.from("cinema_films").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(Math.min(100, limit));
    if (error) throw new Error("cinema_films list failed");
    return (data as FilmRow[]).map(fromRow);
  }
  async inSession(userId: string, session: string): Promise<{ films: Film[]; pictures: Picture[] }> {
    const [f, p] = await Promise.all([
      this.db.from("cinema_films").select("*").eq("user_id", userId).eq("session_id", session).order("created_at", { ascending: true }).limit(50),
      this.db.from("cinema_pictures").select("*").eq("user_id", userId).eq("session_id", session).order("created_at", { ascending: true }).limit(50),
    ]);
    if (f.error || p.error) throw new Error("cinema session read failed");
    return { films: (f.data as FilmRow[]).map(fromRow), pictures: (p.data as PictureRow[]).map(pictureOf) };
  }
  async working(limit: number): Promise<Film[]> {
    const { data, error } = await this.db.from("cinema_films").select("*").in("status", [...WORKING]).order("updated_at", { ascending: true }).limit(Math.min(500, limit));
    if (error) throw new Error("cinema_films working failed");
    return (data as FilmRow[]).map(fromRow);
  }
  async deleteFilm(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from("cinema_films").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error("cinema_films delete failed");
  }
  async addPicture(p: Picture): Promise<void> {
    const { error } = await this.db.from("cinema_pictures").insert({
      id: p.id, user_id: p.ownerId, words: p.words, kind: p.kind, model: p.model, media_key: p.key, type: p.type, paise: p.paise, note: p.note, created_at: iso(p.createdAt),
    });
    if (error) throw new Error("cinema_pictures insert failed");
  }
  async listPictures(userId: string, limit: number): Promise<Picture[]> {
    const { data, error } = await this.db.from("cinema_pictures").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(Math.min(100, limit));
    if (error) throw new Error("cinema_pictures list failed");
    return (data as PictureRow[]).map(pictureOf);
  }
  async getPicture(userId: string, id: string): Promise<Picture | null> {
    const { data, error } = await this.db.from("cinema_pictures").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error("cinema_pictures read failed");
    return data ? pictureOf(data as PictureRow) : null;
  }
  async deletePicture(userId: string, id: string): Promise<void> {
    const { error } = await this.db.from("cinema_pictures").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error("cinema_pictures delete failed");
  }
  async cast(userId: string): Promise<Character[]> {
    const { data, error } = await this.db.from("cinema_cast").select("*").eq("user_id", userId).eq("kind", "person").order("created_at", { ascending: true }).limit(50);
    if (error) throw new Error("cinema_cast read failed");
    return (data as { key: string; name: string; look: string; wardrobe: string; voice: string | null; ref: string | null }[]).map((r) => ({ key: r.key, name: r.name, look: r.look, wardrobe: r.wardrobe, voice: r.voice ?? "", ref: r.ref }));
  }
  async putCast(userId: string, c: Character): Promise<void> {
    const { error } = await this.db.from("cinema_cast").upsert({ user_id: userId, key: c.key, name: c.name, look: c.look, wardrobe: c.wardrobe, voice: c.voice, ref: c.ref, kind: "person" }, { onConflict: "user_id,key" });
    if (error) throw new Error("cinema_cast upsert failed");
  }
  async dropCast(userId: string, key: string): Promise<void> {
    const { error } = await this.db.from("cinema_cast").delete().eq("user_id", userId).eq("key", key);
    if (error) throw new Error("cinema_cast delete failed");
  }
  async places(userId: string): Promise<Place[]> {
    const { data, error } = await this.db.from("cinema_cast").select("*").eq("user_id", userId).eq("kind", "place").order("created_at", { ascending: true }).limit(50);
    if (error) throw new Error("cinema_cast read failed");
    return (data as { key: string; name: string; look: string; ref: string | null }[]).map((r) => ({ key: r.key, name: r.name, look: r.look, ref: r.ref }));
  }
  async putPlace(userId: string, p: Place): Promise<void> {
    const { error } = await this.db.from("cinema_cast").upsert({ user_id: userId, key: p.key, name: p.name, look: p.look, wardrobe: "", voice: "", ref: p.ref, kind: "place" }, { onConflict: "user_id,key" });
    if (error) throw new Error("cinema_cast upsert failed");
  }
  async dropPlace(userId: string, key: string): Promise<void> {
    const { error } = await this.db.from("cinema_cast").delete().eq("user_id", userId).eq("key", key).eq("kind", "place");
    if (error) throw new Error("cinema_cast delete failed");
  }
  async forAccountDelete(userId: string): Promise<string[]> {
    const keys: string[] = [];
    for (const f of await this.listFilms(userId, 100)) keys.push(...filmKeys(f));
    for (const p of await this.listPictures(userId, 100)) keys.push(p.key);
    for (const c of await this.cast(userId)) if (c.ref) keys.push(c.ref);
    for (const x of await this.places(userId)) if (x.ref) keys.push(x.ref);
    for (const table of ["cinema_films", "cinema_pictures", "cinema_cast"]) {
      const { error } = await this.db.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`${table} delete failed`);
    }
    return [...new Set(keys)];
  }
}

let shared: CinemaStore | null = null;
export function cinemaStore(): CinemaStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseCinemaStore(db) : new MemoryCinemaStore();
  }
  return shared;
}
