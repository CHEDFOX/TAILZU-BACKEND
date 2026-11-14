/**
 * THE CINEMA BOT'S STORE AND LINKS (src/cinema/store.ts, src/cinema/media.ts):
 *
 *   - a film is the owner's alone; the tick sees only films with work to do
 *   - the account's deletion takes every row and hands back every media key a film, a picture or the cast holds
 *   - a link is signed for one key and one expiry; a changed key, a changed expiry, an old link and a key outside the cinema folder are refused
 */
import { describe, expect, it } from "vitest";
import { castKey, filmKey, isCinemaKey, ownerOfKey, pictureKey, signMedia, typeOfKey, verifyMedia } from "../src/cinema/media.js";
import { filmKeys, MemoryCinemaStore } from "../src/cinema/store.js";
import { film } from "./cinema-rig.js";

describe("the store", () => {
  it("keeps a film its owner's alone", async () => {
    const s = new MemoryCinemaStore();
    await s.createFilm(film());
    expect(await s.getFilm("u1", "f1")).not.toBeNull();
    expect(await s.getFilm("u2", "f1")).toBeNull();
    await s.deleteFilm("u2", "f1");
    expect(await s.getFilm("u1", "f1")).not.toBeNull();
  });

  it("gives the tick only the films with work to do", async () => {
    const s = new MemoryCinemaStore();
    await s.createFilm(film({ id: "a", status: "boarding" }));
    await s.createFilm(film({ id: "b", status: "board" }));
    await s.createFilm(film({ id: "c", status: "rendering" }));
    await s.createFilm(film({ id: "d", status: "done" }));
    expect((await s.working(10)).map((f) => f.id).sort()).toEqual(["a", "c"]);
  });

  it("hands back a copy, so a change is only kept when it is saved", async () => {
    const s = new MemoryCinemaStore();
    await s.createFilm(film());
    const f = (await s.getFilm("u1", "f1"))!;
    f.status = "done";
    expect((await s.getFilm("u1", "f1"))!.status).toBe("boarding");
    await s.saveFilm(f);
    expect((await s.getFilm("u1", "f1"))!.status).toBe("done");
  });

  it("takes everything of a person's when the account goes, and names every file", async () => {
    const s = new MemoryCinemaStore();
    const f = film();
    f.script!.bible.lookRef = "k-look";
    f.shots[0]!.still = "k-still";
    f.shots[0]!.said = "k-said";
    f.cut.video = "k-film";
    f.cut.music = "k-music";
    f.cut.big = "k-big";
    f.editions = [{ aspect: "9:16", captions: true, video: "k-vertical", seconds: 12, of: "x" }];
    await s.createFilm(f);
    await s.addPicture({ id: "p1", ownerId: "u1", words: "x", kind: "photo", model: "m", key: "k-pic", type: "image/png", paise: 4, note: null, createdAt: 1 });
    await s.putCast("u1", { key: "ravi", name: "Ravi", look: "", wardrobe: "", ref: "k-cast" });
    // Every file a film holds, so none is left behind in storage: the other cuts, the big one, the music and a line we recorded too.
    expect(filmKeys(f).sort()).toEqual(["k-big", "k-film", "k-look", "k-music", "k-said", "k-still", "k-vertical"]);
    expect((await s.forAccountDelete("u1")).sort()).toEqual(["k-big", "k-cast", "k-film", "k-look", "k-music", "k-pic", "k-said", "k-still", "k-vertical"]);
    expect(await s.listFilms("u1", 10)).toEqual([]);
    expect(await s.cast("u1")).toEqual([]);
  });
});

describe("keys and links", () => {
  const SECRET = "s".repeat(40);
  const key = filmKey("user-1", "film-1", "still-3", "image/png");

  it("makes keys only inside the person's cinema folder", () => {
    expect(key).toBe("u/user-1/cinema/films/film-1/still-3.png");
    expect(pictureKey("user-1", "p../../x", "image/jpeg")).toBe("u/user-1/cinema/pictures/px.jpg");
    expect(castKey("user-1", "ravi", "1", "image/png")).toBe("u/user-1/cinema/cast/ravi-1.png");
    expect(isCinemaKey("u/user-1/media/abc")).toBe(false);
    expect(ownerOfKey(key)).toBe("user-1");
    expect(typeOfKey(key)).toBe("image/png");
  });

  it("verifies a link for its key and expiry only", () => {
    const now = 1_800_000_000_000;
    const link = signMedia(key, { now, secret: SECRET });
    const u = new URL(`https://x${link}`);
    const exp = u.searchParams.get("exp")!;
    const sig = u.searchParams.get("sig")!;
    expect(verifyMedia(key, exp, sig, { now, secret: SECRET })).toBe(true);
    expect(verifyMedia(key.replace("still-3", "still-4"), exp, sig, { now, secret: SECRET })).toBe(false);
    expect(verifyMedia(key, String(Number(exp) + 1), sig, { now, secret: SECRET })).toBe(false);
    expect(verifyMedia(key, exp, sig, { now: Number(exp) + 1, secret: SECRET })).toBe(false);
    expect(verifyMedia(key, exp, sig, { now, secret: "t".repeat(40) })).toBe(false);
    expect(verifyMedia("u/user-1/../x", exp, sig, { now, secret: SECRET })).toBe(false);
  });
});
