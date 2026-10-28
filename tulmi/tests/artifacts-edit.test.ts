/**
 * The efficiency engine (src/artifacts/edit.ts, model.ts): an element edit sends a model only that element, a few lines around it and the
 * kit, on the cheap tier; a model failure climbs one tier, once; prompts are laid out stable-first; an edit by saying answers with exact
 * replacements; and the viewer's errors are fixed from the lines around them, deduped, at most twice a version.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { rig, SAMPLE_DASHBOARD, BIG_DASHBOARD, idOf, FAKE_STRIPE } = await import("./artifacts-rig.js");
type Sent = import("./artifacts-rig.js").Sent;
const { fullRewriteMessages, FIX_ATTEMPTS, FIX_CHAIN, ELEMENT_WHOLE_MAX, ELEMENT_MAX, SMALL_ARTIFACT_CHARS, SMALL_INSTRUCTION_CHARS } = await import("../src/artifacts/edit.js");
const { worstCasePaise } = await import("../src/code/brain/money.js");
const { DEFAULT_TIERS } = await import("../src/code/brain/tiers.js");
const { charsOf, tokensOfChars } = await import("../src/code/brain/money.js");

const H2 = '<h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Sales this week</h2>';
const elementOf = (s: Sent): string => /<element>\n([\s\S]*?)\n<\/element>/.exec(s.user)![1]!;
const PROJECT = "22222222-2222-4222-8222-222222222222";
/** A model that changes the first text in whatever element it is sent, to something new each time. */
let nth = 0;
const retext = (s: Sent): string => elementOf(s).replace(/>([^<>{}]+)</, () => `>Changed ${(nth += 1)}<`);

/** A rig with the sample dashboard made, and a model that retitles whatever element it is sent. */
async function dash(answer: (s: Sent, n: number) => string | Error = (s) => elementOf(s).replace("Sales this week", "Weekly sales"), o: Parameters<typeof rig>[1] = {}) {
  const r = rig(answer, o);
  const made = await r.service.create("u1", { type: "react", title: "Dashboard", content: SAMPLE_DASHBOARD, projectId: o.paise === -1 ? undefined : PROJECT });
  return { ...r, id: made.artifact.id };
}

