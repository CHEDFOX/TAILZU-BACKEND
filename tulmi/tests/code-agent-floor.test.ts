/**
 * THE FLOOR (src/code/agent/floor.ts): what a page needs whatever its design says, read off the page a browser drew.
 *
 * The design round asks whether the built page matches the design the person approved. This asks the other question, the one
 * nobody puts in a request: is it usable at all. What these hold down:
 *   - each rule fires on a page that breaks it, and A CLEAN PAGE SAYS NOTHING AT ALL (a check that cries wolf gets ignored);
 *   - a decision the author made is not a fault: alt="" is decoration, role="presentation" and aria-hidden are hidden;
 *   - a label counts however it was given — <label for>, a wrapping <label>, aria-label, aria-labelledby or title;
 *   - a button is named by its text, its aria-label, or the alt of the icon inside it;
 *   - it is counted and shown: how many places, and a few named, never a wall of them;
 *   - IT CANNOT FAIL A JOB: rubbish, a cut-off page or an empty string is a page with no findings, and it never throws.
 */
import { describe, expect, it } from "vitest";
import { FLOOR_SHOWN, checkFloor, floorLines } from "../src/code/agent/floor.js";

/** A page with nothing wrong with it: the floor must be silent on this. */
const SOUND = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pricing</title></head>
<body>
  <h1>Pricing</h1>
  <h2>Pro</h2>
  <img src="/pro.png" alt="The Pro plan's badge">
  <img src="/swirl.svg" alt="">
  <form>
    <label for="email">Your email</label><input id="email" type="email" name="email">
    <label>Your name <input type="text" name="name"></label>
    <input type="search" name="q" aria-label="Search the plans">
    <select name="plan" title="Which plan"><option>Pro</option></select>
    <textarea name="note" aria-labelledby="noteLabel"></textarea>
    <span id="noteLabel">Anything else</span>
    <input type="hidden" name="csrf" value="x">
    <input type="submit" value="Buy">
  </form>
  <button>Buy Pro</button>
  <button aria-label="Close"><span class="x"></span></button>
  <button><img src="/share.svg" alt="Share"></button>