describe("editing an element", () => {
  it("sends the model ONLY that element, a few lines of context and nothing of the rest, on the cheap tier", async () => {
    const { service, model, id } = await dash();
    const c = await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    expect(model.sent).toHaveLength(1);
    const sent = model.sent[0]!;
    expect(sent.tier).toBe("cheap");
    expect(sent.purpose).toBe("artifact.element");
    expect(sent.userId).toBe("u1");
    expect(elementOf(sent)).toBe(H2);
    expect(sent.user).toMatch(/<context_before>\n\d+: .*<\/context_before>/s);
    expect(sent.user).toMatch(/<context_after>\n\d+: .*<\/context_after>/s);
    // none of the rest of the artifact is in the prompt
    for (const far of ["Aarav Mehta", "ORDERS", "StatusPill", "STATUS_COLORS", "useMemo", "Tooltip"]) expect(sent.user, far).not.toContain(far);
    // the whole prompt, system prompt and all, is smaller than the artifact alone
    expect(sent.chars).toBeLessThan(SAMPLE_DASHBOARD.length / 2);
    expect(c.how).toMatchObject({ mode: "element", tier: "cheap", sentChars: sent.chars, artifactChars: SAMPLE_DASHBOARD.length });
    expect(c.how.sentChars! / c.how.artifactChars!).toBeLessThan(0.5);
  });

  it("splices the answer into that span and stores a patch of just that span", async () => {
    const { service, store, id } = await dash();
    const c = await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    expect(c.version).toBe(2);
    expect((await service.get("u1", id)).content).toBe(SAMPLE_DASHBOARD.replace(H2, H2.replace("Sales this week", "Weekly sales")));
    const v = (await store.listVersions(id))[0]!;
    expect(v).toMatchObject({ version: 2, kind: "patch", madeBy: "person" });
    expect(v.note).toMatch(/^Changed <h2> at \d+:\d+: Rename the heading to Weekly sales$/);
    expect(v.storedBytes).toBeLessThan(160);
    // the first version is still the whole of the original
    expect((await service.get("u1", id, 1)).content).toBe(SAMPLE_DASHBOARD);
  });

  it("returns what the change cost, and the artifact keeps the total", async () => {
    const { service, id } = await dash(retext, { paise: 3 });
    const a = await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    expect(a).toMatchObject({ paise: 3, totalPaise: 3 });
    const b = await service.editElement("u1", id, idOf((await service.get("u1", id)).content, "<h2 style"), "Rename the heading to Sales");
    expect(b).toMatchObject({ paise: 3, totalPaise: 6 });
    expect((await service.own("u1", id)).spentPaise).toBe(6);
  });

  it("is a fraction of a full rewrite, in the tokens sent and almost nothing in the tokens written", async () => {
    const { service, model, id } = await dash();
    const c = await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    const base = fullRewriteMessages({ type: "react", title: "Dashboard", content: SAMPLE_DASHBOARD }, "Rename the heading to Weekly sales");
    const baseIn = tokensOfChars(charsOf(base as never));
    const baseOut = tokensOfChars(SAMPLE_DASHBOARD.length);
    const inTokens = tokensOfChars(model.sent[0]!.chars);
    expect(inTokens / baseIn).toBeLessThan(0.4);
    expect(c.how.completionTokens! / baseOut).toBeLessThan(0.02);
    expect((inTokens + c.how.completionTokens!) / (baseIn + baseOut)).toBeLessThan(0.25);
  });

  it("costs the same on an artifact four times the size, where a rewrite costs four times as much", async () => {
    const heading = (s: Sent) => elementOf(s).replace("Sales this week", "Weekly sales");
    const small = await dash(heading);
    const big = rig(heading);
    const made = await big.service.create("u1", { type: "react", title: "Dashboard", content: BIG_DASHBOARD });
    expect(BIG_DASHBOARD.length).toBeGreaterThan(SAMPLE_DASHBOARD.length * 3.5);
    const a = await small.service.editElement("u1", small.id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    const b = await big.service.editElement("u1", made.artifact.id, idOf(BIG_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    // the prompt is the same size: nothing of the rest of the artifact is in it
    expect(big.model.sent[0]!.chars).toBe(small.model.sent[0]!.chars);
    expect(b.how.promptTokens).toBe(a.how.promptTokens);
    const base = tokensOfChars(charsOf(fullRewriteMessages({ type: "react", title: "D", content: BIG_DASHBOARD }, "Rename the heading to Weekly sales") as never)) + tokensOfChars(BIG_DASHBOARD.length);
    expect((b.how.promptTokens! + b.how.completionTokens!) / base).toBeLessThan(0.06);
  });

  it("lays the prompt out stable first: the same system prompt, then the project's kit, then the artifact, then the instruction last", async () => {
    const { service, store, model, id } = await dash(retext);
    await store.putKit(PROJECT, "u1", "sha1", { prompt: "acme (Tailwind CSS). Use these names, colours and radius.\ncolors: primary #7c3aed", css: { css: ":root{}" } });
    await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "Rename the heading to Weekly sales");
    const cur = (await service.get("u1", id)).content;
    await service.editElement("u1", id, idOf(cur, "<h1 style"), "Say Hello");
    expect(model.sent).toHaveLength(2);
    const [a, b] = model.sent;
    // the system prompt is byte-identical, and the user message starts with the same kit
    expect(a!.system).toBe(b!.system);
    expect(a!.user.startsWith("PROJECT STYLE\nacme (Tailwind CSS). Use these names, colours and radius.\ncolors: primary #7c3aed\n\n<artifact ")).toBe(true);
    expect(b!.user.startsWith("PROJECT STYLE\nacme (Tailwind CSS)")).toBe(true);
    // the instruction is the last thing in the message
    expect(a!.user.trimEnd().endsWith("Change: Rename the heading to Weekly sales")).toBe(true);
    // so what a provider's prompt cache can reuse across two different edits is at least the system prompt and the kit
    const full = (s: Sent) => `${s.system}\n${s.user}`;
    let common = 0;
    while (common < Math.min(full(a!).length, full(b!).length) && full(a!)[common] === full(b!)[common]) common += 1;
    expect(common).toBeGreaterThan(a!.system.length + "PROJECT STYLE\nacme (Tailwind CSS). Use these names, colours and radius.\ncolors: primary #7c3aed".length);
  });

  it("asks for replacements, not the element, when the element is long, and stores just those", async () => {
    const root = idOf(SAMPLE_DASHBOARD, '<div style={{ fontFamily');
    const { service, store, model, id } = await dash(() => "<edit><old>Store overview</old><new>Shop overview</new></edit>");
    const c = await service.editElement("u1", id, root, "Rename the page to Shop overview");
    const sent = model.sent[0]!;
    expect(elementOf(sent).length).toBeGreaterThan(ELEMENT_WHOLE_MAX);
    expect(sent.user).toMatch(/This element is long: answer in the REPLACEMENTS form/);
    expect(sent.maxTokens).toBeLessThan(2500);
    expect((await service.get("u1", id)).content).toBe(SAMPLE_DASHBOARD.replace("Store overview", "Shop overview"));
    expect((await store.listVersions(id))[0]!.storedBytes).toBeLessThan(120);
    expect(c.how.mode).toBe("element");
  });

  it("is refused for an element that is gone, an id that is not one, an artifact without elements, and one that is most of the artifact, without asking a model", async () => {
    const { service, model, id } = await dash();
    await expect(service.editElement("u1", id, "999:1", "x")).rejects.toMatchObject({ code: "no_element" });
    await expect(service.editElement("u1", id, "five", "x")).rejects.toMatchObject({ code: "no_element" });
    await expect(service.editElement("u1", id, "3:1", "x")).rejects.toMatchObject({ code: "no_element", message: expect.stringMatching(/No element opens/) });
    const md = await service.create("u1", { type: "markdown", title: "Notes", content: "# Hi" });
    await expect(service.editElement("u1", md.artifact.id, "1:1", "x")).rejects.toMatchObject({ code: "no_element", message: expect.stringMatching(/markdown artifact has no elements/) });
    const big = await service.create("u1", { type: "html", title: "Big", content: `<div>${"<p>some paragraph of text</p>".repeat(1600)}</div>` });
    await expect(service.editElement("u1", big.artifact.id, "1:1", "x")).rejects.toMatchObject({ code: "no_element", message: expect.stringMatching(/most of the artifact/) });
    expect(model.sent).toHaveLength(0);
  });

  it("is the owner's only", async () => {
    const { service, model, id } = await dash();
    await expect(service.editElement("u2", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), "x")).rejects.toMatchObject({ code: "not_found" });
    expect(model.sent).toHaveLength(0);
  });

  it("does not show the model an instruction that holds a secret, and wants an instruction", async () => {
    const { service, model, id } = await dash();
    await service.editElement("u1", id, idOf(SAMPLE_DASHBOARD, "<h2 style"), `Rename the heading to ${FAKE_STRIPE}`).catch(() => undefined);
    expect(model.sent[0]!.user).not.toContain(FAKE_STRIPE);
    expect(model.sent[0]!.user).toContain("withheld");
    await expect(service.editElement("u1", id, "1:1", "  ")).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.editElement("u1", id, "1:1", "x".repeat(2001))).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("a model that fails", () => {
  const H = () => idOf(SAMPLE_DASHBOARD, "<h2 style");

  it("climbs ONE tier, once, with why the first answer could not be used", async () => {
    const { service, model, id } = await dash((s, n) => (n === 0 ? "Sure! Here is the new heading." : elementOf(s).replace("Sales this week", "Weekly sales")), { paise: 3 });
    const c = await service.editElement("u1", id, H(), "Rename the heading");
    expect(model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    expect(model.sent[1]!.user).toMatch(/A first attempt was not usable: the answer is not an element \(it must start with `<`\)/);
    expect(c.how.tier).toBe("code");
    // both calls were paid for
    expect(c).toMatchObject({ paise: 6, totalPaise: 6 });
  });

  it("gives up after that one climb: the artifact is untouched, and what was spent is still the artifact's", async () => {
    const { service, model, id } = await dash(() => "no", { paise: 3 });
    await expect(service.editElement("u1", id, H(), "Rename the heading")).rejects.toMatchObject({ code: "edit_failed", message: expect.stringMatching(/could not be made.*not an element.*Nothing was changed/) });
    expect(model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    const a = await service.own("u1", id);
    expect(a.headVersion).toBe(1);
    expect(a.spentPaise).toBe(6);
  });

  it("climbs when every model of the tier is down, and says so plainly when the next tier is down too", async () => {
    const r = await dash();
    r.model.down.add("cheap");
    const ok = await r.service.editElement("u1", r.id, H(), "Rename the heading");
    expect(r.model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    expect(ok.how.tier).toBe("code");
    const r2 = await dash();
    r2.model.down.add("cheap");
    r2.model.down.add("code");
    await expect(r2.service.editElement("u1", r2.id, H(), "Rename the heading")).rejects.toMatchObject({ code: "model_down", status: 503 });
    expect((await r2.service.own("u1", r2.id)).headVersion).toBe(1);
  });

  it("climbs from an answer that is unchanged, or more than one element, or holds a secret", async () => {
    for (const bad of [
      "<h2 style={{ margin: \"0 0 8px\", fontSize: 16 }}>Sales this week</h2>", "<b>one</b><b>two</b>", `<h2>${FAKE_STRIPE}</h2>`,
    ]) {
      const { service, model, id } = await dash((s, n) => (n === 0 ? (bad as never) : elementOf(s).replace("Sales this week", "Weekly sales")));
      const c = await service.editElement("u1", id, H(), "Rename the heading");
      expect(model.sent.map((s) => s.tier), JSON.stringify(bad)).toEqual(["cheap", "code"]);
      expect(c.version).toBe(2);
      expect(model.sent[1]!.user).not.toContain(FAKE_STRIPE);
    }
  });

  describe("an answer that ran out of room (smoke: 'the answer was cut off before it ended')", () => {
    const FULL = H2.replace("Sales this week", "Weekly sales");
    const CUT = FULL.slice(0, 40);
    const REST = FULL.slice(40);
    const made = async (answer: (s: Sent, n: number) => string | { text: string; truncated?: boolean }, o: Parameters<typeof rig>[1] = {}) => {
      const r = rig(answer as never, { paise: 3, ...o });
      const m = await r.service.create("u1", { type: "react", title: "Dashboard", content: SAMPLE_DASHBOARD, projectId: PROJECT });
      return { ...r, id: m.artifact.id };
    };

    it("is finished by ONE continuation on the same tier: the model is given what it wrote and goes on, and the two halves are one answer", async () => {
      const r = await made((_s, n) => (n === 0 ? { text: CUT, truncated: true } : REST));
      const c = await r.service.editElement("u1", r.id, H(), "Rename the heading to Weekly sales");
      expect(r.model.sent.map((s) => [s.tier, s.purpose])).toEqual([["cheap", "artifact.element"], ["cheap", "artifact.element.continue"]]);
      const second = r.model.sent[1]!;
      expect(second.messages.at(-2)).toEqual({ role: "assistant", content: CUT });
      expect(second.user).toMatch(/Continue it from exactly the character where it stopped/);
      expect(c.version).toBe(2);
      expect((await r.service.get("u1", r.id)).content).toContain(FULL);
      // Both calls were paid for, by the edit and by the person's day.
      expect(c.paise).toBe(6);
      expect(c.how.tier).toBe("cheap");
    });

    it("goes to the next tier like any answer that does not pass when the continuation is cut off too, and when it cannot be paid for", async () => {
      const twice = await made((_s, n) => (n < 2 ? { text: CUT, truncated: true } : FULL));
      await twice.service.editElement("u1", twice.id, H(), "Rename the heading to Weekly sales");
      expect(twice.model.sent.map((s) => s.tier)).toEqual(["cheap", "cheap", "code"]);
      // A day with room for one call and not two: the answer stays cut off, and the climb is the old behaviour.
      const poor = await made((_s, n) => (n === 0 ? { text: CUT, truncated: true } : FULL), { dailyPaise: 4 });
      await expect(poor.service.editElement("u1", poor.id, H(), "Rename the heading to Weekly sales")).rejects.toMatchObject({ code: "limit_reached" });
      expect(poor.model.sent).toHaveLength(1);
    });

    it("a cut-off answer with nothing in it is not continued", async () => {
      const r = await made((_s, n) => (n === 0 ? { text: "", truncated: true } : FULL));
      await r.service.editElement("u1", r.id, H(), "Rename the heading to Weekly sales");
      expect(r.model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    });

    it("a climb is never given less room than the first try had, even where the stronger tier's own limit is smaller (a run that holds every tier short)", async () => {
      const r = await made((_s, n) => (n === 0 ? "no" : FULL));
      await r.service.editElement("u1", r.id, H(), "Rename the heading to Weekly sales");
      expect(r.model.sent[1]!.maxTokens).toBeGreaterThanOrEqual(r.model.sent[0]!.maxTokens);
    });
  });

  describe("sized from the artifact", () => {
    const worstOf = (s: Sent, tier: "cheap" | "code" | "strong") => worstCasePaise({ chars: s.chars, maxTokens: s.maxTokens, usdPerMIn: DEFAULT_TIERS[tier].usdPerMIn, usdPerMOut: DEFAULT_TIERS[tier].usdPerMOut }, 88);

    it("affordableTokens is the most a cap pays for, exactly: one more token and the gateway would refuse", async () => {
      const { affordableTokens } = await import("../src/artifacts/model.js");
      for (const [tier, cap, chars] of [["cheap", 150, 12_000], ["code", 500, 80_000], ["strong", 2500, 40_000], ["cheap", 40, 500]] as const) {
        const n = affordableTokens(DEFAULT_TIERS[tier], cap, chars, 88);
        const at = (t: number) => worstCasePaise({ chars, maxTokens: t, usdPerMIn: DEFAULT_TIERS[tier].usdPerMIn, usdPerMOut: DEFAULT_TIERS[tier].usdPerMOut }, 88);
        expect(at(n), `${tier} ${cap}`).toBeLessThanOrEqual(cap);
        expect(at(n + 1), `${tier} ${cap}`).toBeGreaterThan(cap);
      }
      expect(affordableTokens(DEFAULT_TIERS.cheap, 1, 400_000, 88)).toBe(0);
    });

    it("an instruction on a bigger artifact is given room to rewrite it, as far as the cap allows, and no further", async () => {
      const content = `alpha ${"w".repeat(9_000)}`;
      const r = rig(() => "<edit><old>alpha</old><new>ALPHA</new></edit>");
      const m = await r.service.create("u1", { type: "markdown", title: "M", content, projectId: PROJECT });
      await r.service.editWhole("u1", m.artifact.id, "Shout the first word");
      const sent = r.model.sent[0]!;
      expect(sent.tier).toBe("cheap");
      expect(sent.maxTokens).toBeGreaterThan(2000);
      expect(worstOf(sent, "cheap")).toBeLessThanOrEqual(sent.capPaise!);
      // A small artifact keeps the room it always had.
      const r2 = rig(() => "<edit><old>alpha</old><new>ALPHA</new></edit>");
      const m2 = await r2.service.create("u1", { type: "markdown", title: "M", content: "alpha beta", projectId: PROJECT });
      await r2.service.editWhole("u1", m2.artifact.id, "Shout the first word");
      expect(r2.model.sent[0]!.maxTokens).toBeLessThanOrEqual(2000 + 1200);
      expect(r2.model.sent[0]!.maxTokens).toBeGreaterThanOrEqual(2000);
    });

    it("making a page asks for room for a page, within the cap; a diagram keeps the floor", async () => {
      const r = rig((s) => (s.purpose === "artifact.generate" ? "<!doctype html><html><body><h1>Hi</h1></body></html>" : ""));
      await r.service.generate("u1", { request: "A pricing page with three plans", type: "html" });
      const page = r.model.sent.find((s) => s.purpose === "artifact.generate")!;
      expect(page.maxTokens).toBe(8000);
      expect(worstOf(page, page.tier as never)).toBeLessThanOrEqual(page.capPaise!);
    });
  });

  it("holds a call to its cap and a person to their day", async () => {
    const r = await dash(retext, { paise: 4, dailyPaise: 8 });
    await r.service.editElement("u1", r.id, H(), "Rename the heading");
    expect(r.model.sent[0]!.capPaise).toBe(8);
    // 4 left: a call that costs 4 fits exactly
    await r.service.editElement("u1", r.id, idOf((await r.service.get("u1", r.id)).content, "<h2 style"), "Rename it again");
    // nothing left
    await expect(r.service.editElement("u1", r.id, idOf((await r.service.get("u1", r.id)).content, "<h2 style"), "Once more")).rejects.toMatchObject({ code: "limit_reached", message: expect.stringMatching(/used what edits and fixes may cost in a day/) });
    // another person has their own day
    const other = await r.service.create("u2", { type: "react", title: "Mine", content: SAMPLE_DASHBOARD });
    await expect(r.service.editElement("u2", other.artifact.id, H(), "Rename the heading")).resolves.toMatchObject({ version: 2 });
  });

  it("is refused by the gateway's cap as 'more than one edit may cost', and keeps nothing", async () => {
    const r = await dash(undefined, { paise: 400 });
    await expect(r.service.editElement("u1", r.id, H(), "Rename the heading")).rejects.toMatchObject({ code: "limit_reached", message: expect.stringMatching(/more than one edit may cost/) });
    expect((await r.service.own("u1", r.id)).headVersion).toBe(1);
  });

  it("is rate limited per person", async () => {
    const r = await dash(undefined, { rates: { edit: 2 } });
    const edit = (i: number) => r.service.editElement("u1", r.id, idOf(SAMPLE_DASHBOARD, "<h1 style"), `Say hello ${i}`).catch((e: Error) => e);
    await edit(1);
    await edit(2);
    const third = (await edit(3)) as { code: string; detail: { retryAfterSec: number } };
    expect(third.code).toBe("rate_limited");
    expect(third.detail.retryAfterSec).toBeGreaterThan(0);
  });

  it("loses a race cleanly: if the head moved while the model worked, nothing is overwritten and the cost is still counted", async () => {
    const { ArtifactService } = await import("../src/artifacts/service.js");
    const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
    const { scripted } = await import("./artifacts-rig.js");
    const inner = scripted((s) => elementOf(s).replace("Sales this week", "Weekly sales"), { paise: 3 });
    let svc!: InstanceType<typeof ArtifactService>;
    let id = "";
    // while the model "works", someone else changes the artifact
    const call = (async (input: never, deps: never) => { await svc.update("u1", id, [{ old: 'label="Orders"', new: 'label="Order count"' }]); return inner.call(input, deps); }) as typeof inner.call;
    svc = new ArtifactService({ store: new MemoryArtifactStore(), call });
    id = (await svc.create("u1", { type: "react", title: "D", content: SAMPLE_DASHBOARD })).artifact.id;
    await expect(svc.editElement("u1", id, H(), "Rename the heading")).rejects.toMatchObject({ code: "head_moved", message: expect.stringMatching(/changed while this was being made.*Nothing was changed/) });
    const now = await svc.get("u1", id);
    expect(now.version).toBe(2);
    expect(now.content).toContain('label="Order count"');
    expect(now.content).toContain("Sales this week");
    expect((await svc.own("u1", id)).spentPaise).toBe(3);
  });
});

describe("editing by saying", () => {
  it("answers with exact replacements, against the whole artifact, on the cheap tier when both are small", async () => {
    const { service, store, model, id } = await dash(() => "<edit><old>Sales this week</old><new>Weekly sales</new></edit>");
    const c = await service.editWhole("u1", id, "Rename the sales heading to Weekly sales");
    const sent = model.sent[0]!;
    expect(sent).toMatchObject({ tier: "cheap", purpose: "artifact.edit" });
    expect(sent.user).toContain(SAMPLE_DASHBOARD);
    expect(c.how).toMatchObject({ mode: "whole", tier: "cheap" });
    expect((await service.get("u1", id)).content).toBe(SAMPLE_DASHBOARD.replace("Sales this week", "Weekly sales"));
    expect((await store.listVersions(id))[0]).toMatchObject({ kind: "patch", madeBy: "person" });
    expect(c.how.completionTokens!).toBeLessThan(40);
  });

  it("starts on the code tier for a long instruction or a big artifact", async () => {
    const edit = () => "<edit><old>Sales this week</old><new>Weekly sales</new></edit>";
    const a = await dash(edit);
    await a.service.editWhole("u1", a.id, `Please rename the sales heading. ${"It should be short and clear. ".repeat(10)}`);
    expect(a.model.sent[0]!.tier).toBe("code");
    const b = rig(() => "<edit><old>alpha</old><new>ALPHA</new></edit>");
    const big = await b.service.create("u1", { type: "markdown", title: "Big", content: `alpha\n${"filler line of text\n".repeat(1200)}` });
    await b.service.editWhole("u1", big.artifact.id, "Shout the first word");
    expect(b.model.sent[0]!.tier).toBe("code");
  });

  it("takes a rewrite when the model says most of it changes", async () => {
    const { service, id } = await dash(() => `<rewrite>\n\`\`\`jsx\nexport default function A() { return <p>New</p>; }\n\`\`\`\n</rewrite>`);
    const c = await service.editWhole("u1", id, "Start over with a single paragraph");
    expect(c.how.mode).toBe("rewrite");
    expect((await service.get("u1", id)).content).toBe("export default function A() { return <p>New</p>; }");
  });

  it("tells the next tier which edit missed when its replacements do not apply", async () => {
    const { service, model, id } = await dash((_s, n) => (n === 0 ? "<edit><old>Sales this month</old><new>x</new></edit>" : "<edit><old>Sales this week</old><new>Weekly sales</new></edit>"));
    const c = await service.editWhole("u1", id, "Rename the sales heading");
    expect(model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    expect(model.sent[1]!.user).toMatch(/Edit 1 did not apply: its old text "Sales this month" is not in the artifact/);
    expect(c.version).toBe(2);
  });
});

describe("fixing the viewer's errors", () => {
  const src = `import { useState } from "react";
export default function App() {
  const [n, setN] = useState(0);
  const total = items.reduce((a, b) => a + b, 0);
  return (
    <main>
      <h1>{n}</h1>
      <button onClick={() => setN(n + 1)}>+</button>
${Array.from({ length: 60 }, (_, i) => `      <p>filler paragraph number ${i} with some words in it</p>`).join("\n")}
    </main>
  );
}
`;
  const FIX = "<edit><old>const total = items.reduce((a, b) => a + b, 0);</old><new>const total = [].reduce((a, b) => a + b, 0);</new></edit>";
  const runtime = (message = "items is not defined", o: Record<string, unknown> = {}) => ({ kind: "runtime" as const, message, line: 4, col: 17, ...o });
  async function broken(answer: Parameters<typeof rig>[0] = () => FIX, o: Parameters<typeof rig>[1] = {}) {
    const r = rig(answer, o);
    const made = await r.service.create("u1", { type: "react", title: "Broken", content: src });
    return { ...r, id: made.artifact.id };
  }

  it("sends the model the error and the lines around it, never the artifact, on the cheap tier, and the fix is a patch", async () => {
    const { service, store, model, id } = await broken(undefined, { paise: 3 });
    const out = await service.reportError("u1", id, 1, runtime());
    expect(out.status).toBe("fixed");
    const sent = model.sent[0]!;
    expect(sent).toMatchObject({ tier: "cheap", purpose: "artifact.fix" });
    expect(sent.user).toMatch(/<error kind="runtime" line="4" col="17">\nitems is not defined\n<\/error>/);
    expect(sent.user).toContain("4:   const total = items.reduce");
    expect(sent.user).toContain("10: ");
    expect(sent.user).not.toContain("filler paragraph number 30");
    expect(sent.chars).toBeLessThan(src.length * 0.6);
    expect(sent.user.length).toBeLessThan(src.length * 0.25);
    if (out.status !== "fixed") return;
    expect(out.change).toMatchObject({ version: 2, paise: 3, how: { mode: "fix", tier: "cheap" } });
    expect((await service.get("u1", id)).content).toBe(src.replace("items.reduce", "[].reduce"));
    const v = (await store.listVersions(id))[0]!;
    expect(v).toMatchObject({ kind: "patch", madeBy: "bot" });
    expect(v.note).toBe("Auto-fix: items is not defined");
    expect(v.storedBytes).toBeLessThan(140);
  });

  it("deduplicates by message and version: the same error twice costs one call", async () => {
    const { service, model, id } = await broken(() => "<cannot>no</cannot>");
    const first = await service.reportError("u1", id, 1, runtime());
    expect(first.status).toBe("failed");
    const calls = model.sent.length;
    expect(await service.reportError("u1", id, 1, runtime())).toEqual({ status: "duplicate" });
    expect(await service.reportError("u1", id, 1, runtime("items is not defined", { line: 9 }))).toEqual({ status: "duplicate" });
    expect(model.sent.length).toBe(calls);
    // a different message is a different error
    expect((await service.reportError("u1", id, 1, runtime("something else broke"))).status).toBe("failed");
  });

  it("makes at most two attempts for a version, however many different errors come", async () => {
    expect(FIX_ATTEMPTS).toBe(2);
    const { service, model, id } = await broken(() => "<cannot>not from these lines</cannot>");
    expect((await service.reportError("u1", id, 1, runtime("error one"))).status).toBe("failed");
    expect((await service.reportError("u1", id, 1, runtime("error two"))).status).toBe("failed");
    const callsAfterTwo = model.sent.length;
    expect(await service.reportError("u1", id, 1, runtime("error three"))).toEqual({ status: "limit", reason: "attempts" });
    expect(await service.reportError("u1", id, 1, runtime("error four"))).toEqual({ status: "limit", reason: "attempts" });
    expect(model.sent.length).toBe(callsAfterTwo);
    expect(service.engine.fixes.attempts(id, 1)).toBe(2);
  });

  it("stops a chain of fixes at three, so a broken artifact cannot loop", async () => {
    expect(FIX_CHAIN).toBe(3);
    // each call rewrites `useState(n)` to `useState(n + 1)`: the nth fix is of version n + 1, so the fixes follow one another
    const { service, id } = await broken((_s, n) => `<edit><old>useState(${n})</old><new>useState(${n + 1})</new></edit>`);
    const outcomes: string[] = [];
    for (let v = 1; v <= 4; v += 1) outcomes.push((await service.reportError("u1", id, v, runtime(`boom ${v}`, { line: 3 }))).status);
    expect(outcomes).toEqual(["fixed", "fixed", "fixed", "limit"]);
    expect(service.engine.fixes.chain(id, 4)).toBe(3);
    expect((await service.get("u1", id)).content).toContain("useState(3)");
  });

  it("answers stale for a version that is not the head, and does not spend anything", async () => {
    const { service, model, id } = await broken();
    await service.update("u1", id, [{ old: "<h1>{n}</h1>", new: "<h1>Count: {n}</h1>" }]);
    expect(await service.reportError("u1", id, 1, runtime())).toEqual({ status: "stale", head: 2 });
    expect(model.sent).toHaveLength(0);
    await expect(service.reportError("u1", id, 9, runtime())).rejects.toMatchObject({ code: "bad_request" });
  });

  it("will not try what a model cannot fix from a few lines: a limit error, markdown, or an error with no place", async () => {
    const { service, model, id } = await broken();
    expect((await service.reportError("u1", id, 1, { kind: "limit", message: "too big" })).status).toBe("not_fixable");
    const nowhere = await service.reportError("u1", id, 1, { kind: "runtime", message: "mystery" });
    expect(nowhere).toMatchObject({ status: "not_fixable", reason: expect.stringMatching(/did not say where/) });
    const md = await service.create("u1", { type: "markdown", title: "N", content: "# a\n\nb" });
    expect((await service.reportError("u1", md.artifact.id, 1, runtime())).status).toBe("not_fixable");
    expect(model.sent).toHaveLength(0);
    // and the unplaced error was not counted as an attempt
    expect(service.engine.fixes.attempts(id, 1)).toBe(0);
  });

  it("finds the place in a stack when the error has no line of its own", async () => {
    const { service, model, id } = await broken();
    const out = await service.reportError("u1", id, 1, { kind: "runtime", message: "items is not defined", stack: "ReferenceError: items is not defined\n    at App (artifact.jsx:4:17)\n    at renderWithHooks" });
    expect(out.status).toBe("fixed");
    expect(model.sent[0]!.user).toMatch(/line="4" col="17"/);
  });

  it("climbs once when the cheap tier cannot fix it, and reports a failure with what it cost when nothing can", async () => {
    const r = await broken((_s, n) => (n === 0 ? "I would change line 4." : FIX), { paise: 3 });
    const out = await r.service.reportError("u1", r.id, 1, runtime());
    expect(out.status).toBe("fixed");
    expect(r.model.sent.map((s) => s.tier)).toEqual(["cheap", "code"]);
    const bad = await broken(() => "nothing useful", { paise: 3 });
    const failed = await bad.service.reportError("u1", bad.id, 1, runtime());
    expect(failed).toMatchObject({ status: "failed", paise: 6 });
    expect((await bad.service.own("u1", bad.id))).toMatchObject({ headVersion: 1, spentPaise: 6 });
  });

  it("refuses a fix that does not make a valid artifact, and one whose old text is not in the artifact", async () => {
    const lib = await broken(() => "<edit><old>import { useState } from \"react\";</old><new>import moment from \"moment\";</new></edit>");
    const out = await lib.service.reportError("u1", lib.id, 1, runtime());
    expect(out).toMatchObject({ status: "failed", reason: expect.stringContaining('import "moment" is not available') });
    const miss = await broken(() => "<edit><old>const total = nothing;</old><new>const total = 0;</new></edit>");
    expect((await miss.service.reportError("u1", miss.id, 1, runtime())).status).toBe("failed");
    expect((await miss.service.own("u1", miss.id)).headVersion).toBe(1);
  });

  it("is the owner's, and rate limited", async () => {
    const { service, id } = await broken(undefined, { rates: { errors: 2 } });
    await expect(service.reportError("u2", id, 1, runtime())).rejects.toMatchObject({ code: "not_found" });
    const rl = rig(() => "<cannot>x</cannot>", { rates: { errors: 2 } });
    const m = await rl.service.create("u1", { type: "react", title: "B", content: src });
    await rl.service.reportError("u1", m.artifact.id, 1, runtime("a"));
    await rl.service.reportError("u1", m.artifact.id, 1, runtime("b"));
    await expect(rl.service.reportError("u1", m.artifact.id, 1, runtime("c"))).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("the caps", () => {
  /** The gateway's worst case for a call, at the brain's tier prices: what it checks against the cap before it sends anything. */
  const worst = (s: Sent, tier: "cheap" | "code" | "strong") => worstCasePaise({ chars: s.chars, maxTokens: s.maxTokens, usdPerMIn: DEFAULT_TIERS[tier].usdPerMIn, usdPerMOut: DEFAULT_TIERS[tier].usdPerMOut }, 88);
  const kit = "k".repeat(2000);

  it("cover the biggest call of each kind the engine makes, so a call that is allowed is never refused for its own size", async () => {
    // an element as big as one may be, answered in replacements
    const html = `<div>${"<p>some text for a paragraph here</p>".repeat(Math.floor((ELEMENT_MAX - 60) / 37))}<p>UNIQUE-MARK</p></div>`;
    expect(html.length).toBeLessThanOrEqual(ELEMENT_MAX);
    const a = rig(() => "<edit><old>UNIQUE-MARK</old><new>done</new></edit>");
    const made = await a.service.create("u1", { type: "html", title: "Big", content: html, projectId: PROJECT });
    await a.store.putKit(PROJECT, "u1", "sha", { prompt: kit });
    await a.service.editElement("u1", made.artifact.id, "1:1", "Change the last paragraph");
    const el = a.model.sent[0]!;
    expect(el.user).toContain("REPLACEMENTS form");
    expect(worst(el, "cheap")).toBeLessThanOrEqual(el.capPaise!);
    // an element as big as one may be and still be answered whole
    const b = rig((s) => elementOf(s).replace("small", "SMALL"));
    const tiny = await b.service.create("u1", { type: "html", title: "T", content: `<div>${"x".repeat(ELEMENT_WHOLE_MAX - 40)} small</div>`, projectId: PROJECT });
    await b.store.putKit(PROJECT, "u1", "sha", { prompt: kit });
    await b.service.editElement("u1", tiny.artifact.id, "1:1", "Shout it");
    expect(worst(b.model.sent[0]!, "cheap")).toBeLessThanOrEqual(b.model.sent[0]!.capPaise!);

    // an instruction on the biggest artifact and instruction that start on the cheap tier
    const c = rig(() => "<edit><old>alpha</old><new>ALPHA</new></edit>");
    const small = await c.service.create("u1", { type: "markdown", title: "S", content: `alpha ${"w".repeat(SMALL_ARTIFACT_CHARS - 10)}`, projectId: PROJECT });
    await c.store.putKit(PROJECT, "u1", "sha", { prompt: kit });
    await c.service.editWhole("u1", small.artifact.id, "x".repeat(SMALL_INSTRUCTION_CHARS));
    expect(c.model.sent[0]!.tier).toBe("cheap");
    expect(worst(c.model.sent[0]!, "cheap")).toBeLessThanOrEqual(c.model.sent[0]!.capPaise!);

    // a fix on the longest lines it is shown
    const d = rig(() => "<edit><old>boom</old><new>ok</new></edit>");
    const lines = Array.from({ length: 30 }, (_, i) => `// ${"y".repeat(190)} ${i}`);
    lines[14] = "boom();";
    const fix = await d.service.create("u1", { type: "react", title: "F", content: `${lines.join("\n")}\nexport default () => null;`, projectId: PROJECT });
    await d.store.putKit(PROJECT, "u1", "sha", { prompt: kit });
    await d.service.reportError("u1", fix.artifact.id, 1, { kind: "runtime", message: "m".repeat(400), line: 15, col: 1 });
    expect(worst(d.model.sent[0]!, "cheap")).toBeLessThanOrEqual(d.model.sent[0]!.capPaise!);

    // an instruction on a 100 KB artifact goes to the code tier and still fits its cap
    const e = rig(() => "<edit><old>alpha</old><new>ALPHA</new></edit>");
    const big = await e.service.create("u1", { type: "markdown", title: "B", content: `alpha ${"w".repeat(100_000)}`, projectId: PROJECT });
    await e.store.putKit(PROJECT, "u1", "sha", { prompt: kit });
    await e.service.editWhole("u1", big.artifact.id, "Shout the first word");
    expect(e.model.sent[0]!.tier).toBe("code");
    expect(worst(e.model.sent[0]!, "code")).toBeLessThanOrEqual(e.model.sent[0]!.capPaise!);
  });

  it("climb with the stronger tier's own cap, so a fix that needs the code tier is not refused for the cheap tier's size", async () => {
    const r = rig((_s, n) => (n === 0 ? "no" : "<edit><old>boom</old><new>ok</new></edit>"));
    const m = await r.service.create("u1", { type: "react", title: "F", content: "boom();\nexport default () => null;" });
    await r.service.reportError("u1", m.artifact.id, 1, { kind: "runtime", message: "m", line: 1, col: 1 });
    expect(r.model.sent.map((s) => [s.tier, s.capPaise])).toEqual([["cheap", 150], ["code", 500]]);
    expect(r.model.sent[1]!.maxTokens).toBe(1400);
  });
});