</body></html>`;

const rules = (html: string): string[] => checkFloor(html).map((f) => f.rule);
const one = (html: string, rule: string) => checkFloor(html).find((f) => f.rule === rule);

describe("a page with nothing wrong with it", () => {
  it("says nothing at all", () => {
    expect(checkFloor(SOUND)).toEqual([]);
    expect(floorLines([])).toEqual([]);
  });
});

describe("the phone", () => {
  it("fires when there is no viewport tag, and when it does not say device-width", () => {
    expect(rules(SOUND.replace(/<meta name="viewport"[^>]*>/, ""))).toContain("viewport");
    expect(one(SOUND.replace(/<meta name="viewport"[^>]*>/, ""), "viewport")!.text).toMatch(/desktop width/);
    expect(rules(SOUND.replace('content="width=device-width, initial-scale=1"', 'content="initial-scale=1"'))).toContain("viewport");
    // Written any of the ways it is written, it is still the tag.
    expect(rules(SOUND.replace(/<meta name="viewport"[^>]*>/, "<meta content='width=device-width,initial-scale=1' NAME=viewport />"))).not.toContain("viewport");
  });
});

describe("the language", () => {
  it("fires when <html> has no lang, and not when it has one", () => {
    expect(rules(SOUND.replace('<html lang="en">', "<html>"))).toContain("lang");
    expect(rules(SOUND.replace('<html lang="en">', "<html lang=hi dir=ltr>"))).not.toContain("lang");
    // An empty one is no language at all.
    expect(rules(SOUND.replace('<html lang="en">', '<html lang="">'))).toContain("lang");
  });
});

describe("the images", () => {
  it("fires on an image with no alt at all, and names a few of them", () => {
    const page = SOUND.replace("<body>", '<body><img src="/a.png"><img src="/b.png"><img src="/c.png"><img src="/d.png">');
    const f = one(page, "img.alt")!;
    expect(f.count).toBe(4);
    expect(f.text).toContain("/a.png");
    // Counted in full, shown in part: a report is not a wall of paths.
    expect(f.text).not.toContain("/d.png");
    expect(f.text.match(/\/[a-d]\.png/g)).toHaveLength(FLOOR_SHOWN);
  });

  it('is silent on what the author decided: an empty alt, role=presentation or none, aria-hidden', () => {
    const page = SOUND.replace("<body>", '<body><img src="/x.png" alt=""><img src="/y.png" role="presentation"><img src="/z.png" role=none><img src="/w.png" aria-hidden="true"><img src="/v.png" aria-label="A chart of the plans">');
    expect(rules(page)).not.toContain("img.alt");
    // A bare `alt`, as HTML allows, is still the author having written one.
    expect(rules(SOUND.replace("<body>", '<body><img src="/x.png" alt>'))).not.toContain("img.alt");
  });
});

describe("the fields", () => {
  it("fires on a field nobody labelled, whichever kind it is", () => {
    const page = SOUND.replace("</form>", '<input type="text" id="phone"><select name="size"></select><textarea name="why"></textarea></form>');
    const f = one(page, "field.label")!;
    expect(f.count).toBe(3);
    expect(f.text).toContain("#phone");
    expect(f.text).toMatch(/no <label>, aria-label/);
  });

  it("takes a label however it was given, and asks none of a hidden field or a button", () => {
    // Every field in the sound page is labelled one of the five ways, and none of them fires.
    expect(rules(SOUND)).not.toContain("field.label");
    expect(rules(SOUND.replace("</form>", '<input type="hidden" name="t"><input type="submit" value="Go"><input type="button" value="Undo"><input type="reset" value="Clear"></form>')))
      .not.toContain("field.label");
  });
});

describe("the buttons", () => {
  it("fires on one with no text and no name, and takes its icon's alt as a name", () => {
    const f = one(SOUND.replace("</body>", '<button class="icon"><svg></svg></button></body>'), "control.name")!;
    expect(f.count).toBe(1);
    expect(f.text).toMatch(/A screen reader announces only "button"/);
    for (const named of ['<button title="Close">×</button>', '<button><img src="/i.svg" alt="Open the menu"></button>', "<button> Buy </button>", '<button aria-labelledby="lbl"></button>']) {
      expect(rules(SOUND.replace("</body>", `${named}</body>`))).not.toContain("control.name");
    }
  });
});

describe("the outline", () => {
  it("fires when a heading level is skipped, and not when each step is one", () => {
    const f = one(SOUND.replace("<h2>Pro</h2>", "<h4>Pro</h4>"), "heading.skip")!;
    expect(f.count).toBe(1);
    expect(f.text).toContain("h1 then h4");
    expect(rules(`<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2></body></html>`)).toEqual([]);
  });
});

describe("it cannot fail a job", () => {
  it("has nothing to say about an empty, tiny or senseless page, and never throws", () => {
    for (const bad of ["", "x", "<<<<", "not html at all", "{\"json\":true}"]) {
      expect(() => checkFloor(bad)).not.toThrow();
      expect(checkFloor(bad)).toEqual([]);
    }
    // A page cut off mid-tag: what can be read is read, and the rest is not a fault.
    expect(() => checkFloor('<html lang="en"><head><meta name="viewport" content="width=device-width"><body><img src="/a.png" al')).not.toThrow();
    expect(() => checkFloor(undefined as unknown as string)).not.toThrow();
  });

  it("does not grind through a page with thousands of the same tag", () => {
    const many = `<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body>${'<img src="/a.png">'.repeat(3_000)}</body></html>`;
    const began = Date.now();
    const f = one(many, "img.alt")!;
    expect(f.count).toBeGreaterThan(0);
    expect(Date.now() - began).toBeLessThan(2_000);
  });
});

describe("the words the report carries", () => {
  it("open with what they are, then one line each", () => {
    const lines = floorLines(checkFloor(SOUND.replace('<html lang="en">', "<html>").replace(/<meta name="viewport"[^>]*>/, "")));
    expect(lines[0]).toBe("What the page needs whatever its design says (checked on the page as a browser drew it):");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^- The page has no viewport meta tag/);
    expect(lines[2]).toMatch(/^- The <html> tag has no lang/);
  });
});
